import { jest } from '@jest/globals';
import { ApplicationInformationItemType, ApplicationInformationRequestStatus, EligibilityStatus, Prisma, prisma } from '@alzad/db';
import type { IdempotencyService } from '../../common/idempotency.service';
import type { PublicCodeService } from '../../common/public-code.service';
import type { RateLimitService } from '../../common/rate-limit.service';
import type { StorageService } from '../files/storage.service';
import type { SettingsService } from '../settings/settings.service';
import type { ApplicationAccessService } from './application-access.service';
import { ApplicationV2Service } from './application-v2.service';

type Attachment = { applicationId: string; fieldKey: string; file: { createdAt: Date } };

function fixture(fields = ['finance.governanceScore'], files: string[] = []) {
  const applicationId = 'application-id';
  const requestedAt = new Date('2026-10-01T12:00:00Z');
  const storedFiles: Attachment[] = [];
  const request = {
    id: 'request-id', applicationId, requestedAt, deadline: null, status: ApplicationInformationRequestStatus.OPEN,
    items: [
      ...fields.map((key) => ({ type: ApplicationInformationItemType.FIELD, key })),
      ...files.map((key) => ({ type: ApplicationInformationItemType.ATTACHMENT, key })),
    ],
    application: { v2Payload: { organization: { licenseExpiryDate: '2000-01-01' }, finance: { governanceScore: 80 } } as Record<string, unknown> },
  };
  const tx = {
    $queryRaw: jest.fn<() => Promise<unknown>>().mockResolvedValue([]),
    applicationInformationRequest: {
      findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
      findFirst: jest.fn<() => Promise<unknown>>().mockResolvedValue(request),
      update: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
    },
    applicationAttachment: {
      findMany: jest.fn<(args: Prisma.ApplicationAttachmentFindManyArgs) => Promise<unknown>>().mockImplementation(async ({ where }) => {
        const keys = (where?.fieldKey as { in?: string[] } | undefined)?.in;
        return storedFiles.filter((file) => file.applicationId === where?.applicationId && (!keys || keys.includes(file.fieldKey)));
      }),
    },
    geographicUnit: { findFirst: jest.fn<() => Promise<unknown>>().mockResolvedValue(null) },
    referenceValue: { count: jest.fn<() => Promise<unknown>>().mockResolvedValue(1) },
    associationApplication: { update: jest.fn<() => Promise<unknown>>().mockResolvedValue({}) },
    auditLog: { create: jest.fn<() => Promise<unknown>>().mockResolvedValue({}) },
  };
  jest.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
    if (typeof callback !== 'function') throw new Error('Expected interactive transaction');
    return callback(tx as never);
  });
  const access = { requireSessionDraft: async () => ({ submittedApplicationId: applicationId }) } as unknown as ApplicationAccessService;
  const service = new ApplicationV2Service({} as PublicCodeService, {} as IdempotencyService, {} as StorageService,
    { consume: async () => undefined } as unknown as RateLimitService, access, {} as SettingsService, {} as never);
  const submit = (payload: Record<string, unknown>) => service.submitInformation('DRF-000001', '', request.id, { payload, opId: 'operation-id' }, 's'.repeat(43));
  return { submit, tx, request, storedFiles, requestedAt, applicationId };
}

