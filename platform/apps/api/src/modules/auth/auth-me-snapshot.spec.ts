import { jest } from '@jest/globals';
import { AccountRole, AgreementStatus, prisma } from '@alzad/db';
import { AuthService } from './auth.service';
import type { AuthContext } from './auth.types';
import type { RateLimitService } from '../../common/rate-limit.service';
import type { AuditService } from '../audit/audit.service';
import type { EmailService } from './email/email.service';

describe('GET /auth/me request-local snapshot', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    { role: AccountRole.ADMIN, associationId: null, covenantRequired: false, covenantStatus: null },
    { role: AccountRole.ASSOCIATION, associationId: 'association-id', covenantRequired: true, covenantStatus: AgreementStatus.SENT },
  ])('reuses verified $role account/covenant state without another database read', async ({ role, associationId, covenantRequired, covenantStatus }) => {
    const accountRead = jest.spyOn(prisma.account, 'findUniqueOrThrow');
    const covenantRead = jest.spyOn(prisma.projectParticipation, 'findUnique');
    const service = new AuthService({} as RateLimitService, {} as AuditService, {} as EmailService);
    const ctx: AuthContext = {
      accountId: 'account-id', role, associationId, sessionId: 'session-id', mustChangePassword: false,
      meSnapshot: { publicCode: 'USR-1', name: 'اختبار', covenantRequired, covenantStatus },
    };

    await expect(service.getMe(ctx)).resolves.toEqual({
      id: 'account-id', publicCode: 'USR-1', name: 'اختبار', role, associationId,
      mustChangePassword: false, covenantRequired, covenantStatus,
    });
    expect(accountRead).not.toHaveBeenCalled();
    expect(covenantRead).not.toHaveBeenCalled();
  });
});
