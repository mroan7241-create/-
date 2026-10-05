import { jest } from '@jest/globals';
import { prisma } from '@alzad/db';
import { ApplicationsService } from './applications.service';

describe('application decision actor attribution', () => {
  afterEach(() => jest.restoreAllMocks());
  it('returns each existing decision relationship with the personal account name', async () => {
    const actor = { id: 'staff-account', name: 'محمد الموظف', publicCode: 'ADM-000002' };
    const now = new Date();
    jest.spyOn(prisma.associationApplication, 'findUnique').mockResolvedValue({
      id: 'application', publicCode: 'APP-1', name: 'جمعية', status: 'ACCEPTED',
      eligibilityReviewedBy: actor, evaluatedBy: actor, selectionApprovedBy: actor, processingStartedBy: actor,
      eligibilityReviewedAt: now, evaluatedAt: now, selectionApprovedAt: now,
    } as never);
    const service = new ApplicationsService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await expect(service.getApplicationDetail('application')).resolves.toMatchObject({
      eligibilityReviewer: actor, evaluator: actor, selectionApprover: actor, processingStarter: actor,
      eligibilityReviewedAt: now, evaluatedAt: now, selectionApprovedAt: now,
    });
    expect(prisma.associationApplication.findUnique).toHaveBeenCalledWith({ where: { id: 'application' }, include: expect.objectContaining({ evaluatedBy: { select: { id: true, name: true, publicCode: true } } }) });
  });
});
