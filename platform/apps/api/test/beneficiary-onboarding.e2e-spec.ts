import request from 'supertest';
import ExcelJS from 'exceljs';
import { prisma, DeviceType, seedReferenceData } from '@alzad/db';
import { SIMPLE_BENEFICIARY_IMPORT_FIELDS } from '@alzad/shared';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { loginAs } from './utils/node2-fixtures';
import { cleanNode3State, newOpId, seedNode3Fixtures, uniquePhone } from './utils/node3-fixtures';

jest.setTimeout(120000);
describe('50-family onboarding: Excel to association and admin', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let fakeEmail: Awaited<ReturnType<typeof createTestApp>>['fakeEmail'];
  let fx: Awaited<ReturnType<typeof seedNode3Fixtures>>;
  let associationCookie: string, adminCookie: string, otherCookie: string;
  let adminAccountId: string;
  beforeAll(async () => {
    ({ app, fakeEmail } = await createTestApp());
    await seedReferenceData(prisma);
    const base = await seedTestFixtures();
    adminAccountId = (await prisma.account.findFirstOrThrow({ where: { email: base.adminEmail }, select: { id: true } })).id;
    fx = await seedNode3Fixtures();
    await cleanNode3State();
    await cleanAuthState();
    associationCookie = await loginAs(app, fx.assocAEmail, fx.assocAPassword);
    adminCookie = await loginAs(app, base.adminEmail, base.adminPassword);
    otherCookie = await loginAs(app, fx.assocBEmail, fx.assocBPassword);
  });
  afterAll(async () => { if (app) { await cleanNode3State(); await app.close(); } await prisma.$disconnect(); });
  const http = () => request(app.getHttpServer());
  const row = (i: number) => ({ needPriority: i + 1, name: `اختبار رفع الأسر — ${i + 1}`, region: 'الرياض', city: 'الرياض', district: 'حي اختبار', phone: uniquePhone(), phone2: uniquePhone(), familyCount: 2 + i % 8, socialStatus: i % 2 ? 'أعزب/عزباء' : 'أرملة', socialSecurity: i % 2 === 0, income: i * 100, notes: `اختبار تكامل ${i + 1}`, lat: i % 2 ? undefined : 24.7, lng: i % 2 ? undefined : 46.7, deviceTypes: i % 3 === 0 ? [DeviceType.REFRIGERATOR, DeviceType.OVEN, DeviceType.WASHING_MACHINE] : i % 3 === 1 ? [DeviceType.REFRIGERATOR, DeviceType.WASHING_MACHINE] : [DeviceType.REFRIGERATOR], threeDeviceReason: i % 3 === 0 ? 'لا تتوفر للأسرة أي من الأجهزة الثلاثة الصالحة للاستخدام' : undefined });

  it('rejects missing three-device explanations through manual and JSON import without any writes', async () => {
    const invalid = { ...row(0), threeDeviceReason: '  ' };
    const manual = await http().post('/api/v1/beneficiaries').set('Cookie', associationCookie).send({ ...invalid, opId: newOpId('missing-reason') });
    expect(manual.status).toBe(400);
    const bulk = await http().post('/api/v1/beneficiaries/import').set('Cookie', associationCookie).send({ acceptedPledge: true, rows: [row(1), invalid], opId: newOpId('missing-bulk') });
    expect(bulk.body).toMatchObject({ ok: false, errors: [expect.objectContaining({ row: 2 })] });
    expect(await prisma.beneficiary.count({ where: { associationId: fx.associationAId } })).toBe(0);
  });

  it('requires explicit social-security and income answers for manual, JSON and Excel intake', async () => {
    for (const missing of [{ socialSecurity: undefined }, { income: undefined }, { socialSecurity: null }, { income: null }]) {
      const invalid = { ...row(1), ...missing };
      const manual = await http().post('/api/v1/beneficiaries').set('Cookie', associationCookie).send({ ...invalid, opId: newOpId('required-finance') });
      expect(manual.status).toBe(400);
      const bulk = await http().post('/api/v1/beneficiaries/import').set('Cookie', associationCookie).send({ acceptedPledge: true, rows: [invalid], opId: newOpId('required-finance-bulk') });
      expect(bulk.body).toMatchObject({ ok: false, errors: [expect.objectContaining({ row: 1 })] });
    }
    const { generateXlsxTemplate } = await import('../src/modules/beneficiaries/xlsx-import.util');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await generateXlsxTemplate({ region: 'الرياض' }) as unknown as ExcelJS.Buffer);
    const values = { ...row(1), income: 0, socialSecurity: 'لا', refrigerator: 'نعم', oven: 'لا', washingMachine: 'لا' } as Record<string, unknown>;
    workbook.worksheets[0].getRow(2).values = SIMPLE_BENEFICIARY_IMPORT_FIELDS.map(field => values[field] ?? '') as ExcelJS.CellValue[];
    for (const column of ['N2', 'O2']) {
      const saved = workbook.worksheets[0].getCell(column).value;
      workbook.worksheets[0].getCell(column).value = '';
      const preview = await http().post('/api/v1/beneficiaries/import/preview-xlsx').set('Cookie', associationCookie).attach('file', Buffer.from(await workbook.xlsx.writeBuffer()), 'missing-finance.xlsx');
      expect(preview.body.rows[0].valid).toBe(false);
      workbook.worksheets[0].getCell(column).value = saved;
    }
    const valid = await http().post('/api/v1/beneficiaries/import/preview-xlsx').set('Cookie', associationCookie).attach('file', Buffer.from(await workbook.xlsx.writeBuffer()), 'explicit-zero.xlsx');
    expect(valid.body.rows[0]).toMatchObject({ valid: true, parsed: { socialSecurity: false, income: 0 } });
    expect(await prisma.beneficiary.count({ where: { associationId: fx.associationAId } })).toBe(0);
  });

  it('imports all 50 real XLSX rows, preserves every field, isolates tenants and supports safe admin review', async () => {
    const template = await http().get('/api/v1/beneficiaries/import/template.xlsx').set('Cookie', associationCookie).buffer(true).parse((res, callback) => { const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => callback(null, Buffer.concat(chunks))); });
    expect(template.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(template.body);
    const source = Array.from({ length: 50 }, (_, i) => row(i));
    const sheet = workbook.worksheets[0];
    source.forEach((item, i) => {
      const values: Record<string, unknown> = { ...item, socialSecurity: item.socialSecurity ? 'نعم' : 'لا', refrigerator: 'نعم', oven: item.deviceTypes.includes(DeviceType.OVEN) ? 'نعم' : 'لا', washingMachine: item.deviceTypes.includes(DeviceType.WASHING_MACHINE) ? 'نعم' : 'لا' };
      sheet.getRow(i + 2).values = SIMPLE_BENEFICIARY_IMPORT_FIELDS.map(field => values[field] ?? '') as ExcelJS.CellValue[];
    });
    const preview = await http().post('/api/v1/beneficiaries/import/preview-xlsx').set('Cookie', associationCookie).attach('file', Buffer.from(await workbook.xlsx.writeBuffer()), 'test-families.xlsx');
    expect(preview.body.rows).toHaveLength(50);
    expect(preview.body.rows.every((item: { valid: boolean }) => item.valid)).toBe(true);
    const opId = newOpId('onboarding-50');
    const payload = { rows: preview.body.rows.map((item: { parsed: unknown }) => item.parsed), acceptedPledge: true, opId };
    const imported = await http().post('/api/v1/beneficiaries/import').set('Cookie', associationCookie).send(payload);
    expect(imported.body).toMatchObject({ ok: true, createdCount: 50 });
    const repeated = await http().post('/api/v1/beneficiaries/import').set('Cookie', associationCookie).send(payload);
    expect(repeated.body).toMatchObject({ ok: true, createdCount: 50, replayed: true });
    const stored = await prisma.beneficiary.findMany({ where: { associationId: fx.associationAId }, include: { needs: true }, orderBy: { needPriority: 'asc' } });
    expect(stored).toHaveLength(50);
    source.forEach((item, i) => {
      expect(stored[i]).toMatchObject({ name: item.name, needPriority: item.needPriority, phone: item.phone, secondaryPhone: item.phone2, familyCount: item.familyCount, maritalStatus: item.socialStatus, socialSecurity: item.socialSecurity, notes: item.notes, region: item.region, city: item.city, district: item.district, threeDeviceReason: item.threeDeviceReason ?? null });
      expect(Number(stored[i].income)).toBe(item.income);
      expect(stored[i].latitude === null ? null : Number(stored[i].latitude)).toBe(item.lat ?? null);
      expect(stored[i].longitude === null ? null : Number(stored[i].longitude)).toBe(item.lng ?? null);
    });
    source.forEach((item, i) => expect(stored[i].needs.map(need => need.deviceType).sort()).toEqual([...item.deviceTypes].sort()));
    const admin = await http().get(`/api/v1/beneficiaries?associationId=${fx.associationAId}&pageSize=100&sortBy=needPriority`).set('Cookie', adminCookie);
    expect(admin.status).toBe(200);
    expect(admin.body.items.map((item: { needPriority: number }) => item.needPriority)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    const other = await http().get(`/api/v1/beneficiaries/${stored[0].id}`).set('Cookie', otherCookie);
    expect(other.status).toBe(404);
    const invalidUpdate = await http().patch(`/api/v1/beneficiaries/${stored[0].id}`).set('Cookie', associationCookie).send({ ...source[0], threeDeviceReason: '', opId: newOpId('clear-reason') });
    expect(invalidUpdate.status).toBe(400);
    const duplicate = await http().post('/api/v1/beneficiaries').set('Cookie', associationCookie).send({ ...row(0), opId: newOpId('same-rank') });
    expect(duplicate.status).toBe(409);
    const reviewed = await http().post(`/api/v1/beneficiaries/${stored[0].id}/review`).set('Cookie', adminCookie).send({ beneficiaryDecision: 'REJECTED', beneficiaryRejectReason: 'قرار تجريبي في قاعدة معزولة', opId: newOpId('review-test') });
    expect(reviewed.status).toBe(201);
    expect(reviewed.body.beneficiaryDecision).toBe('REJECTED');
    const remaining = stored.slice(1, 3);
    const bulk = await http().post('/api/v1/beneficiaries/bulk-review').set('Cookie', adminCookie).send({ items: remaining.map(item => ({ beneficiaryId: item.id, beneficiaryDecision: 'APPROVED', needDecisions: item.needs.map(need => ({ needId: need.id, decision: 'APPROVED' })), opId: newOpId('review-bulk') })) });
    expect(bulk.status).toBe(201);
    expect(bulk.body.failed).toEqual([]);
    expect(bulk.body.success).toHaveLength(2);
    expect(fakeEmail.lastSecurityAlert).toBeNull();
    await cleanNode3State();
    expect(await prisma.beneficiary.count({ where: { associationId: fx.associationAId } })).toBe(0);
  });

  it('limits cleanup to the actor-owned disposable demo import and retains its audit trail', async () => {
    const application = await prisma.associationApplication.create({ data: { publicCode: 'APP-000328', name: 'جمعية تجربة', category: 'جمعية خيرية', region: 'الرياض', city: 'الرياض', phone: uniquePhone(), contactName: 'اختبار محلي' } });
    await prisma.association.update({ where: { id: fx.associationBId }, data: { name: 'جمعية تجربة' } });
    const actor = await prisma.account.findFirstOrThrow({ where: { email: fx.assocBEmail }, select: { id: true } });
    await prisma.projectParticipation.create({ data: { associationId: fx.associationBId, applicationId: application.id, status: 'ACTIVE', activationBasis: 'AGREEMENT_COMPLETED', agreements: { create: { version: 1, templateVersion: 'TEST', status: 'SIGNED', fullyExecutedAt: new Date(), createdById: actor.id } } } });
    const rows = [row(0), row(1)].map(item => ({ ...item, notes: 'ONBOARDING-TEST-20261029-11111111-1111-4111-8111-111111111111' }));
    const imported = await http().post('/api/v1/beneficiaries/import').set('Cookie', otherCookie).send({ rows, acceptedPledge: true, opId: newOpId('disposable-demo') });
    expect(imported.body).toMatchObject({ ok: true, createdCount: 2 });
    const unauthorized = await http().post('/api/v1/beneficiaries/test-import/cleanup').set('Cookie', associationCookie).send({ beneficiaryIds: imported.body.beneficiaryIds });
    expect(unauthorized.status).toBe(403);
    const removed = await http().post('/api/v1/beneficiaries/test-import/cleanup').set('Cookie', otherCookie).send({ beneficiaryIds: imported.body.beneficiaryIds });
    expect(removed.body).toMatchObject({ ok: true, removedCount: 2 });
    expect(await prisma.beneficiary.count({ where: { associationId: fx.associationBId } })).toBe(0);
    expect(await prisma.beneficiaryNeed.count({ where: { associationId: fx.associationBId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { associationId: fx.associationBId, action: 'TEST_BENEFICIARY_IMPORT_REMOVED' } })).toBe(1);
  });

  it('counts legacy records, blocks concurrent/manual/bulk overflow, and allows only the owner to raise one association quota', async () => {
    await prisma.beneficiary.create({ data: { publicCode: 'HISTORICAL-QUOTA-TEST', associationId: fx.associationAId, name: 'سجل قديم للاختبار', region: 'الرياض', city: 'الرياض', district: 'حي اختبار', phone: uniquePhone(), familyCount: 3, maritalStatus: 'أرملة' } });
    const initial = await http().post('/api/v1/beneficiaries/import').set('Cookie', associationCookie).send({ rows: Array.from({ length: 48 }, (_, i) => row(i)), acceptedPledge: true, opId: newOpId('forty-eight') });
    expect(initial.body).toMatchObject({ ok: true, createdCount: 48 });
    const raced = await Promise.all([48, 49].map(i => http().post('/api/v1/beneficiaries').set('Cookie', associationCookie).send({ ...row(i), opId: newOpId('last-slot') })));
    expect(raced.map(response => response.status).sort()).toEqual([201, 409]);
    expect(await prisma.beneficiary.count({ where: { associationId: fx.associationAId } })).toBe(50);
    const blocked = await http().post('/api/v1/beneficiaries/import').set('Cookie', associationCookie).send({ rows: [row(50), row(51)], acceptedPledge: true, opId: newOpId('overflow-batch') });
    expect(blocked.status).toBe(409);
    expect(await prisma.beneficiary.count({ where: { associationId: fx.associationAId } })).toBe(50);
    const overflowWorkbook = new ExcelJS.Workbook();
    const overflowSheet = overflowWorkbook.addWorksheet('مستفيدون');
    overflowSheet.addRow(SIMPLE_BENEFICIARY_IMPORT_FIELDS);
    const overflowValues: Record<string, unknown> = { ...row(50), socialSecurity: 'نعم', refrigerator: 'نعم', oven: 'لا', washingMachine: 'لا' };
    overflowSheet.addRow(SIMPLE_BENEFICIARY_IMPORT_FIELDS.map(field => overflowValues[field] ?? '') as ExcelJS.CellValue[]);
    const overflowPreview = await http().post('/api/v1/beneficiaries/import/preview-xlsx').set('Cookie', associationCookie).attach('file', Buffer.from(await overflowWorkbook.xlsx.writeBuffer()), 'overflow.xlsx');
    expect(overflowPreview.body.rows[0].valid).toBe(false);
    expect(overflowPreview.body.rows[0].error).toContain('المتاح');
    expect((await http().patch(`/api/v1/associations/${fx.associationAId}/beneficiary-limit`).set('Cookie', associationCookie).send({ limit: 52, opId: newOpId('tenant-change') })).status).toBe(403);
    expect((await http().patch(`/api/v1/associations/${fx.associationAId}/beneficiary-limit`).set('Cookie', adminCookie).send({ limit: 52, opId: newOpId('not-owner') })).status).toBe(403);
    // The owner promotion is confined to this disposable test database.
    await prisma.account.update({ where: { id: adminAccountId }, data: { publicCode: 'ADM-000001', adminFullAccess: true } });
    const approved = await http().patch(`/api/v1/associations/${fx.associationAId}/beneficiary-limit`).set('Cookie', adminCookie).send({ limit: 52, opId: newOpId('owner-approval') });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ ok: true, limit: 52 });
    const expandedTemplate = await http().get('/api/v1/beneficiaries/import/template.xlsx').set('Cookie', associationCookie).buffer(true).parse((res, callback) => { const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => callback(null, Buffer.concat(chunks))); });
    const expandedWorkbook = new ExcelJS.Workbook();
    await expandedWorkbook.xlsx.load(expandedTemplate.body);
    expect(expandedWorkbook.worksheets[0].getCell('A2').dataValidation.formulae).toEqual([1, 52]);
    expect((await prisma.association.findUniqueOrThrow({ where: { id: fx.associationBId } })).beneficiaryLimit).toBe(50);
    const extra = await http().post('/api/v1/beneficiaries/import').set('Cookie', associationCookie).send({ rows: [row(50), row(51)], acceptedPledge: true, opId: newOpId('approved-extra') });
    expect(extra.body).toMatchObject({ ok: true, createdCount: 2 });
    expect((await http().get('/api/v1/beneficiaries/intake-status').set('Cookie', associationCookie)).body).toMatchObject({ limit: 52, count: 52, remaining: 0 });
    expect((await http().get('/api/v1/dashboard/association').set('Cookie', associationCookie)).body.counts.beneficiaryLimit).toBe(52);
    expect((await http().patch(`/api/v1/associations/${fx.associationAId}/beneficiary-limit`).set('Cookie', adminCookie).send({ limit: 51, opId: newOpId('unsafe-lowering') })).status).toBe(409);
    const cannotSelfRaise = await http().post('/api/v1/beneficiaries').set('Cookie', associationCookie).send({ ...row(52), beneficiaryLimit: 1000, opId: newOpId('forged-limit') });
    expect(cannotSelfRaise.status).toBe(400);
    expect(await prisma.auditLog.count({ where: { action: 'ASSOCIATION_BENEFICIARY_LIMIT_UPDATED', associationId: fx.associationAId } })).toBe(1);
  });
});
