import { jest } from '@jest/globals';
import { ApplicationDraftStatus, prisma } from '@alzad/db';
import { sha256Hex } from '../../common/crypto.util';
import { RateLimitService } from '../../common/rate-limit.service';
import { PublicCodeService } from '../../common/public-code.service';
import { IdempotencyService } from '../../common/idempotency.service';
import { EmailService } from '../auth/email/email.service';
import { StorageService } from '../files/storage.service';
import { SettingsService } from '../settings/settings.service';
import { ApplicationAccessService, APPLICANT_SESSION_TTL_SECONDS } from './application-access.service';
import { ApplicationV2Service } from './application-v2.service';

describe('applicant credential lifetime and authorization', () => {
  const rateLimit = { consume: async () => undefined } as unknown as RateLimitService;
  const access = new ApplicationAccessService(rateLimit, {} as EmailService);
  const resumeToken = 'r'.repeat(43);
  const draftCode = 'DRF-000001';
  const draftId = 'draft-id';

  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

  it('creates a hashed draft-scoped session with exactly the initial 45-day draft deadline', async () => {
    const expiresAt = new Date(Date.now() + 45 * 86_400_000);
    const sessionCreate = jest.fn<() => Promise<object>>().mockResolvedValue({});
    const draftCreate = jest.fn<() => Promise<object>>().mockResolvedValue({ id: draftId, publicCode: draftCode, revision: 0, expiresAt });
    const transaction = { associationApplicationDraft: { create: draftCreate }, applicationApplicantSession: { create: sessionCreate } };
    jest.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
      if (typeof callback !== 'function') throw new Error('Expected interactive transaction');
      return callback(transaction as never);
    });
    const service = new ApplicationV2Service(
      { nextPublicCode: async () => draftCode } as unknown as PublicCodeService,
      {} as IdempotencyService, {} as StorageService, rateLimit, access,
      { assertApplicationIntakeOpen: async () => undefined } as unknown as SettingsService,
    );
    const result = await service.createDraft();
    if (!('sessionToken' in result)) throw new Error('Expected draft credentials');
    expect(result.sessionExpiresAt).toEqual(expiresAt);
    expect(sessionCreate).toHaveBeenCalledWith({ data: { draftId, tokenHash: sha256Hex(result.sessionToken!), expiresAt } });
    const draftData = (draftCreate.mock.calls[0] as unknown as [{ data: { expiresAt: Date; resumeTokenHash: string } }])[0].data;
    expect(Math.abs(draftData.expiresAt.getTime() - expiresAt.getTime())).toBeLessThan(1000);
    expect(draftData.resumeTokenHash).toBe(sha256Hex(result.resumeToken));
  });

  it('upgrades a legacy draft credential only through its remaining draft lifetime', async () => {
    const expiresAt = new Date(Date.now() + 20 * 86_400_000);
    const findDraft = jest.spyOn(prisma.associationApplicationDraft, 'findFirst').mockResolvedValue({ id: draftId, expiresAt } as never);
    const create = jest.spyOn(prisma.applicationApplicantSession, 'create').mockResolvedValue({} as never);
    const result = await access.upgradeResumeToken(draftCode, resumeToken);
    expect(result.expiresAt).toEqual(expiresAt);
    expect(findDraft).toHaveBeenCalledWith({
      where: { publicCode: draftCode, resumeTokenHash: sha256Hex(resumeToken), expiresAt: { gt: expect.any(Date) } },
      select: { id: true, expiresAt: true },
    });
    expect(create).toHaveBeenCalledWith({ data: { draftId, tokenHash: sha256Hex(result.sessionToken), expiresAt } });
  });

  it('keeps emailed credentials single-use and issued sessions limited to 30 minutes', async () => {
    const now = Date.now();
    const create = jest.fn<() => Promise<object>>().mockResolvedValue({});
    const consume = jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });
    const find = jest.fn<() => Promise<object>>().mockResolvedValue({
      id: 'access-id', draftId, consumedAt: null, expiresAt: new Date(now + 60_000),
      draft: { publicCode: draftCode, status: ApplicationDraftStatus.ACTIVE, expiresAt: new Date(now + 45 * 86_400_000) },
    });
    const transaction = { applicationAccessToken: { findUnique: find, updateMany: consume }, applicationApplicantSession: { create } };
    jest.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
      if (typeof callback !== 'function') throw new Error('Expected interactive transaction');
      return callback(transaction as never);
    });
    const result = await access.exchange(resumeToken);
    expect(result.expiresAt.getTime() - now).toBeGreaterThanOrEqual(APPLICANT_SESSION_TTL_SECONDS * 1000);
    expect(result.expiresAt.getTime() - now).toBeLessThan(APPLICANT_SESSION_TTL_SECONDS * 1000 + 1000);
    expect(create).toHaveBeenCalledWith({ data: { draftId, tokenHash: sha256Hex(result.sessionToken), expiresAt: result.expiresAt } });
    consume.mockResolvedValue({ count: 0 });
    await expect(access.exchange(resumeToken)).rejects.toMatchObject({ code: 'APPLICATION_ACCESS_INVALID' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('requires an unrevoked unexpired session for the exact unexpired draft and never slides its expiry', async () => {
    const sessionToken = 's'.repeat(43);
    const draft = { id: draftId, publicCode: draftCode };
    const find = jest.spyOn(prisma.applicationApplicantSession, 'findFirst').mockResolvedValue({ id: 'session-id', draft } as never);
    const update = jest.spyOn(prisma.applicationApplicantSession, 'update').mockResolvedValue({} as never);
    expect(await access.requireSessionDraft(draftCode, sessionToken)).toBe(draft);
    expect(find).toHaveBeenCalledWith({
      where: {
        tokenHash: sha256Hex(sessionToken), revokedAt: null, expiresAt: { gt: expect.any(Date) },
        draft: { publicCode: draftCode, expiresAt: { gt: expect.any(Date) } },
      },
      include: { draft: { include: { attachments: true, submittedApplication: false } } },
    });
    expect(update).toHaveBeenCalledWith({ where: { id: 'session-id' }, data: { lastSeenAt: expect.any(Date) } });
    find.mockResolvedValue(null);
    await expect(access.requireSessionDraft(draftCode, sessionToken)).rejects.toMatchObject({ code: 'APPLICATION_ACCESS_INVALID' });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('restores the initial draft credential after 31 minutes and rejects it at its fixed deadline', async () => {
    const issuedAt = new Date('2026-10-01T00:00:00.000Z');
    const expiresAt = new Date(issuedAt.getTime() + 45 * 86_400_000);
    const draft = { id: draftId, publicCode: draftCode };
    jest.useFakeTimers({ now: issuedAt });
    jest.spyOn(prisma.applicationApplicantSession, 'findFirst').mockImplementation((args) => {
      const deadline = (args?.where?.expiresAt as { gt: Date }).gt;
      return Promise.resolve(expiresAt > deadline ? { id: 'session-id', draft } : null) as never;
    });
    jest.spyOn(prisma.applicationApplicantSession, 'update').mockResolvedValue({} as never);
    jest.setSystemTime(issuedAt.getTime() + 31 * 60_000);
    expect(await access.requireSessionDraft(draftCode, 's'.repeat(43))).toBe(draft);
    jest.setSystemTime(expiresAt);
    await expect(access.requireSessionDraft(draftCode, 's'.repeat(43))).rejects.toMatchObject({ code: 'APPLICATION_ACCESS_INVALID' });
  });
});
