import { jest } from '@jest/globals';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { AccountRole, prisma } from '@alzad/db';
import { SessionAuthGuard } from './session-auth.guard';
import { ALLOW_MUST_CHANGE_PASSWORD_KEY } from '../decorators/allow-must-change-password.decorator';
import { authConfig } from '../../../config/auth.config';

describe('ADMIN permissions at the existing session boundary', () => {
  let account: { id: string; publicCode: string; name: string; role: AccountRole; associationId: null; status: string; archivedAt: null; mustChangePassword: boolean; adminFullAccess: boolean; adminPermissions: string[]; adminApplicationScope?: unknown };
  let request: { method: string; originalUrl: string; route: { path: string }; cookies: Record<string, string>; authContext?: unknown };
  let allowPassword: boolean;
  let guard: SessionAuthGuard;
  function context() { return { getHandler: () => undefined, getClass: () => undefined, switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext; }
  beforeEach(() => {
    account = { id: 'staff-id', publicCode: 'ADM-000002', name: 'موظف محدد', role: AccountRole.ADMIN, associationId: null, status: 'ACTIVE', archivedAt: null, mustChangePassword: false, adminFullAccess: false, adminPermissions: [] };
    request = { method: 'GET', originalUrl: '/api/v1/association-applications', route: { path: '/api/v1/association-applications' }, cookies: { [authConfig.sessionCookieName]: 'same-cookie' } };
    allowPassword = false;
    jest.spyOn(prisma.authSession, 'findUnique').mockImplementation((async () => ({ id: 'session', revokedAt: null, expiresAt: new Date(Date.now() + 6 * 3600_000), absoluteExpiresAt: new Date(Date.now() + 12 * 3600_000), lastSeenAt: new Date(), account })) as never);
    guard = new SessionAuthGuard({ getAllAndOverride: (key: string) => key === ALLOW_MUST_CHANGE_PASSWORD_KEY ? allowPassword : undefined } as unknown as Reflector);
  });
  afterEach(() => jest.restoreAllMocks());

  it('denies a new ADMIN with zero grants, and allows only the granted read', async () => {
    await expect(guard.canActivate(context())).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
    account.adminPermissions = ['applications.read'];
    await expect(guard.canActivate(context())).resolves.toBe(true);
    request.method = 'POST'; request.route.path = '/api/v1/association-applications/:id/evaluation';
    await expect(guard.canActivate(context())).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
  });

  it('does not let an evaluator select or use legacy business/owner management alternatives', async () => {
    account.adminPermissions = ['applications.evaluate']; request.method = 'POST';
    request.route.path = '/api/v1/association-applications/:id/evaluation';
    await expect(guard.canActivate(context())).resolves.toBe(true);
    for (const path of ['/association-applications/:id/selection-decision', '/association-applications/:id/review', '/association-applications/selection/commit', '/accounts/admins']) {
      request.route.path = `/api/v1${path}`;
      await expect(guard.canActivate(context())).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
    }
  });

  it('checks grants from the current account with the same existing session each request', async () => {
    account.adminPermissions = ['applications.read'];
    await expect(guard.canActivate(context())).resolves.toBe(true);
    account.adminPermissions = [];
    await expect(guard.canActivate(context())).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
    expect(prisma.authSession.findUnique).toHaveBeenCalledTimes(2);
  });

  it('requires a staff temporary password change and keeps own lifecycle reachable', async () => {
    account.adminPermissions = ['applications.read']; account.mustChangePassword = true;
    await expect(guard.canActivate(context())).rejects.toMatchObject({ code: 'AUTH_PASSWORD_CHANGE_REQUIRED' });
    request.route.path = '/api/v1/auth/me'; allowPassword = true;
    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(request.authContext).toMatchObject({ adminFullAccess: false, adminPermissions: ['applications.read'], meSnapshot: { name: 'موظف محدد' } });
  });

  it('uses the current regional scope without a session cache and rejects malformed persisted scope', async () => {
    account.adminPermissions = ['applications.read']; account.adminApplicationScope = { regionCodes: ['0001'] };
    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(request.authContext).toMatchObject({ adminApplicationScope: { regionCodes: ['0001'] } });
    account.adminApplicationScope = { regionCodes: ['0013'] };
    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(request.authContext).toMatchObject({ adminApplicationScope: { regionCodes: ['0013'] } });
    account.adminApplicationScope = { allRegions: false };
    await expect(guard.canActivate(context())).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
  });

  it('allows full ADMIN access without expanding another role, and rejects unknown staff endpoints', async () => {
    request.route.path = '/api/v1/new-unknown-controller';
    await expect(guard.canActivate(context())).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
    account.adminFullAccess = true;
    await expect(guard.canActivate(context())).resolves.toBe(true);
    account.role = AccountRole.ABANMI;
    await expect(guard.canActivate(context())).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
  });
});
