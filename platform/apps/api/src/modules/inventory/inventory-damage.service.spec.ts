import { jest } from '@jest/globals';
import { AccountRole, DamageCaseStatus, DeviceStatus, prisma } from '@alzad/db';
import { InventoryService } from './inventory.service';
import type { AuthContext } from '../auth/auth.types';
import type { IdempotencyService } from '../../common/idempotency.service';
import type { AuditService } from '../audit/audit.service';

const admin: AuthContext = { accountId: 'admin-id', associationId: null, role: AccountRole.ADMIN, sessionId: 'session', mustChangePassword: false };
const association: AuthContext = { ...admin, role: AccountRole.ASSOCIATION, associationId: 'association-a' };
const delegate: AuthContext = { ...admin, role: AccountRole.DELEGATE, associationId: 'association-a' };

function fixture() {
  type CaseRecord = { status: DamageCaseStatus; associationId: string; returnRequired: boolean; returnedAt: Date | null; replacementExpected: boolean; replacementReceivedAt: Date | null };
  let current: CaseRecord = { status: DamageCaseStatus.OPEN, associationId: 'association-a', returnRequired: false, returnedAt: null, replacementExpected: false, replacementReceivedAt: null };
  const tx = {
    $queryRaw: jest.fn<() => Promise<unknown>>().mockResolvedValue([{ id: 'case-id' }]),
    damageCase: {
      findUnique: jest.fn<() => Promise<unknown>>().mockImplementation(async () => current),
      update: jest.fn<(args: { data: Partial<CaseRecord> }) => Promise<unknown>>().mockImplementation(async (args) => { current = { ...current, ...args.data }; return current; }),
      create: jest.fn<() => Promise<unknown>>().mockResolvedValue({ id: 'case-id' }),
    },
    deviceUnit: {
      findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({ status: DeviceStatus.WAREHOUSE, associationId: 'association-a' }),
      update: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
    },
    auditLog: { create: jest.fn<() => Promise<unknown>>().mockResolvedValue({}) },
  };
  const idem = {
    claim: jest.fn<() => Promise<unknown>>().mockResolvedValue({ claimed: true }),
    complete: jest.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
  };
  const audit = { log: jest.fn<() => Promise<unknown>>().mockResolvedValue(undefined) };
  const transaction = jest.spyOn(prisma, '$transaction').mockImplementation((callback) =>
    (callback as unknown as (client: typeof tx) => Promise<never>)(tx) as never);
  const service = new InventoryService(idem as unknown as IdempotencyService, audit as unknown as AuditService);
  return { service, tx, idem, audit, transaction, setCase: (changes: Partial<typeof current>) => { current = { ...current, ...changes }; } };
}

describe('damage case administrative workflow', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects a non-admin decision before any database transaction', async () => {
    const { service, transaction } = fixture();
    await expect(service.decideDamageCase(association, 'case-id', { status: DamageCaseStatus.UNDER_REVIEW, opId: 'op' })).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('scopes association reads to its own tenant even when another associationId is supplied', async () => {
    const { service } = fixture();
    const findMany = jest.spyOn(prisma.damageCase, 'findMany').mockResolvedValue([]);
    const count = jest.spyOn(prisma.damageCase, 'count').mockResolvedValue(0);
    await service.listDamageCases(association, { associationId: 'association-b', page: 1, pageSize: 25 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { associationId: 'association-a' } }));
    expect(count).toHaveBeenCalledWith({ where: { associationId: 'association-a' } });
    await expect(service.listDamageCases(delegate, {})).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
  });

  it('requires review, a written settlement, then an explicit close with audit', async () => {
    const { service, tx } = fixture();
    await expect(service.decideDamageCase(admin, 'case-id', { status: DamageCaseStatus.CLOSED, opId: 'skip' })).rejects.toMatchObject({ code: 'DAMAGE_TRANSITION_INVALID' });
    await service.decideDamageCase(admin, 'case-id', { status: DamageCaseStatus.UNDER_REVIEW, opId: 'review' });
    await expect(service.decideDamageCase(admin, 'case-id', { status: DamageCaseStatus.SETTLED, opId: 'blank' })).rejects.toMatchObject({ code: 'DAMAGE_RESOLUTION_REQUIRED' });
    await service.decideDamageCase(admin, 'case-id', { status: DamageCaseStatus.SETTLED, resolution: 'تم اعتماد معالجة المورد', opId: 'settle' });
    await service.decideDamageCase(admin, 'case-id', { status: DamageCaseStatus.CLOSED, opId: 'close' });
    expect(tx.damageCase.update).toHaveBeenCalledTimes(3);
    expect(tx.damageCase.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: DamageCaseStatus.CLOSED, closedById: 'admin-id', closedAt: expect.any(Date) }) }));
    expect(tx.auditLog.create).toHaveBeenCalledTimes(3);
  });

  it('does not settle when a required return or replacement lacks confirmation', async () => {
    const { service, tx, setCase } = fixture();
    setCase({ status: DamageCaseStatus.UNDER_REVIEW, returnRequired: true });
    await expect(service.decideDamageCase(admin, 'case-id', { status: DamageCaseStatus.SETTLED, resolution: 'قرار', opId: 'return' })).rejects.toMatchObject({ code: 'DAMAGE_RETURN_REQUIRED' });
    setCase({ returnRequired: false, replacementExpected: true });
    await expect(service.decideDamageCase(admin, 'case-id', { status: DamageCaseStatus.SETTLED, resolution: 'قرار', opId: 'replacement' })).rejects.toMatchObject({ code: 'DAMAGE_REPLACEMENT_REQUIRED' });
    expect(tx.damageCase.update).not.toHaveBeenCalled();
  });

  it('replays a completed request without writing the case or audit again', async () => {
    const { service, tx, idem } = fixture();
    idem.claim.mockResolvedValue({ claimed: false, existingResponse: { ok: true, status: DamageCaseStatus.UNDER_REVIEW } });
    await expect(service.decideDamageCase(admin, 'case-id', { status: DamageCaseStatus.UNDER_REVIEW, opId: 'same' })).resolves.toEqual({ ok: true, status: DamageCaseStatus.UNDER_REVIEW });
    expect(tx.damageCase.findUnique).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('opens a damage case atomically when an administrator marks a warehouse device damaged', async () => {
    const { service, tx } = fixture();
    await service.markDeviceDamaged(admin, 'device-id', { opId: 'mark', notes: 'انكسار الغلاف' });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.deviceUnit.findUnique.mock.invocationCallOrder[0]);
    expect(tx.deviceUnit.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: DeviceStatus.DAMAGED }) }));
    expect(tx.damageCase.create).toHaveBeenCalledWith({ data: { deviceId: 'device-id', associationId: 'association-a', quantity: 1, description: 'انكسار الغلاف' } });
  });

  it('rejects a second distinct operation after the locked device has become damaged', async () => {
    const { service, tx } = fixture();
    let status: DeviceStatus = DeviceStatus.WAREHOUSE;
    tx.deviceUnit.findUnique.mockImplementation(async () => ({ status, associationId: 'association-a' }));
    tx.deviceUnit.update.mockImplementation(async () => { status = DeviceStatus.DAMAGED; return {}; });
    await service.markDeviceDamaged(admin, 'device-id', { opId: 'first' });
    await expect(service.markDeviceDamaged(admin, 'device-id', { opId: 'second' })).rejects.toMatchObject({ code: 'DEVICE_NOT_EDITABLE' });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.damageCase.create).toHaveBeenCalledTimes(1);
  });
});
