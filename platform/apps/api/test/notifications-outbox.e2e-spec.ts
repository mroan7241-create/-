import { jest } from '@jest/globals';
import { OutboxEventStatus, OutboxEventType, prisma } from '@alzad/db';
import type { AllocationTriggerPort } from '../src/modules/allocation/allocation-trigger.port';
import type { SettingsService } from '../src/modules/settings/settings.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

describe('notification outbox reliability', () => {
  beforeEach(async () => {
    await prisma.notification.deleteMany({});
    await prisma.outboxEvent.deleteMany({});
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({});
    await prisma.outboxEvent.deleteMany({});
  });

  function service(trigger = jest.fn<AllocationTriggerPort['triggerForAssociation']>()) {
    const settings = { getValue: jest.fn(async () => null) } as unknown as SettingsService;
    return { worker: new NotificationsService(settings, { triggerForAssociation: trigger } as AllocationTriggerPort), trigger };
  }

  it('claims and processes a notification event exactly once', async () => {
    const event = await prisma.outboxEvent.create({ data: { type: OutboxEventType.DELIVERY_SUBMITTED, payload: {} } });
    const { worker } = service();

    await expect(worker.processOutbox()).resolves.toEqual({ processed: 1, retried: 0, failed: 0 });
    await expect(worker.processOutbox()).resolves.toEqual({ processed: 0, retried: 0, failed: 0 });

    const stored = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored.status).toBe(OutboxEventStatus.PROCESSED);
    expect(stored.attempts).toBe(1);
    expect(await prisma.notification.count({ where: { dedupeKey: `outbox:${event.id}` } })).toBe(1);
  });

  it('recovers stale claims and marks poison allocation events failed after bounded retries', async () => {
    const stale = await prisma.outboxEvent.create({ data: { type: OutboxEventType.SLA_ALERT_DUE, payload: {}, status: OutboxEventStatus.PROCESSING, lockedAt: new Date(Date.now() - 10 * 60_000) } });
    const poison = await prisma.outboxEvent.create({ data: { type: OutboxEventType.ALLOCATION_RETRY_DUE, payload: { associationId: '20000000-0000-4000-8000-000000000001' } } });
    const failingTrigger = jest.fn<AllocationTriggerPort['triggerForAssociation']>().mockRejectedValue(new Error('planned allocation failure'));
    const { worker } = service(failingTrigger);

    const first = await worker.processOutbox();
    expect(first.processed).toBe(1);
    expect(first.retried).toBe(1);
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe(OutboxEventStatus.PROCESSED);

    for (let attempt = 2; attempt <= 5; attempt += 1) {
      await prisma.outboxEvent.update({ where: { id: poison.id }, data: { nextAttemptAt: new Date(0) } });
      await worker.processOutbox();
    }

    const failed = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: poison.id } });
    expect(failed.status).toBe(OutboxEventStatus.FAILED);
    expect(failed.attempts).toBe(5);
    expect(failed.failedAt).not.toBeNull();
    expect(failed.lastError).toContain('planned allocation failure');
    expect(failingTrigger).toHaveBeenCalledTimes(5);
  });
});
