import { jest } from '@jest/globals';
import { AccountRole, prisma } from '@alzad/db';
import { AccountsService } from './accounts.service';
import type { AuthContext } from '../auth/auth.types';
import { decryptEmailDelivery, type EmailDeliveryPayload } from '../auth/email/email.service';

describe('owner-only signer provisioning without password disclosure or repeat mail', () => {
  afterEach(() => jest.restoreAllMocks());
  const ctx = { accountId: 'owner', role: AccountRole.ADMIN } as AuthContext;
  function setup(existing: object | null = null) {
    const owner = { publicCode: 'ADM-000001', role: AccountRole.ADMIN, status: 'ACTIVE', adminFullAccess: true, archivedAt: null };
    const tx = {
      $executeRaw: jest.fn(async () => 1),
      account: { findUnique: jest.fn(async () => owner), findFirst: jest.fn(async () => null), create: jest.fn(async () => ({ id: 'signer' })) },
      authCredential: { findUnique: jest.fn(async () => existing ? { account: existing } : null), create: jest.fn(async () => ({})) },
      passwordResetToken: { create: jest.fn(async () => ({ id: 'reset-token' })) },
      outboxEvent: { create: jest.fn(async (input: unknown) => input) },
      participationAgreement: { findMany: jest.fn(async () => [{ id: 'pending-agreement' }]), updateMany: jest.fn(async () => ({ count: 1 })) },
      auditLog: { create: jest.fn(async () => ({})) },
    };
    jest.spyOn(prisma.account, 'findUnique').mockResolvedValue(owner as never);
    jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (client: unknown) => Promise<unknown>) => callback(tx)) as never);
    const service = new AccountsService({ nextPublicCode: jest.fn(async () => 'USR-TEST') } as never, {} as never);
    return { service, tx };
  }
  it('creates only a restricted signer and encrypts one setup invitation in the same transaction', async () => {
    const { service, tx } = setup();
    expect(await service.provisionCovenantSigner(ctx)).toMatchObject({ accountId: 'signer', emailQueued: true, assignedCount: 1 });
    expect(tx.account.create).toHaveBeenCalledWith({ data: expect.objectContaining({ role: AccountRole.COVENANT_SIGNER, email: 'malyahya@alzaad.org.sa', mustChangePassword: true, adminFullAccess: false, adminPermissions: [] }) });
    const event = (tx.outboxEvent.create.mock.calls[0][0] as { data: { id: string; payload: EmailDeliveryPayload } }).data;
    const delivery = decryptEmailDelivery(event.id, event.payload);
    expect(delivery).toMatchObject({ kind: 'PASSWORD_RESET', params: { to: 'malyahya@alzaad.org.sa', signerInvitation: true, code: expect.stringMatching(/^RST-[A-Z0-9]{32}$/) } });
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain('RST-');
    expect(tx.participationAgreement.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'SIGNED_BY_ORG', assignedSignerId: null }), data: { assignedSignerId: 'signer' } }));
  });
  it('does not reset existing signer credentials or send another invitation on replay', async () => {
    const { service, tx } = setup({ id: 'signer', role: AccountRole.COVENANT_SIGNER, status: 'ACTIVE', archivedAt: null, associationId: null, adminFullAccess: false });
    expect(await service.provisionCovenantSigner(ctx)).toMatchObject({ emailQueued: false });
    expect(tx.account.create).not.toHaveBeenCalled(); expect(tx.authCredential.create).not.toHaveBeenCalled(); expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
  it('refuses an email belonging to another role without changing it', async () => {
    const { service, tx } = setup({ role: AccountRole.ADMIN });
    await expect(service.provisionCovenantSigner(ctx)).rejects.toMatchObject({ code: 'SIGNER_ACCOUNT_CONFLICT' });
    expect(tx.account.create).not.toHaveBeenCalled(); expect(tx.participationAgreement.updateMany).not.toHaveBeenCalled(); expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
  it('refuses non-owner provisioning', async () => {
    const { service, tx } = setup();
    await expect(service.provisionCovenantSigner({ ...ctx, role: AccountRole.COVENANT_SIGNER })).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
    expect(tx.account.create).not.toHaveBeenCalled();
  });
});
