import { jest } from '@jest/globals';
import { prisma, AccountRole } from '@alzad/db';
import type { AuthContext } from '../auth/auth.types';
import { NonselectionNoticeService } from './nonselection-notice.controller';
import { decryptEmailDelivery, encryptEmailDelivery, type EmailDeliveryPayload } from '../auth/email/email.service';
import { NONSELECTION_BODY, NONSELECTION_SUBJECT, NONSELECTION_PROTECTED_CODES, nonselectionMarker } from './nonselection-notice.policy';

const admin: AuthContext = { accountId: 'admin', role: AccountRole.ADMIN, associationId: null, sessionId: 'session', mustChangePassword: false };
describe('nonselection notices never mutate business decisions', () => {
  afterEach(() => jest.restoreAllMocks());
  function fixture() {
    const app = { id: 'application', publicCode: 'APP-000001', name: 'جمعية نموذجية', email: 'recipient@example.org', resultingAssociationId: null as string | null };
    const tx = {
      $queryRaw: jest.fn(async () => []),
      account: { findUnique: jest.fn(async () => ({ role: 'ADMIN', status: 'ACTIVE', archivedAt: null, adminFullAccess: true })) },
      associationApplication: { findUnique: jest.fn(async () => app), count: jest.fn(async () => 0) },
      projectParticipation: { count: jest.fn(async () => 0) },
      auditLog: { findFirst: jest.fn(async (): Promise<unknown> => null), create: jest.fn(async () => ({})) },
      systemSetting: { findUnique: jest.fn(async (): Promise<unknown> => null), create: jest.fn(async () => ({})) },
      outboxEvent: { findMany: jest.fn(async (): Promise<Array<{ id: string; payload: unknown }>> => []), create: jest.fn(async (arg: { data: { id: string; payload: unknown } }) => { void arg; return {}; }) },
    };
    jest.spyOn(prisma, '$transaction').mockImplementation(async callback => { if (typeof callback !== 'function') throw Error('Expected transaction'); return callback(tx as never); });
    return { app, tx, service: new NonselectionNoticeService() };
  }
  it('queues the approved branded NOTICE in the same transaction with a stable campaign marker', async () => {
    const { service, tx } = fixture();
    expect(await service.queue(admin, ['application'])).toMatchObject({ ok: true, results: [{ status: 'QUEUED' }] });
    const data = tx.outboxEvent.create.mock.calls[0][0].data;
    expect(decryptEmailDelivery(data.id, data.payload as EmailDeliveryPayload)).toMatchObject({ kind: 'NOTICE', params: { to: 'recipient@example.org', body: NONSELECTION_BODY, subject: NONSELECTION_SUBJECT }, context: { type: 'nonselection', applicationId: 'application', markerKey: nonselectionMarker('application') } });
    expect(JSON.stringify(data)).not.toContain('recipient@example.org');
    expect(tx.systemSetting.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'NONSELECTION_NOTICE_QUEUED' }) }));
  });
  it.each(NONSELECTION_PROTECTED_CODES)('excludes approved/test application %s', async code => {
    const { service, tx, app } = fixture(); app.publicCode = code;
    expect(await service.queue(admin, ['application'])).toMatchObject({ results: [{ status: 'SKIPPED', reason: 'PROTECTED_ASSOCIATION' }] });
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
  it.each(['covenant', 'duplicate-email', 'previous-rejection', 'existing-association', 'invalid-email'])('excludes %s without email or business updates', async invalid => {
    const { service, tx, app } = fixture();
    if (invalid === 'covenant') tx.projectParticipation.count.mockResolvedValue(1);
    if (invalid === 'duplicate-email') tx.associationApplication.count.mockResolvedValue(1);
    if (invalid === 'previous-rejection') tx.auditLog.findFirst.mockResolvedValue({ id: 'old' });
    if (invalid === 'existing-association') app.resultingAssociationId = 'existing';
    if (invalid === 'invalid-email') app.email = 'invalid';
    expect(await service.queue(admin, ['application'])).toMatchObject({ results: [{ status: 'SKIPPED' }] });
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
  it('does not requeue any existing ownership marker', async () => {
    const { service, tx } = fixture(); tx.systemSetting.findUnique.mockResolvedValue({ value: { status: 'QUEUED', eventId: 'old' } });
    expect(await service.queue(admin, ['application'])).toMatchObject({ results: [{ status: 'ALREADY_OWNED' }] });
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
  it('preserves previous pending/uncertain rejection ownership', async () => {
    const { service, tx } = fixture();
    tx.outboxEvent.findMany.mockResolvedValue([{ id: 'old-event', payload: encryptEmailDelivery('old-event', 'NOTICE', { to: 'recipient@example.org', name: 'n', subject: 's', body: 'b' }, { type: 'rejection', applicationId: 'application' }) }]);
    expect(await service.queue(admin, ['application'])).toMatchObject({ results: [{ status: 'ALREADY_OWNED' }] });
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
  it('rejects unreadable earlier pending notices rather than guess about duplicate delivery', async () => {
    const { service, tx } = fixture(); tx.outboxEvent.findMany.mockResolvedValue([{ id: 'bad', payload: {} }]);
    await expect(service.queue(admin, ['application'])).rejects.toMatchObject({ code: 'NONSELECTION_DELIVERY_AUDIT_REQUIRED' });
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
  it('requires freshly verified full admin privileges', async () => {
    const { service, tx } = fixture(); tx.account.findUnique.mockResolvedValue({ role: 'ADMIN', status: 'ACTIVE', archivedAt: null, adminFullAccess: false });
    await expect(service.queue(admin, ['application'])).rejects.toMatchObject({ code: 'NONSELECTION_FULL_ADMIN_REQUIRED' });
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
  it('rejects duplicate/oversized batches before opening a transaction', async () => {
    const { service } = fixture();
    await expect(service.queue(admin, ['x','x'])).rejects.toMatchObject({ code: 'NONSELECTION_SCOPE_INVALID' });
    await expect(service.queue(admin, Array.from({ length: 11 }, (_, i) => String(i)))).rejects.toMatchObject({ code: 'NONSELECTION_SCOPE_INVALID' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('propagates queue/marker failure to roll back the entire batch', async () => {
    const { service, tx } = fixture(); tx.systemSetting.create.mockRejectedValue(new Error('marker failed'));
    await expect(service.queue(admin, ['application'])).rejects.toThrow('marker failed');
  });
});