describe('information response reuses submission validation only within requested scope', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([-1, 101, 80.123, '80'])('rejects invalid governance score %s before any response mutation', async (governanceScore) => {
    const { submit, tx } = fixture();
    await expect(submit({ finance: { governanceScore } })).rejects.toMatchObject({ code: 'APPLICATION_VALIDATION_FAILED' });
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
    expect(tx.applicationInformationRequest.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('accepts valid requested correction without revalidating unrelated legacy expiry or missing data', async () => {
    const { submit, tx } = fixture();
    await expect(submit({ finance: { governanceScore: 87.5 } })).resolves.toEqual({ ok: true });
    expect(tx.associationApplication.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      eligibilityStatus: EligibilityStatus.PENDING, v2Payload: { organization: { licenseExpiryDate: '2000-01-01' }, finance: { governanceScore: 87.5 } },
    }) }));
    expect(tx.geographicUnit.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an unrequested changed field without mutating the application', async () => {
    const { submit, tx } = fixture();
    await expect(submit({ finance: { governanceScore: 80 }, organization: { name: 'unrequested' } })).rejects.toMatchObject({ code: 'APPLICATION_INFORMATION_SCOPE_INVALID' });
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
  });

  it('validates the existing dependency when the requested boolean enables it', async () => {
    const { submit, tx } = fixture(['organization.hasWebsite']);
    await expect(submit({ organization: { hasWebsite: true } })).rejects.toThrow('رابط الموقع الإلكتروني مطلوب');
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
  });

  it('validates a conditional value even when its controlling boolean is not requested', async () => {
    const { submit, request } = fixture(['organization.websiteUrl']);
    request.application.v2Payload = { organization: { hasWebsite: true } };
    await expect(submit({ organization: { websiteUrl: 'javascript:alert(1)' } })).rejects.toMatchObject({ code: 'APPLICATION_WEBSITE_INVALID' });
  });

  it('accepts a false requested boolean without imposing its inactive description', async () => {
    const { submit } = fixture(['socialResearcher.exists']);
    await expect(submit({ socialResearcher: { exists: false } })).resolves.toEqual({ ok: true });
  });

  it('checks the exact geographic center chain within the same transaction', async () => {
    const { submit, tx, request } = fixture(['location.centerCode']);
    request.application.v2Payload = { location: { regionCode: '0001', governorateCode: '0002' } };
    tx.geographicUnit.findFirst.mockResolvedValueOnce({ nameAr: 'منطقة الرياض' }).mockResolvedValueOnce({ nameAr: 'مدينة الرياض' }).mockResolvedValueOnce(null);
    await expect(submit({ location: { centerCode: 'wrong-center' } })).rejects.toMatchObject({ code: 'APPLICATION_LOCATION_INVALID' });
    expect(tx.geographicUnit.findFirst).toHaveBeenNthCalledWith(3, { where: expect.objectContaining({ officialCode: 'wrong-center', parentOfficialCode: '0002', active: true }) });
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
  });

  it('does not accept the old requested attachment merely because its attachment row exists', async () => {
    const { submit, tx, storedFiles, requestedAt, applicationId } = fixture([], ['financialStatementsFile']);
    storedFiles.push({ applicationId, fieldKey: 'financialStatementsFile', file: { createdAt: new Date(requestedAt.getTime() - 1) } });
    await expect(submit({})).rejects.toMatchObject({ code: 'APPLICATION_INFORMATION_ATTACHMENTS_MISSING' });
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
  });

  it('accepts a fresh requested attachment and leaves unrequested old attachments valid', async () => {
    const { submit, storedFiles, requestedAt, applicationId } = fixture([], ['governanceReportFile']);
    storedFiles.push({ applicationId, fieldKey: 'governanceReportFile', file: { createdAt: requestedAt } });
    storedFiles.push({ applicationId, fieldKey: 'licenseFile', file: { createdAt: new Date('2020-01-01') } });
    await expect(submit({})).resolves.toEqual({ ok: true });
  });

  it('rejects a fresh file belonging to another application', async () => {
    const { submit, tx, storedFiles, requestedAt } = fixture([], ['financialStatementsFile']);
    storedFiles.push({ applicationId: 'another-application', fieldKey: 'financialStatementsFile', file: { createdAt: requestedAt } });
    await expect(submit({})).rejects.toMatchObject({ code: 'APPLICATION_INFORMATION_ATTACHMENTS_MISSING' });
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
  });

  it('requires an existing dependent attachment only when the requested field enables that requirement', async () => {
    const { submit } = fixture(['planning.hasStrategicPlan']);
    await expect(submit({ planning: { hasStrategicPlan: true } })).rejects.toMatchObject({ code: 'APPLICATION_ATTACHMENT_REQUIRED' });
  });

  it('keeps the scalar center projection consistent with a corrected validated center', async () => {
    const { submit, tx, request } = fixture(['location.centerCode']);
    request.application.v2Payload = { location: { regionCode: '0001', governorateCode: '0002' } };
    tx.geographicUnit.findFirst.mockResolvedValueOnce({ nameAr: 'منطقة الرياض' }).mockResolvedValueOnce({ nameAr: 'مدينة الرياض' }).mockResolvedValueOnce({ nameAr: 'المركز' });
    await expect(submit({ location: { centerCode: '0003' } })).resolves.toEqual({ ok: true });
    expect(tx.associationApplication.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      centerOfficialCode: '0003', v2Payload: { location: { regionCode: '0001', governorateCode: '0002', centerCode: '0003' } },
    }) }));
  });

  it('updates the scalar sector projection when only the other-sector description is corrected', async () => {
    const { submit, tx, request } = fixture(['organization.sectorOther']);
    request.application.v2Payload = { organization: { sectors: ['أخرى'] } };
    await expect(submit({ organization: { sectorOther: 'وصف مصحح' } })).resolves.toEqual({ ok: true });
    expect(tx.associationApplication.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sector: 'أخرى: وصف مصحح' }) }));
    expect(tx.referenceValue.count).toHaveBeenCalled();
  });

  it('rejects unknown corrected sector references using the transaction reference reader', async () => {
    const { submit, tx } = fixture(['organization.sectors']);
    tx.referenceValue.count.mockResolvedValue(0);
    await expect(submit({ organization: { sectors: ['غير معروف'] } })).rejects.toMatchObject({ code: 'APPLICATION_INVALID_REFERENCE' });
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
  });

  it('checks expiry when expiry itself is the requested correction', async () => {
    const { submit, tx } = fixture(['organization.licenseExpiryDate']);
    await expect(submit({ organization: { licenseExpiryDate: '2000-01-01' } })).rejects.toMatchObject({ code: 'APPLICATION_LICENSE_EXPIRED' });
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
  });

  it.each([
    ['team.fullTime', { team: { fullTime: 1.5 } }],
    ['readiness.canDocumentDigitally', { readiness: { canDocumentDigitally: 'true' } }],
    ['acknowledgements.allAccepted', { acknowledgements: { allAccepted: false } }],
  ])('applies the original rule to %s', async (key, payload) => {
    const { submit, tx } = fixture([key]);
    await expect(submit(payload)).rejects.toBeDefined();
    expect(tx.associationApplication.update).not.toHaveBeenCalled();
  });
});
