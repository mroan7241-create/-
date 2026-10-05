import { jest } from '@jest/globals';
import { prisma, FileCategory } from '@alzad/db';
import { ApplicationsService } from './applications.service';

describe('admin application-owned supporting file read', () => {
  afterEach(() => jest.restoreAllMocks());
  function setup(fieldKey = 'operationalPlanFile', attached = true) {
    const file = { objectKey: 'private/application-a/plan.pdf', category: FileCategory.APPLICATION_SUPPORTING_DOCUMENT };
    jest.spyOn(prisma.associationApplication, 'findUnique').mockResolvedValue({ id: 'application-a', licenseFile: null, attachments: attached ? [{ fieldKey, file }] : [], initialBeneficiaryFile: null } as never);
    const storage = { getSignedGetUrl: jest.fn(async () => 'https://private.invalid/signed') };
    const audit = { log: jest.fn(async () => undefined) };
    const service = new ApplicationsService({} as never, {} as never, {} as never, audit as never, storage as never, {} as never, {} as never, {} as never);
    return { service, storage, audit };
  }
  it('reads only an attachment related to the requested application and audits the read', async () => {
    const { service, storage, audit } = setup();
    await expect(service.getLicenseSignedUrl({ accountId: 'admin', role: 'ADMIN' } as never, 'application-a', 'operationalPlanFile')).resolves.toMatchObject({ url: 'https://private.invalid/signed' });
    expect(storage.getSignedGetUrl).toHaveBeenCalledWith('private/application-a/plan.pdf', expect.any(Number));
    expect(audit.log).toHaveBeenCalled();
  });
  it('rejects a missing/another application attachment without signing any object', async () => {
    const { service, storage } = setup('operationalPlanFile', false);
    await expect(service.getLicenseSignedUrl({} as never, 'application-a', 'operationalPlanFile')).rejects.toMatchObject({ status: 404 });
    expect(storage.getSignedGetUrl).not.toHaveBeenCalled();
  });
  it('rejects unknown field keys rather than accepting an arbitrary file ID/object key', async () => {
    const { service, storage } = setup();
    await expect(service.getLicenseSignedUrl({} as never, 'application-a', '../other-file')).rejects.toMatchObject({ status: 400 });
    expect(storage.getSignedGetUrl).not.toHaveBeenCalled();
  });
});
