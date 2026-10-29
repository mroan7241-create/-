import { jest } from '@jest/globals';
import ExcelJS from 'exceljs';
import { AccountRole, DeviceType, prisma } from '@alzad/db';
import { SIMPLE_BENEFICIARY_IMPORT_FIELDS } from '@alzad/shared';
import { BeneficiariesService, type BeneficiaryWriteInput } from './beneficiaries.service';
import type { AuthContext } from '../auth/auth.types';

const ctx = { role: AccountRole.ASSOCIATION, associationId: 'tenant-a', accountId: 'actor' } as AuthContext;
const references = [
  { id: 'region', type: 'REGION', value: 'مكة المكرمة', parentId: null },
  { id: 'city', type: 'CITY', value: 'جدة', parentId: 'region' },
  { id: 'social', type: 'SOCIAL_STATUS', value: 'أرملة', parentId: null },
];
const rows: Omit<BeneficiaryWriteInput, 'opId'>[] = Array.from({ length: 50 }, (_, i) => ({
  name: `اختبار ${i}`, region: 'مكة المكرمة', city: 'جدة', district: 'اختبار', phone: `05000000${String(i).padStart(2, '0')}`,
  familyCount: 5, socialStatus: 'أرملة', deviceTypes: [DeviceType.REFRIGERATOR, DeviceType.WASHING_MACHINE],
  needPriority: i + 1,
}));

