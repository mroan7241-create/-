import { jest } from '@jest/globals';
import { ValidationPipe } from '@nestjs/common';
import { AccountRole, prisma } from '@alzad/db';
import { AccountsService } from './accounts.service';
import { CreateAdminAccountDto, UpdateAdminAccountDto } from './dto/admin-account.dto';
import type { AuthContext } from '../auth/auth.types';

describe('owner-managed named administrative accounts', () => {
  const ctx = { accountId: 'owner-id', role: AccountRole.ADMIN, associationId: null } as AuthContext;
  let owner: { publicCode: string; role: AccountRole; status: string; archivedAt: null; adminFullAccess: boolean };
  let staff: { id: string; publicCode: string; name: string; adminFullAccess: boolean; adminPermissions: string[] };
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
      passwordResetToken: { updateMany: jest.fn(async () => ({ count: 1 })) },
      auditLog: { create: jest.fn(async () => ({})) },
    };
  }
  beforeEach(() => {
    owner = { publicCode: 'ADM-000001', role: AccountRole.ADMIN, status: 'ACTIVE', archivedAt: null, adminFullAccess: true };
    staff = { id: 'staff-id', publicCode: 'ADM-000002', name: 'موظف اختبار', adminFullAccess: false, adminPermissions: ['applications.read'] };
    tx = client();
    jest.spyOn(prisma.account, 'findUnique').mockImplementation((async () => owner) as never);
    jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (client: unknown) => Promise<unknown>) => callback(tx)) as never);
    service = new AccountsService({ nextPublicCode: jest.fn(async () => 'ADM-000003') } as never, {} as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('creates a named restricted ADMIN with same-domain normalized grants and no secret audit metadata', async () => {
    const result = await service.createAdmin(ctx, { name: 'موظف جديد', email: 'staff@example.org', adminPermissions: ['applications.evaluate'] });
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
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ metadata: { name: staff.name, previousPermissions: ['applications.read'], adminPermissions: [] } }) });
  });

  it('suspends and revokes sessions inside the audited transaction', async () => {
    await service.setAdminStatus(ctx, staff.id, 'SUSPENDED');
    expect(tx.authSession.updateMany).toHaveBeenCalledWith({ where: { accountId: staff.id, revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'ADMIN_ACCOUNT_SUSPENDED' }) });
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
      await expect(pipe.transform({ name: 'موظف جديد', email: 'staff@example.org', adminPermissions: [], ...extra }, { type: 'body', metatype: CreateAdminAccountDto })).rejects.toThrow();
    }
    await expect(pipe.transform({ email: 'changed@example.org' }, { type: 'body', metatype: UpdateAdminAccountDto })).rejects.toThrow();
    await expect(pipe.transform({ adminPermissions: ['unrecognized'] }, { type: 'body', metatype: UpdateAdminAccountDto })).rejects.toThrow();
  });
});
