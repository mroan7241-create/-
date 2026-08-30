import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { prisma, AccountRole, DeliveryApprovalDecision, DeliveryApprovalStage, DeliveryStatus, NotificationSeverity, OutboxEventStatus, OutboxEventType, Prisma } from '@alzad/db';
import { ApiError } from '../../common/api-error';
import type { AuthContext } from '../auth/auth.types';
import { ALLOCATION_TRIGGER_PORT, type AllocationTriggerPort } from '../allocation/allocation-trigger.port';
import { SettingsService } from '../settings/settings.service';
import { addRiyadhWorkingHours } from '../settings/business-day.util';

const OUTBOX_BATCH_SIZE = 100;
const OUTBOX_MAX_ATTEMPTS = 5;
const OUTBOX_STALE_LOCK_MS = 5 * 60 * 1000;
const ASSOCIATION_WARNING_BUSINESS_HOURS = 24;
const ZAAD_ESCALATION_ADDITIONAL_BUSINESS_HOURS = 24;

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly settings: SettingsService,
    @Inject(ALLOCATION_TRIGGER_PORT) private readonly allocationTrigger: AllocationTriggerPort,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.runWorker().catch((error: unknown) => this.logger.error(`فشل عامل الإشعارات: ${safeError(error)}`));
    }, 60_000);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async list(ctx: AuthContext) {
    const where: Prisma.NotificationWhereInput = ctx.role === AccountRole.ADMIN
      ? { OR: [{ accountId: ctx.accountId }, { audienceRole: AccountRole.ADMIN }] }
      : ctx.role === AccountRole.ASSOCIATION
        ? { OR: [{ accountId: ctx.accountId }, { associationId: ctx.associationId, audienceRole: AccountRole.ASSOCIATION }] }
        : { accountId: ctx.accountId };
    return prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  async markRead(ctx: AuthContext, id: string) {
    const items = await this.list(ctx);
    if (!items.some((notification) => notification.id === id)) throw new ApiError('NOTIFICATION_NOT_FOUND', 'الإشعار غير موجود', 404);
    return prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  }

  async monitorOutbox() {
    const [pending, processing, failed, recentFailures] = await Promise.all([
      prisma.outboxEvent.count({ where: { status: OutboxEventStatus.PENDING } }),
      prisma.outboxEvent.count({ where: { status: OutboxEventStatus.PROCESSING } }),
      prisma.outboxEvent.count({ where: { status: OutboxEventStatus.FAILED } }),
      prisma.outboxEvent.findMany({ where: { status: OutboxEventStatus.FAILED }, select: { id: true, type: true, status: true, attempts: true, lastError: true, failedAt: true, createdAt: true }, orderBy: { failedAt: 'desc' }, take: 50 }),
    ]);
    return { summary: { pending, processing, failed }, items: recentFailures };
  }

  async runWorker() {
    const outbox = await this.processOutbox();
    const sla = await this.scanDeliverySla();
    return { ok: true, outbox, sla };
  }

  async processOutbox() {
    await prisma.outboxEvent.updateMany({
      where: { status: OutboxEventStatus.PROCESSING, lockedAt: { lt: new Date(Date.now() - OUTBOX_STALE_LOCK_MS) } },
      data: { status: OutboxEventStatus.PENDING, lockedAt: null },
    });
    let processed = 0; let retried = 0; let failed = 0;
    for (let index = 0; index < OUTBOX_BATCH_SIZE; index += 1) {
      const event = await this.claimNextEvent();
      if (!event) break;
      try {
        await this.handleEvent(event);
        await prisma.outboxEvent.update({ where: { id: event.id }, data: { status: OutboxEventStatus.PROCESSED, processedAt: new Date(), lockedAt: null, lastError: null, attempts: { increment: 1 } } });
        processed += 1;
      } catch (error) {
        const attempts = event.attempts + 1;
        const terminal = attempts >= OUTBOX_MAX_ATTEMPTS;
        await prisma.outboxEvent.update({ where: { id: event.id }, data: {
          status: terminal ? OutboxEventStatus.FAILED : OutboxEventStatus.PENDING,
          attempts,
          lastError: safeError(error).slice(0, 2000),
          nextAttemptAt: terminal ? event.nextAttemptAt : new Date(Date.now() + retryDelayMs(attempts)),
          failedAt: terminal ? new Date() : null,
          lockedAt: null,
        } });
        if (terminal) failed += 1; else retried += 1;
        this.logger.error(`تعذر الحدث ${event.id} (${event.type}) — محاولة ${attempts}: ${safeError(error)}`);
      }
    }
    return { processed, retried, failed };
  }

  private async claimNextEvent() {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "outbox_events"
        WHERE "status" = 'PENDING'::"OutboxEventStatus" AND "next_attempt_at" <= NOW()
        ORDER BY "created_at" ASC FOR UPDATE SKIP LOCKED LIMIT 1
      `;
      const id = rows[0]?.id;
      if (!id) return null;
      return tx.outboxEvent.update({ where: { id }, data: { status: OutboxEventStatus.PROCESSING, lockedAt: new Date() } });
    });
  }

  private async handleEvent(event: NonNullable<Awaited<ReturnType<NotificationsService['claimNextEvent']>>>) {
    const payload = event.payload as Record<string, unknown>;
    const associationId = typeof payload.associationId === 'string' ? payload.associationId : null;
    if (event.type === OutboxEventType.ALLOCATION_RETRY_DUE) {
      if (!associationId) throw new Error('allocation retry event is missing associationId');
      await this.allocationTrigger.triggerForAssociation(associationId);
      return;
    }
    const target = describe(event.type);
    await prisma.notification.upsert({ where: { dedupeKey: `outbox:${event.id}` }, create: {
      associationId, audienceRole: target.role, type: String(event.type), title: target.title, body: target.body,
      severity: target.severity, entityType: 'outbox_events', entityId: event.id, dedupeKey: `outbox:${event.id}`,
    }, update: {} });
  }

  async scanDeliverySla() {
    const [workingDays, holidays] = await Promise.all([
      this.settings.getValue<number[]>('calendar.workingDays'), this.settings.getValue<string[]>('calendar.holidays'),
    ]);
    if (!workingDays?.length || !holidays) return { skipped: 'required business calendar settings missing' };
    const missions = await prisma.deliveryMission.findMany({ where: { status: DeliveryStatus.PENDING_DELIVERY_APPROVAL }, select: {
      id: true, publicCode: true, associationId: true, updatedAt: true,
      approvals: { where: { stage: DeliveryApprovalStage.ASSOCIATION, decision: DeliveryApprovalDecision.APPROVED }, select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    } });
    const now = new Date(); let emitted = 0;
    for (const mission of missions) {
      const associationApproval = mission.approvals[0];
      if (!associationApproval) {
        const dueAt = addRiyadhWorkingHours(mission.updatedAt, ASSOCIATION_WARNING_BUSINESS_HOURS, { workingDays, holidays });
        if (dueAt <= now) { await this.upsertSlaNotification(mission.id, mission.publicCode, mission.associationId, 'association-warning', AccountRole.ASSOCIATION, NotificationSeverity.WARNING); emitted += 1; }
        const escalationDueAt = addRiyadhWorkingHours(dueAt, ZAAD_ESCALATION_ADDITIONAL_BUSINESS_HOURS, { workingDays, holidays });
        if (escalationDueAt <= now) { await this.upsertSlaNotification(mission.id, mission.publicCode, mission.associationId, 'zaad-escalation', AccountRole.ADMIN, NotificationSeverity.CRITICAL); emitted += 1; }
      }
    }
    return { scanned: missions.length, emitted };
  }

  private upsertSlaNotification(missionId: string, publicCode: string, associationId: string, tier: string, role: AccountRole, severity: NotificationSeverity) {
    return prisma.notification.upsert({ where: { dedupeKey: `sla:${missionId}:${tier}` }, create: {
      associationId, audienceRole: role, type: 'DELIVERY_APPROVAL_SLA',
      title: tier === 'association-warning' ? 'تنبيه اعتماد تسليم للجمعية' : 'تصعيد اعتماد تسليم إلى زاد',
      body: `مهمة التسليم ${publicCode} تجاوزت مهلة يوم العمل المعتمدة.`, severity,
      entityType: 'delivery_missions', entityId: missionId, dedupeKey: `sla:${missionId}:${tier}`,
    }, update: {} });
  }
}

function retryDelayMs(attempt: number) { return Math.min(60 * 60 * 1000, 30_000 * (2 ** Math.max(0, attempt - 1))); }
function safeError(error: unknown) { return error instanceof Error ? error.message : String(error); }
function describe(type: OutboxEventType) {
  if (type === OutboxEventType.DELIVERY_SUBMITTED) return { role: AccountRole.ASSOCIATION, title: 'تسليم بانتظار اعتماد الجمعية', body: 'أرسل المندوب إثبات التسليم وتوقيع المستفيد.', severity: NotificationSeverity.INFO };
  if (type === OutboxEventType.DELIVERY_ASSOCIATION_APPROVED) return { role: AccountRole.ADMIN, title: 'تسليم بانتظار اعتماد زاد', body: 'اعتمدت الجمعية التسليم وهو جاهز للاعتماد النهائي.', severity: NotificationSeverity.WARNING };
  if (type === OutboxEventType.RETURN_REQUESTED) return { role: AccountRole.ASSOCIATION, title: 'طلب إرجاع بانتظار الاستلام الفعلي', body: 'طلب المندوب إرجاع العهدة؛ لا تُحرر قبل التأكيد المادي.', severity: NotificationSeverity.WARNING };
  if (type === OutboxEventType.ESCALATION_OPENED) return { role: AccountRole.ADMIN, title: 'تصعيد تشغيلي جديد', body: 'يوجد تصعيد يحتاج قرار زاد.', severity: NotificationSeverity.WARNING };
  return { role: AccountRole.ADMIN, title: 'حدث تشغيلي', body: `حدث جديد: ${type}`, severity: NotificationSeverity.INFO };
}
