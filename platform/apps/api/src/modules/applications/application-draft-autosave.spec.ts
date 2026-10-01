import { jest } from '@jest/globals';
import { ApplicationDraftStatus, Prisma, prisma } from '@alzad/db';
import { ApiError } from '../../common/api-error';
import { IdempotencyService } from '../../common/idempotency.service';
import { PublicCodeService } from '../../common/public-code.service';
import { RateLimitService } from '../../common/rate-limit.service';
import { StorageService } from '../files/storage.service';
import { SettingsService } from '../settings/settings.service';
import { ApplicationAccessService } from './application-access.service';
import { ApplicationV2Service } from './application-v2.service';

describe('draft autosave submission race', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['submitted', 'expired'] as const)('rejects a pending autosave when the draft became %s after authorization', async (state) => {
    const draftId = 'draft-id';
    const draftCode = 'DRF-000001';
    const authorized = { id: draftId, status: ApplicationDraftStatus.ACTIVE, submittedApplicationId: null, revision: 0 };
    const stored = {
      ...authorized,
      status: state === 'submitted' ? ApplicationDraftStatus.SUBMITTED : ApplicationDraftStatus.ACTIVE,
      submittedApplicationId: state === 'submitted' ? 'application-id' : null,
      expiresAt: new Date(Date.now() + (state === 'expired' ? -60_000 : 86_400_000)),
      payload: { organization: { name: 'Original' } }, contactEmail: 'original@example.org',
    };
    const access = { requireSessionDraft: async () => authorized } as unknown as ApplicationAccessService;
    const service = new ApplicationV2Service({} as PublicCodeService, {} as IdempotencyService, {} as StorageService,
      { consume: async () => undefined } as unknown as RateLimitService, access, {} as SettingsService);
    const read = jest.spyOn(prisma.associationApplicationDraft, 'findUniqueOrThrow').mockResolvedValue({} as never);
    // Simulate submission/expiry after requireDraft has read its ACTIVE snapshot.
    // A DB-style conditional write succeeds only if every supplied guard matches.
    const mutation = jest.spyOn(prisma.associationApplicationDraft, 'updateMany').mockImplementation(({ where }) => {
      const deadline = (where?.expiresAt as { gt?: Date } | undefined)?.gt;
      const matches = where?.id === stored.id && where?.revision === stored.revision
        && (where.status === undefined || where.status === stored.status)
        && (where.submittedApplicationId === undefined || where.submittedApplicationId === stored.submittedApplicationId)
        && (!deadline || stored.expiresAt > deadline);
      return Promise.resolve({ count: matches ? 1 : 0 }) as Prisma.PrismaPromise<Prisma.BatchPayload>;
    });
    const result = service.saveDraft(draftCode, '', 0, { organization: { name: 'Late mutation', officialEmail: 'late@example.org' } }, 's'.repeat(43));
    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({ code: 'APPLICATION_DRAFT_REVISION_CONFLICT' });
    expect(mutation).toHaveBeenCalledWith({
      where: { id: draftId, revision: 0, status: ApplicationDraftStatus.ACTIVE, submittedApplicationId: null, expiresAt: { gt: expect.any(Date) } },
      data: expect.objectContaining({ contactEmail: 'late@example.org', revision: { increment: 1 } }),
    });
    expect(read).not.toHaveBeenCalled();
    expect(stored.payload.organization.name).toBe('Original');
    expect(stored.contactEmail).toBe('original@example.org');
  });
});
