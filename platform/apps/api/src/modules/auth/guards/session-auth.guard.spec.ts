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
});