describe('beneficiary batch preparation and atomic import', () => {
  afterEach(() => jest.restoreAllMocks());
  it('never permits test cleanup in a real association', async () => {
    const tx = { association: { findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({ name: 'جمعية حقيقية', participation: { application: { publicCode: 'APP-000319' } } }) }, beneficiary: { deleteMany: jest.fn() } };
    jest.spyOn(prisma, '$transaction').mockImplementation(callback => (callback as unknown as (client: typeof tx) => Promise<never>)(tx) as never);
    await expect(new BeneficiariesService(null!, null!, null!, null!).cleanupTestImport(ctx, ['one'])).rejects.toMatchObject({ code: 'TEST_IMPORT_SCOPE_INVALID' });
    expect(tx.beneficiary.deleteMany).not.toHaveBeenCalled();
  });
  it('rejects direct creation with three devices and no reason before any database write', async () => {
    const write = jest.spyOn(prisma, '$transaction');
    const service = new BeneficiariesService(null!, null!, null!, null!);
    await expect(service.createBeneficiary(ctx, { ...rows[0], deviceTypes: Object.values(DeviceType).filter(type => ['REFRIGERATOR', 'OVEN', 'WASHING_MACHINE'].includes(type)), opId: 'invalid-three' })).rejects.toMatchObject({ code: 'BENEFICIARY_THREE_DEVICE_REASON_REQUIRED' });
    expect(write).not.toHaveBeenCalled();
  });
  it('rejects repeated priorities or missing three-device reasons without partial writes', async () => {
    jest.spyOn(prisma.referenceValue, 'findMany').mockResolvedValue(references as never);
    const write = jest.spyOn(prisma, '$transaction');
    const service = new BeneficiariesService(null!, null!, null!, null!);
    const repeated = await service.importBeneficiaries(ctx, { rows: [rows[0], { ...rows[1], needPriority: 1 }], opId: 'duplicate-priority', acceptedPledge: true });
    expect(repeated).toMatchObject({ ok: false, errors: [expect.objectContaining({ row: 2, message: expect.stringContaining('مكرر') })] });
    const missing = await service.importBeneficiaries(ctx, { rows: [rows[0], { ...rows[1], deviceTypes: [DeviceType.REFRIGERATOR, DeviceType.OVEN, DeviceType.WASHING_MACHINE] }], opId: 'missing-three', acceptedPledge: true });
    expect(missing).toMatchObject({ ok: false, errors: [expect.objectContaining({ row: 2, message: expect.stringContaining('مبرر') })] });
    expect(write).not.toHaveBeenCalled();
  });
  it('validates 50 entries with one reference read, then checks duplicates after tenant locks and writes one atomic batch', async () => {
    const readReferences = jest.spyOn(prisma.referenceValue, 'findMany').mockResolvedValue(references as never);
    const tx = {
      association: { findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({ id: 'tenant-a' }) },
      $queryRaw: jest.fn<(strings: TemplateStringsArray) => Promise<unknown>>().mockImplementation(async strings => String(strings).includes('generate_series') ? rows.map((_, i) => ({ id: `id-${i}` })) : String(strings).includes('SELECT beneficiary_limit') ? [{ beneficiary_limit: 50 }] : []),
      $executeRaw: jest.fn<() => Promise<number>>().mockResolvedValue(1),
      beneficiary: { count: jest.fn<() => Promise<number>>().mockResolvedValue(0), findFirst: jest.fn<() => Promise<unknown>>().mockResolvedValue(null), createMany: jest.fn<() => Promise<unknown>>().mockResolvedValue({ count: 50 }) },
      beneficiaryNeed: { createMany: jest.fn<() => Promise<unknown>>().mockResolvedValue({ count: 100 }) },
    };
    const transaction = jest.spyOn(prisma, '$transaction').mockImplementation(callback => (callback as unknown as (client: typeof tx) => Promise<never>)(tx) as never);
    const service = new BeneficiariesService(
      { nextPublicCodes: jest.fn(async (_tx: unknown, prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}-${i}`)) } as never,
      { claim: jest.fn(async () => ({ claimed: true })), complete: jest.fn(async () => undefined) } as never,
      { log: jest.fn(async () => undefined) } as never, {} as never,
    );
    expect(await service.importBeneficiaries(ctx, { rows, opId: 'batch', acceptedPledge: true })).toMatchObject({ ok: true, createdCount: 50 });
    expect(readReferences).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.beneficiary.findFirst).toHaveBeenCalledTimes(2);
    expect(tx.beneficiary.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ associationId: 'tenant-a', archivedAt: null }) }));
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.beneficiary.findFirst.mock.invocationCallOrder[0]);
    expect(tx.$queryRaw.mock.invocationCallOrder[2]).toBeLessThan(tx.beneficiary.findFirst.mock.invocationCallOrder[1]);
    expect(tx.beneficiary.createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([expect.objectContaining({ id: 'id-49', associationId: 'tenant-a', city: 'جدة' })]) });
    expect(tx.beneficiaryNeed.createMany).toHaveBeenCalledWith({ data: expect.any(Array) });
  });
  it('retains a valid later row when an earlier row has a device conversion error, and maps validation errors to their original Excel row', async () => {
    jest.spyOn(BeneficiariesService.prototype, 'intakeStatus').mockResolvedValue({ limit: 50, count: 0, remaining: 50 });
    jest.spyOn(prisma.referenceValue, 'findMany').mockResolvedValue(references as never);
    const transaction = jest.spyOn(prisma, '$transaction');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('المستفيدون');
    sheet.addRow(SIMPLE_BENEFICIARY_IMPORT_FIELDS);
    sheet.addRow([1, 'أول', 'مكة المكرمة', 'جدة', 'حي', '0500000001', 4, 'أرملة', 'ربما', 'لا', 'نعم']);
    sheet.addRow([2, 'ثان', 'مكة المكرمة', 'جدة', 'حي', '0500000002', 4, 'أرملة', 'نعم', 'لا', 'نعم']);
    sheet.addRow([3, 'ثالث', 'مكة المكرمة', 'مدينة خاطئة', 'حي', '0500000003', 4, 'أرملة', 'نعم', 'لا', 'نعم']);
    const result = await new BeneficiariesService(null!, null!, null!, null!).previewXlsxImport(ctx, Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(result.rows.map(row => [row.row, row.valid])).toEqual([[2, false], [3, true], [4, false]]);
    expect(result.rows[0].error).toContain('نعم أو لا');
    expect(result.rows[2].error).toContain('منطقة ومدينة');
    expect(transaction).not.toHaveBeenCalled();
  });
});
