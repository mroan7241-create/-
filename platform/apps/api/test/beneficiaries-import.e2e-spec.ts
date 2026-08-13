import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { prisma, DeviceType } from '@alzad/db';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { loginAs, loginAsDelegate } from './utils/node2-fixtures';
import { cleanNode3State, newOpId, seedNode3Fixtures, uniquePhone, type Node3Fixtures } from './utils/node3-fixtures';

jest.setTimeout(60000);

function importRow(overrides: Record<string, unknown> = {}) {
  return {
    name: 'مستفيد استيراد',
    region: 'الرياض',
    city: 'الرياض',
    district: 'حي النرجس',
    phone: uniquePhone(),
    familyCount: 4,
    socialSecurity: false,
    socialStatus: 'أرملة',
    income: 1500,
    deviceTypes: [DeviceType.REFRIGERATOR],
    ...overrides,
  };
}

/** BEN-013 — POST /beneficiaries/import (تكامل حقيقي). ذرّي بالكامل: أي خطأ يُسقط الدفعة كاملة قبل أي كتابة. */
describe('BEN-013 — استيراد مستفيدين بالجملة (تكامل حقيقي)', () => {
  let app: INestApplication;
  let base: Awaited<ReturnType<typeof seedTestFixtures>>;
  let fx: Node3Fixtures;
  let adminCookie: string;
  let assocACookie: string;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    base = await seedTestFixtures();
    fx = await seedNode3Fixtures();
  }, 60000);

  beforeEach(async () => {
    await cleanNode3State();
    await cleanAuthState();
    adminCookie = await loginAs(app, base.adminEmail, base.adminPassword);
    assocACookie = await loginAs(app, fx.assocAEmail, fx.assocAPassword);
  });

  afterAll(async () => {
    await cleanNode3State();
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('ASSOCIATION يستورد 3 مستفيدين دفعة واحدة ← كلهم + احتياجاتهم فعليًا في DB', async () => {
    const rows = [importRow(), importRow({ deviceTypes: [DeviceType.OVEN, DeviceType.WASHING_MACHINE] }), importRow()];
    const res = await http().post('/api/v1/beneficiaries/import').set('Cookie', assocACookie).send({ acceptedPledge: true, rows, opId: newOpId('imp') });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.createdCount).toBe(3);
    expect(res.body.beneficiaryIds).toHaveLength(3);

    const created = await prisma.beneficiary.findMany({ where: { id: { in: res.body.beneficiaryIds } }, include: { needs: true } });
    expect(created).toHaveLength(3);
    expect(created.every((b) => b.associationId === fx.associationAId)).toBe(true);
    expect(created.every((b) => b.reviewStatus === 'UNDER_REVIEW')).toBe(true);
    const totalNeeds = created.reduce((sum, b) => sum + b.needs.length, 0);
    expect(totalNeeds).toBe(1 + 2 + 1);
  });

  it('بلا acceptedPledge يُرفَض 400، ولا كتابة تحدث', async () => {
    const before = await prisma.beneficiary.count({ where: { associationId: fx.associationAId } });
    const res = await http().post('/api/v1/beneficiaries/import').set('Cookie', assocACookie).send({ acceptedPledge: false, rows: [importRow()], opId: newOpId('imp') });
    expect(res.status).toBe(400);
    const after = await prisma.beneficiary.count({ where: { associationId: fx.associationAId } });
    expect(after).toBe(before);
  });

  it('صف واحد غير صالح ضمن دفعة صحيحة يُسقط الدفعة كاملة (لا كتابة جزئية) — ok:false + errors', async () => {
    const rows = [importRow(), importRow({ deviceTypes: [] }), importRow()]; // الصف الثاني بلا احتياج
    const before = await prisma.beneficiary.count({ where: { associationId: fx.associationAId } });
    const res = await http().post('/api/v1/beneficiaries/import').set('Cookie', assocACookie).send({ acceptedPledge: true, rows, opId: newOpId('imp') });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(false);
    expect(res.body.errors.length).toBeGreaterThan(0);
    expect(res.body.errors.some((e: { row: number }) => e.row === 2)).toBe(true);

    const after = await prisma.beneficiary.count({ where: { associationId: fx.associationAId } });
    expect(after).toBe(before); // صفر كتابة
  });

  it('جوال مكرَّر داخل الملف نفسه يُرفَض (all-or-nothing) — لا كتابة', async () => {
    const phone = uniquePhone();
    const rows = [importRow({ phone }), importRow({ phone })];
    const before = await prisma.beneficiary.count({ where: { associationId: fx.associationAId } });
    const res = await http().post('/api/v1/beneficiaries/import').set('Cookie', assocACookie).send({ acceptedPledge: true, rows, opId: newOpId('imp') });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(false);
    expect(res.body.errors.some((e: { message: string }) => e.message.includes('مكرَّر'))).toBe(true);

    const after = await prisma.beneficiary.count({ where: { associationId: fx.associationAId } });
    expect(after).toBe(before);
  });

  it('جوال يطابق مستفيدًا موجودًا مسبقًا في نفس الجمعية يُرفَض 409 عبر إعادة الفحص بعد القفل', async () => {
    const existingPhone = uniquePhone();
    const first = await http().post('/api/v1/beneficiaries/import').set('Cookie', assocACookie).send({ acceptedPledge: true, rows: [importRow({ phone: existingPhone })], opId: newOpId('imp') });
    expect(first.status).toBe(201);
    expect(first.body.ok).toBe(true);

    const second = await http()
      .post('/api/v1/beneficiaries/import')
      .set('Cookie', assocACookie)
      .send({ acceptedPledge: true, rows: [importRow({ phone: existingPhone })], opId: newOpId('imp') });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('BENEFICIARY_DUPLICATE_PHONE');
  });

  it('opId معاد بنفس الحمولة ← نفس الرد المخزَّن بلا إنشاء مكرَّر (idempotent)', async () => {
    const opId = newOpId('imp');
    const rows = [importRow()];
    const first = await http().post('/api/v1/beneficiaries/import').set('Cookie', assocACookie).send({ acceptedPledge: true, rows, opId });
    expect(first.status).toBe(201);

    const second = await http().post('/api/v1/beneficiaries/import').set('Cookie', assocACookie).send({ acceptedPledge: true, rows, opId });
    expect(second.status).toBe(201);
    expect(second.body.beneficiaryIds).toEqual(first.body.beneficiaryIds);

    const count = await prisma.beneficiary.count({ where: { id: { in: first.body.beneficiaryIds } } });
    expect(count).toBe(1);
  });

  it('ASSOCIATION لا يستطيع استيراد لجمعية أخرى — associationId من الجلسة حصرًا', async () => {
    const res = await http()
      .post('/api/v1/beneficiaries/import')
      .set('Cookie', assocACookie)
      .send({ associationId: fx.associationBId, acceptedPledge: true, rows: [importRow()], opId: newOpId('imp') });
    expect(res.status).toBe(201);
    const row = await prisma.beneficiary.findUniqueOrThrow({ where: { id: res.body.beneficiaryIds[0] } });
    expect(row.associationId).toBe(fx.associationAId); // فُرِضت جمعية الجلسة، تُجوهِل associationId المُرسَل
  });

  it('DELEGATE ممنوع من الاستيراد', async () => {
    const delegateCookie = await loginAsDelegate(app, base.delegateCode);
    const res = await http().post('/api/v1/beneficiaries/import').set('Cookie', delegateCookie).send({ acceptedPledge: true, rows: [importRow()], opId: newOpId('imp') });
    expect(res.status).toBe(403);
  });

  it('أكثر من 1000 صف يُرفَض 400 (سقف الحجم)', async () => {
    const rows = Array.from({ length: 1001 }, () => importRow());
    const res = await http().post('/api/v1/beneficiaries/import').set('Cookie', assocACookie).send({ acceptedPledge: true, rows, opId: newOpId('imp') });
    expect(res.status).toBe(400);
  });
});
