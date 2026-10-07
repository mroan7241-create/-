import { jest } from '@jest/globals';
import { ValidationPipe } from '@nestjs/common';
import { AccountRole, prisma } from '@alzad/db';
import { AccountsService } from './accounts.service';
import { CreateAdminAccountDto, UpdateAdminAccountDto } from './dto/admin-account.dto';
import type { AuthContext } from '../auth/auth.types';
import { decryptEmailDelivery, type EmailDeliveryPayload } from '../auth/email/email.service';

describe('owner-managed named administrative accounts', () => {
  const ctx = { accountId: 'owner-id', role: AccountRole.ADMIN, associationId: null } as AuthContext;
  let owner: { publicCode: string; role: AccountRole; status: string; archivedAt: null; adminFullAccess: boolean };
  let staff: { id: string; publicCode: string; name: string; email: string; status: string; mustChangePassword: boolean; lastLoginAt: Date | null; adminFullAccess: boolean; adminPermissions: string[] };
  let tx: ReturnType<typeof client>;
  let service: AccountsService;
  function client() {
    return {
      account: {
        findUnique: jest.fn(async () => owner), findFirst: jest.fn(async () => staff),
        create: jest.fn(async (input: unknown) => ({ id: 'new-staff', ...(input as { data: object }).data })),
        update: jest.fn(async () => ({})),
      },
      authCredential: { findUnique: jest.fn(async () => null), create: jest.fn(async () => ({})), findFirst: jest.fn(async () => ({ id: 'credential-id', secretHash: 'old-hash' })), update: jest.fn(async () => ({})) },
      authSession: { updateMany: jest.fn(async () => ({ count: 2 })) },
      passwordResetToken: { updateMany: jest.fn(async () => ({ count: 1 })), findMany: jest.fn(async () => [{ id: 'previous-token' }]), create: jest.fn(async () => ({ id: 'new-token' })) },
      outboxEvent: { create: jest.fn(async (input: unknown) => input) },
      auditLog: { create: jest.fn(async () => ({})), findFirst: jest.fn(async (): Promise<{ id: string } | null> => null) },
      $queryRaw: jest.fn(async () => []),
    };
  }
  beforeEach(() => {
    owner = { publicCode: 'ADM-000001', role: AccountRole.ADMIN, status: 'ACTIVE', archivedAt: null, adminFullAccess: true };
    staff = { id: 'staff-id', publicCode: 'ADM-000002', name: 'موظف اختبار', email: 'staff@example.org', status: 'ACTIVE', mustChangePassword: true, lastLoginAt: null, adminFullAccess: false, adminPermissions: ['applications.read'] };
    tx = client();
    jest.spyOn(prisma.account, 'findUnique').mockImplementation((async () => owner) as never);
    jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (client: unknown) => Promise<unknown>) => callback(tx)) as never);
    service = new AccountsService({ nextPublicCode: jest.fn(async () => 'ADM-000003') } as never, {} as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('creates a named restricted ADMIN with same-domain normalized grants and no secret audit metadata', async () => {
    const result = await service.createAdmin(ctx, { name: 'موظف جديد', email: 'staff@example.org', adminPermissions: ['applications.evaluate'], adminApplicationScope: { allRegions: true } });
    expect(result.accountId).toBe('new-staff');
    expect(result.temporaryPassword.length).toBeGreaterThan(10);
    expect(tx.account.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: 'موظف جديد', role: 'ADMIN', adminFullAccess: false, adminPermissions: ['applications.read', 'applications.evaluate'], mustChangePassword: true }) });
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain(result.temporaryPassword);
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorAccountId: ctx.accountId, action: 'ADMIN_ACCOUNT_CREATED' }) });
  });

  it('does not authorize another full-access ADMIN to manage staff', async () => {
    owner.publicCode = 'ADM-000010';
    await expect(service.updateAdmin(ctx, staff.id, { name: 'محاولة' })).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
    expect(tx.account.update).not.toHaveBeenCalled();
  });

  it('atomically queues a secure named staff invitation on creation without exposing it in audit', async () => {
    const result = await service.createAdmin(ctx, { name: 'موظف جديد', email: 'STAFF@example.org', adminPermissions: ['applications.evaluate'], adminApplicationScope: { regionCodes: ['0001'] } });
    expect(result).toMatchObject({ emailQueued: true });
    expect(tx.outboxEvent.create).toHaveBeenCalledTimes(1);
    const event = (tx.outboxEvent.create.mock.calls[0]![0] as { data: { id: string; payload: EmailDeliveryPayload } }).data;
    const delivery = decryptEmailDelivery(event.id, event.payload);
    expect(delivery).toMatchObject({ kind: 'PASSWORD_RESET', params: { to: 'staff@example.org', name: 'موظف جديد', adminInvitation: true }, context: { type: 'reset', accountId: 'new-staff', tokenId: 'new-token', predecessorIds: ['previous-token'] } });
    const code = (delivery.params as { code: string }).code;
    expect(code).toMatch(/^RST-[A-Z0-9]{32}$/);
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain(code);
    expect(JSON.stringify(event.payload)).not.toContain(code);
    expect(tx.passwordResetToken.updateMany).not.toHaveBeenCalled();
  });

  it('resends only an unactivated staff invitation under an account lock, preserving credentials, grants, sessions and prior links', async () => {
    await expect(service.sendAdminInvitation(ctx, staff.id)).resolves.toEqual({ ok: true, emailQueued: true });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.account.update).not.toHaveBeenCalled();
    expect(tx.authCredential.update).not.toHaveBeenCalled();
    expect(tx.authSession.updateMany).not.toHaveBeenCalled();
    expect(tx.passwordResetToken.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'ADMIN_ACCOUNT_INVITED', entityId: staff.id }) });
    const event = (tx.outboxEvent.create.mock.calls[0]![0] as { data: { id: string; payload: EmailDeliveryPayload } }).data;
    expect(decryptEmailDelivery(event.id, event.payload)).toMatchObject({ params: { adminInvitation: true, to: staff.email, name: staff.name }, context: { accountId: staff.id, credentialHash: 'old-hash', predecessorIds: ['previous-token'] } });
  });

  it.each(['owner', 'suspended', 'already-activated', 'already-logged-in', 'missing-credential', 'recent-invitation'])('does not queue an invitation for %s', async (reason) => {
    if (reason === 'owner') { staff.publicCode = 'ADM-000001'; staff.adminFullAccess = true; }
    if (reason === 'suspended') staff.status = 'SUSPENDED';
    if (reason === 'already-activated') staff.mustChangePassword = false;
    if (reason === 'already-logged-in') staff.lastLoginAt = new Date();
    if (reason === 'missing-credential') tx.authCredential.findFirst.mockResolvedValue(null as never);
    if (reason === 'recent-invitation') tx.auditLog.findFirst.mockResolvedValue({ id: 'recent' });
    await expect(service.sendAdminInvitation(ctx, staff.id)).rejects.toBeDefined();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
    expect(tx.authCredential.update).not.toHaveBeenCalled();
  });

  it('rejects invitation requests from another administrator', async () => {
    owner.publicCode = 'ADM-000010';
    await expect(service.sendAdminInvitation(ctx, staff.id)).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it.each(['update', 'status', 'reset'])('protects the owner against %s through staff management', async (operation) => {
    staff.publicCode = 'ADM-000001'; staff.adminFullAccess = true;
    const action = operation === 'update' ? service.updateAdmin(ctx, staff.id, { adminPermissions: [] }) : operation === 'status' ? service.setAdminStatus(ctx, staff.id, 'SUSPENDED') : service.resetAdminPassword(ctx, staff.id);
    await expect(action).rejects.toMatchObject({ code: 'ADMIN_OWNER_PROTECTED' });
    expect(tx.account.update).not.toHaveBeenCalled();
    expect(tx.authSession.updateMany).not.toHaveBeenCalled();
  });

  it('removes grants on the account without storing a second session permission snapshot', async () => {
    await expect(service.updateAdmin(ctx, staff.id, { adminPermissions: [] })).resolves.toEqual({ ok: true });
    expect(tx.account.update).toHaveBeenCalledWith({ where: { id: staff.id }, data: { adminPermissions: [] } });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ metadata: expect.objectContaining({ name: staff.name, previousPermissions: ['applications.read'], adminPermissions: [] }) }) });
  });

  it('suspends and revokes sessions inside the audited transaction', async () => {
    await service.setAdminStatus(ctx, staff.id, 'SUSPENDED');
    expect(tx.authSession.updateMany).toHaveBeenCalledWith({ where: { accountId: staff.id, revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'ADMIN_ACCOUNT_SUSPENDED' }) });
  });

  it('requires explicit scope for new accounts, rejects escalation and preserves legacy scope on unrelated edits', async () => {
    for (const adminApplicationScope of [undefined, null, {}, { regionCodes: [] }, { regionCodes: ['0001', '0001'] }, { allRegions: true, extra: true }]) {
      await expect(service.createAdmin(ctx, { name: 'موظف جديد', email: 'staff@example.org', adminPermissions: [], adminApplicationScope } as CreateAdminAccountDto)).rejects.toMatchObject({ code: 'ADMIN_APPLICATION_SCOPE_INVALID' });
    }
    expect(tx.account.create).not.toHaveBeenCalled();
    await service.updateAdmin(ctx, staff.id, { name: 'موظف معدل' });
    expect(tx.account.update).toHaveBeenCalledWith({ where: { id: staff.id }, data: { name: 'موظف معدل' } });
    await service.updateAdmin(ctx, staff.id, { adminApplicationScope: { regionCodes: ['0013', '0001'] } });
    expect(tx.account.update).toHaveBeenCalledWith({ where: { id: staff.id }, data: { adminApplicationScope: { regionCodes: ['0001', '0013'] } } });
    await expect(service.updateAdmin(ctx, staff.id, { adminApplicationScope: null } as unknown as UpdateAdminAccountDto)).rejects.toMatchObject({ code: 'ADMIN_APPLICATION_SCOPE_INVALID' });
  });

  it('resets password, forces change, consumes reset tokens and revokes all sessions in one transaction', async () => {
    const result = await service.resetAdminPassword(ctx, staff.id);
    expect(tx.authCredential.update).toHaveBeenCalledWith({ where: { id: 'credential-id' }, data: { previousSecretHash: 'old-hash', secretHash: expect.stringContaining('$argon2id$') } });
    expect(tx.account.update).toHaveBeenCalledWith({ where: { id: staff.id }, data: { mustChangePassword: true } });
    expect(tx.authSession.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.passwordResetToken.updateMany).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain(result.temporaryPassword);
  });

  it('rejects privilege, role, owner and email mutation fields through the existing strict validation pipeline', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    for (const extra of [{ adminFullAccess: true }, { role: 'ADMIN' }, { associationId: 'association' }, { owner: true }]) {
      await expect(pipe.transform({ name: 'موظف جديد', email: 'staff@example.org', adminPermissions: [], adminApplicationScope: { allRegions: true }, ...extra }, { type: 'body', metatype: CreateAdminAccountDto })).rejects.toThrow();
    }
    await expect(pipe.transform({ email: 'changed@example.org' }, { type: 'body', metatype: UpdateAdminAccountDto })).rejects.toThrow();
    await expect(pipe.transform({ adminPermissions: ['unrecognized'] }, { type: 'body', metatype: UpdateAdminAccountDto })).rejects.toThrow();
  });
});
