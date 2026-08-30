import { jest } from '@jest/globals';
import { AccountRole, DeliveryApprovalDecision, DeliveryApprovalStage, NotificationSeverity, prisma } from '@alzad/db';
import type { AllocationTriggerPort } from '../allocation/allocation-trigger.port';
import type { SettingsService } from '../settings/settings.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsService SLA', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('warns after one business day and escalates only after one additional business day without association action', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-30T12:00:00.000Z'));
    const settings = { getValue: jest.fn(async (key: string) => key === 'calendar.workingDays' ? [0, 1, 2, 3, 4, 5, 6] : []) } as unknown as SettingsService;
    const allocation = { triggerForAssociation: jest.fn() } as unknown as AllocationTriggerPort;
    const service = new NotificationsService(settings, allocation);
    jest.spyOn(prisma.deliveryMission, 'findMany').mockResolvedValue([
      { id: '10000000-0000-4000-8000-000000000001', publicCode: 'DEL-OLD', associationId: '20000000-0000-4000-8000-000000000001', updatedAt: new Date('2026-08-28T11:00:00.000Z'), approvals: [] },
      { id: '10000000-0000-4000-8000-000000000002', publicCode: 'DEL-WARN', associationId: '20000000-0000-4000-8000-000000000002', updatedAt: new Date('2026-08-29T11:00:00.000Z'), approvals: [] },
      { id: '10000000-0000-4000-8000-000000000003', publicCode: 'DEL-ACTED', associationId: '20000000-0000-4000-8000-000000000003', updatedAt: new Date('2026-08-25T11:00:00.000Z'), approvals: [{ createdAt: new Date('2026-08-26T11:00:00.000Z'), stage: DeliveryApprovalStage.ASSOCIATION, decision: DeliveryApprovalDecision.APPROVED }] },
    ] as never);
    const upsert = jest.spyOn(prisma.notification, 'upsert').mockResolvedValue({} as never);

    const result = await service.scanDeliverySla();

    expect(result).toEqual({ scanned: 3, emitted: 3 });
    expect(upsert).toHaveBeenCalledTimes(3);
    const dedupeKeys = upsert.mock.calls.map(([input]) => input.create.dedupeKey);
    expect(dedupeKeys).toEqual(expect.arrayContaining([
      'sla:10000000-0000-4000-8000-000000000001:association-warning',
      'sla:10000000-0000-4000-8000-000000000001:zaad-escalation',
      'sla:10000000-0000-4000-8000-000000000002:association-warning',
    ]));
    expect(upsert.mock.calls.every(([input]) => input.create.type === 'DELIVERY_APPROVAL_SLA')).toBe(true);
    expect(upsert.mock.calls.some(([input]) => input.create.audienceRole === AccountRole.ADMIN && input.create.severity === NotificationSeverity.CRITICAL)).toBe(true);
  });

  it('skips SLA emission until the business calendar is configured', async () => {
    const settings = { getValue: jest.fn(async () => null) } as unknown as SettingsService;
    const service = new NotificationsService(settings, { triggerForAssociation: jest.fn() } as unknown as AllocationTriggerPort);
    const findMany = jest.spyOn(prisma.deliveryMission, 'findMany');
    await expect(service.scanDeliverySla()).resolves.toEqual({ skipped: 'required business calendar settings missing' });
    expect(findMany).not.toHaveBeenCalled();
  });
});
