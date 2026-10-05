import { jest } from '@jest/globals';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { AccountRole, AgreementStatus, ParticipationStatus, prisma } from '@alzad/db';
import { authConfig } from '../../../config/auth.config';
import { SessionAuthGuard } from './session-auth.guard';

describe('session guard request-local account snapshot', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reuses the already checked association and covenant state for /auth/me', async () => {
    const request: Record<string, unknown> = {
      cookies: { [authConfig.sessionCookieName]: 'test-token' },
      method: 'GET', originalUrl: '/api/v1/auth/me',
    };
    jest.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({
      id: 'session-id', revokedAt: null, expiresAt: new Date(Date.now() + 3_999_000),
      absoluteExpiresAt: new Date(Date.now() + 4_000_000), lastSeenAt: new Date(),
      account: {
        id: 'account-id', publicCode: 'USR-1', name: 'جمعية اختبار', status: 'ACTIVE',
        role: AccountRole.ASSOCIATION, associationId: 'association-id', mustChangePassword: false,
        association: { status: 'ACTIVE' },
      },
    } as never);
    const covenantRead = jest.spyOn(prisma.projectParticipation, 'findUnique').mockResolvedValue({
      status: ParticipationStatus.ACTIVE, agreements: [{ status: AgreementStatus.SIGNED }],
    } as never);
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const executionContext = {
      getHandler: () => undefined, getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    await expect(new SessionAuthGuard(reflector).canActivate(executionContext)).resolves.toBe(true);
    expect(covenantRead).toHaveBeenCalledTimes(1);
    expect(request.authContext).toMatchObject({
      accountId: 'account-id', role: AccountRole.ASSOCIATION,
      meSnapshot: { publicCode: 'USR-1', name: 'جمعية اختبار', covenantRequired: false, covenantStatus: AgreementStatus.SIGNED },
    });
  });

  const states = Object.values(ParticipationStatus);
  const agreements = [null, ...Object.values(AgreementStatus)];
  const requests = [
    { method: 'GET', path: '/beneficiaries', closure: false, read: true },
    { method: 'POST', path: '/beneficiaries', closure: false, read: false },
    { method: 'POST', path: '/reports/closure/organization/generate', closure: true, read: false },
    { method: 'PATCH', path: '/reports/closure/organization/0195aa00-0000-7000-8000-000000000001', closure: true, read: false },
  ];
  it.each(states.flatMap((status) => agreements.flatMap((agreement) => requests.map((route) => ({ status, agreement, ...route })))))('$status / $agreement / $method $path preserves covenant and closure boundaries', async ({ status, agreement, method, path, closure, read }) => {
      jest.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({
        id: 'session', revokedAt: null, expiresAt: new Date(Date.now() + 6 * 3600_000),
        absoluteExpiresAt: new Date(Date.now() + 12 * 3600_000), lastSeenAt: new Date(),
        account: { id: 'account', publicCode: 'ASC-1', name: 'اختبار', role: AccountRole.ASSOCIATION,
          associationId: 'association', association: { status: 'ACTIVE' }, status: 'ACTIVE', archivedAt: null, mustChangePassword: false },
      } as never);
      jest.spyOn(prisma.projectParticipation, 'findUnique').mockResolvedValue({ status, agreements: agreement ? [{ status: agreement }] : [] } as never);
      const request = { cookies: { [authConfig.sessionCookieName]: 'synthetic' }, method, originalUrl: `/api/v1${path}`, authContext: undefined };
      const ctx = { getHandler: () => undefined, getClass: () => undefined, switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
      const guard = new SessionAuthGuard({ getAllAndOverride: () => undefined } as unknown as Reflector);
      const eligible = agreement === AgreementStatus.SIGNED && ['ACTIVE', 'EXECUTING', 'READY_TO_CLOSE', 'CLOSURE_SUBMITTED', 'CLOSED'].includes(status);
      const frozen = ['READY_TO_CLOSE', 'CLOSURE_SUBMITTED', 'CLOSED'].includes(status);
      if (!eligible) await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'COVENANT_EXECUTION_REQUIRED' });
      else if (frozen && !closure && !read) await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'PARTICIPATION_CLOSURE_IN_PROGRESS' });
      else {
        await expect(guard.canActivate(ctx)).resolves.toBe(true);
        expect(request.authContext).toMatchObject({ meSnapshot: { covenantRequired: false, covenantStatus: AgreementStatus.SIGNED } });
      }
    });
});
