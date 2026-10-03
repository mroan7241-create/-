import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { prisma, AccountRole, DeliveryApprovalDecision, DeliveryApprovalStage, DeliveryStatus, NotificationSeverity, OutboxEventStatus, OutboxEventType, Prisma } from '@alzad/db';
import { ApiError } from '../../common/api-error';
import type { AuthContext } from '../auth/auth.types';
import { ALLOCATION_TRIGGER_PORT, type AllocationTriggerPort } from '../allocation/allocation-trigger.port';
import { SettingsService } from '../settings/settings.service';
import { addRiyadhWorkingHours } from '../settings/business-day.util';
import { createHash } from 'node:crypto';
import { EmailService, classifyEmailFailure, decryptEmailDelivery, type DecryptedEmailDelivery, type EmailDeliveryPayload, type ApplicationAccessEmailParams, type PasswordResetEmailParams, type SecurityAlertEmailParams } from '../auth/email/email.service';
import { StorageService } from '../files/storage.service';
import { storageConfig } from '../../config/storage.config';

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
    @Inject(EmailService) private readonly email?: EmailService,
    private readonly storage?: StorageService,
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
      where: { type: { not: OutboxEventType.EMAIL_DELIVERY }, status: OutboxEventStatus.PROCESSING, lockedAt: { lt: new Date(Date.now() - OUTBOX_STALE_LOCK_MS) } },
      data: { status: OutboxEventStatus.PENDING, lockedAt: null },
    });
    // An interrupted SMTP call is not evidence that the provider rejected it.
    // Accepted mail resumes database finalization only; READY has not sent yet.
    for (const phase of ['READY', 'SMTP_ACCEPTED']) await prisma.outboxEvent.updateMany({
      where: { type: OutboxEventType.EMAIL_DELIVERY, status: OutboxEventStatus.PROCESSING, lockedAt: { lt: new Date(Date.now() - OUTBOX_STALE_LOCK_MS) }, payload: { path: ['phase'], equals: phase } },
      data: { status: OutboxEventStatus.PENDING, lockedAt: null },
    });
    await prisma.outboxEvent.updateMany({
      where: { type: OutboxEventType.EMAIL_DELIVERY, status: OutboxEventStatus.PROCESSING, lockedAt: { lt: new Date(Date.now() - OUTBOX_STALE_LOCK_MS) } },
      data: { status: OutboxEventStatus.FAILED, failedAt: new Date(), lockedAt: null, lastError: 'MAIL_DELIVERY_UNCERTAIN' },
    });
    let processed = 0; let retried = 0; let failed = 0;
    for (let index = 0; index < OUTBOX_BATCH_SIZE; index += 1) {
      const event = await this.claimNextEvent();
      if (!event) break;
      if (event.type === OutboxEventType.EMAIL_DELIVERY) {
        const result = await this.processEmailEvent(event);
        if (result === 'processed') processed += 1;
        else if (result === 'retried') retried += 1;
        else failed += 1;
        continue;
      }
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
        WHERE "status" = 'PENDING'::"OutboxEventStatus"
          AND "next_attempt_at" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        ORDER BY "created_at" ASC FOR UPDATE SKIP LOCKED LIMIT 1
      `;
      const id = rows[0]?.id;
      if (!id) return null;
      return tx.outboxEvent.update({ where: { id }, data: { status: OutboxEventStatus.PROCESSING, lockedAt: new Date() } });
    });
  }

  private async processEmailEvent(event: NonNullable<Awaited<ReturnType<NotificationsService['claimNextEvent']>>>): Promise<'processed' | 'retried' | 'failed'> {
    let payload = event.payload as unknown as EmailDeliveryPayload;
    let delivery: DecryptedEmailDelivery | undefined;
    let started = false, accepted = payload?.phase === 'SMTP_ACCEPTED';
    try {
      delivery = decryptEmailDelivery(event.id, payload);
      if (payload.phase === 'SMTP_STARTED') return this.recordEmailFailure(event, payload, 'MAIL_DELIVERY_UNCERTAIN', false);
      if (!accepted) {
        if (!this.email) throw new Error('MAIL_CONFIGURATION_INVALID');
        // Preparation may fetch the PDF, but never performs SMTP inside a DB transaction.
        const attachment = delivery.context.type === 'covenant' ? await this.covenantAttachment(delivery) : undefined;
        const owned = await prisma.$transaction(async tx => {
          await this.lockEmailContext(tx, delivery!.context);
          await this.validateEmailState(tx, delivery!, event.id);
          const claim = await tx.outboxEvent.updateMany({ where: { id: event.id, status: OutboxEventStatus.PROCESSING, lockedAt: event.lockedAt, payload: { path: ['phase'], equals: 'READY' } }, data: { payload: { ...payload, phase: 'SMTP_STARTED' } as unknown as Prisma.InputJsonValue } });
          return claim.count === 1;
        });
        if (!owned) return 'retried'; // Lost lease: this invocation must not send.
        started = true;
        const options = { messageId: `<${event.id}@alzad-mail.invalid>` };
        if (delivery.kind === 'APPLICATION_ACCESS') await this.email.sendApplicationAccess(delivery.params as ApplicationAccessEmailParams, options);
        else if (delivery.kind === 'PASSWORD_RESET') await this.email.sendPasswordResetCode(delivery.params as PasswordResetEmailParams, options);
        else await this.email.sendSecurityAlert({ ...delivery.params as SecurityAlertEmailParams, ...(attachment ? { pdfAttachment: attachment } : {}) }, options);
        accepted = true;
        payload = { ...payload, phase: 'SMTP_ACCEPTED' };
        // Durable acceptance precedes revoking predecessors or writing domain markers.
        const receipt = await prisma.outboxEvent.updateMany({ where: { id: event.id, payload: { path: ['phase'], equals: 'SMTP_STARTED' }, OR: [
          { status: OutboxEventStatus.PROCESSING, lockedAt: event.lockedAt },
          // A late, definite receipt may resolve quarantine, never create another send.
          { status: OutboxEventStatus.FAILED, lastError: 'MAIL_DELIVERY_UNCERTAIN' },
        ] }, data: { payload: payload as unknown as Prisma.InputJsonValue, status: OutboxEventStatus.PROCESSING, lockedAt: event.lockedAt } });
        if (receipt.count !== 1) return 'retried';
      }
      const finalized = await prisma.$transaction(async tx => {
        // All worker paths lock domain rows first, then the outbox lease.
        await this.lockEmailContext(tx, delivery!.context);
        await tx.$queryRaw`SELECT id FROM outbox_events WHERE id=${event.id}::uuid FOR UPDATE`;
        const stored = await tx.outboxEvent.findUnique({ where: { id: event.id } });
        if (stored?.status === OutboxEventStatus.PROCESSED) return true;
        if (!stored || stored.status !== OutboxEventStatus.PROCESSING || stored.lockedAt?.getTime() !== event.lockedAt?.getTime() || (stored.payload as unknown as EmailDeliveryPayload).phase !== 'SMTP_ACCEPTED') return false;
        let current = true;
        try { await this.validateEmailState(tx, delivery!, event.id); }
        catch (error) { if (isMailStateError(error)) current = false; else throw error; }
        const context = delivery!.context, now = new Date();
        if (current && context.type === 'access') for (const token of context.draftTokens) await tx.applicationAccessToken.updateMany({
          where: { id: { in: token.predecessorIds.filter(id => id !== token.id) }, draftId: token.draftId, consumedAt: null }, data: { consumedAt: now },
        });
        if (current && context.type === 'reset') await tx.passwordResetToken.updateMany({
          where: { id: { in: context.predecessorIds.filter(id => id !== context.tokenId) }, accountId: context.accountId, consumedAt: null }, data: { consumedAt: now },
        });
        if (!current) await this.suppressEmailCandidate(tx, context);
        if (context.type === 'covenant') {
          const marker = await tx.systemSetting.updateMany({ where: { key: context.markerKey, value: { path: ['eventId'], equals: event.id } }, data: { value: { status: 'SENT', eventId: event.id, sentAt: now.toISOString() } } });
          if (marker.count !== 1) throw new Error('MAIL_STATE_INVALID');
        }
        await tx.auditLog.create({ data: { action: mailAuditAction(context.type), entityType: context.type === 'access' ? 'association_application_drafts' : context.type === 'rejection' ? 'association_applications' : context.type === 'covenant' ? 'participation_agreements' : 'accounts', entityId: context.type === 'access' ? context.draftTokens[0]!.draftId : context.type === 'rejection' ? context.applicationId : context.type === 'covenant' ? context.agreementId : context.accountId, metadata: { eventId: event.id, accepted: true, stale: !current } } });
        const completed = await tx.outboxEvent.updateMany({ where: { id: event.id, status: OutboxEventStatus.PROCESSING, lockedAt: event.lockedAt, payload: { path: ['phase'], equals: 'SMTP_ACCEPTED' } }, data: { status: OutboxEventStatus.PROCESSED, payload: payload as unknown as Prisma.InputJsonValue, processedAt: now, failedAt: null, lockedAt: null, lastError: null, attempts: { increment: 1 } } });
        if (completed.count !== 1) throw new Error('MAIL_STATE_UNAVAILABLE');
        return true;
      });
      return finalized ? 'processed' : 'retried';
    } catch (error) {
      if (accepted) return this.recordEmailFailure(event, { ...payload, phase: 'SMTP_ACCEPTED' }, 'MAIL_FINALIZATION_FAILED', true);
      if (delivery && isMailStateError(error)) {
        try { await prisma.$transaction(async tx => {
          await this.lockEmailContext(tx, delivery!.context);
          await tx.$queryRaw`SELECT id FROM outbox_events WHERE id=${event.id}::uuid FOR UPDATE`;
          const stored = await tx.outboxEvent.findUnique({ where: { id: event.id } });
          if (stored?.status === OutboxEventStatus.PROCESSING && stored.lockedAt?.getTime() === event.lockedAt?.getTime() && (stored.payload as unknown as EmailDeliveryPayload).phase === 'READY') await this.suppressEmailCandidate(tx, delivery!.context);
        }); }
        catch { return this.recordEmailFailure(event, payload, 'MAIL_STATE_UNAVAILABLE', true); }
      }
      if (!started) {
        const code = error instanceof Error && ['MAIL_PAYLOAD_INVALID', 'MAIL_STATE_INVALID', 'MAIL_EXPIRED', 'MAIL_ATTACHMENT_INVALID', 'MAIL_CONFIGURATION_INVALID'].includes(error.message) ? error.message : 'MAIL_STATE_UNAVAILABLE';
        return this.recordEmailFailure(event, payload, code, code === 'MAIL_STATE_UNAVAILABLE');
      }
      const failure = classifyEmailFailure(error);
      return this.recordEmailFailure(event, { ...payload, phase: failure.retryable ? 'READY' : 'SMTP_STARTED' }, failure.code, failure.retryable);
    }
  }

  private async recordEmailFailure(event: { id: string; attempts: number; nextAttemptAt: Date; lockedAt: Date | null }, payload: EmailDeliveryPayload, code: string, retryable: boolean): Promise<'retried' | 'failed'> {
    const attempts = event.attempts + 1, terminal = !retryable || attempts >= OUTBOX_MAX_ATTEMPTS;
    try {
      const owned = await prisma.outboxEvent.updateMany({ where: { id: event.id, status: OutboxEventStatus.PROCESSING, lockedAt: event.lockedAt }, data: { status: terminal ? OutboxEventStatus.FAILED : OutboxEventStatus.PENDING, payload: payload as unknown as Prisma.InputJsonValue, attempts, lastError: code, nextAttemptAt: terminal ? event.nextAttemptAt : new Date(Date.now() + retryDelayMs(attempts)), failedAt: terminal ? new Date() : null, lockedAt: null } });
      if (owned.count !== 1) return 'retried';
    } catch { throw new Error('MAIL_WORKER_STATE_UNAVAILABLE'); }
    try { this.logger.error(`تعذر البريد ${event.id} — محاولة ${attempts}: ${code}`); } catch { /* Logging cannot change delivery ownership. */ }
    return terminal ? 'failed' : 'retried';
  }

  private async lockEmailContext(tx: Prisma.TransactionClient, context: DecryptedEmailDelivery['context']) {
    if (context.type === 'access') {
      if (!Array.isArray(context.draftTokens) || !context.draftTokens.length || context.draftTokens.some(token => !token.id || !token.draftId || !Array.isArray(token.predecessorIds))) throw new Error('MAIL_PAYLOAD_INVALID');
      for (const id of [...new Set(context.draftTokens.map(token => token.draftId))].sort()) await tx.$queryRaw`SELECT id FROM association_application_drafts WHERE id=${id}::uuid FOR UPDATE`;
    } else if (context.type === 'reset' || context.type === 'credentials' || context.type === 'notice') {
      if (!context.accountId) throw new Error('MAIL_PAYLOAD_INVALID');
      await tx.$queryRaw`SELECT id FROM accounts WHERE id=${context.accountId}::uuid FOR UPDATE`;
    } else if (context.type === 'covenant') {
      if (!context.agreementId || context.markerKey !== `COVENANT_COMPLETION_EMAIL:${context.agreementId}`) throw new Error('MAIL_PAYLOAD_INVALID');
      await tx.$queryRaw`SELECT id FROM participation_agreements WHERE id=${context.agreementId}::uuid FOR UPDATE`;
    }
  }

  private async validateEmailState(tx: Prisma.TransactionClient, delivery: DecryptedEmailDelivery, eventId: string) {
    const context = delivery.context, to = delivery.params.to.trim().toLowerCase(), now = new Date();
    if (context.type === 'access') {
      for (const item of context.draftTokens) {
        const token = await tx.applicationAccessToken.findUnique({ where: { id: item.id }, include: { draft: { include: { submittedApplication: true } } } });
        if (!token || token.draftId !== item.draftId || token.consumedAt || !['ACTIVE', 'SUBMITTED'].includes(token.draft.status)) throw new Error('MAIL_STATE_INVALID');
        if (token.expiresAt <= now || token.draft.expiresAt <= now) throw new Error('MAIL_EXPIRED');
        if (![token.draft.contactEmail, token.draft.submittedApplication?.email].some(email => email?.trim().toLowerCase() === to)) throw new Error('MAIL_STATE_INVALID');
        if (context.expected && token.draft.submittedApplicationId !== context.expected.applicationId) throw new Error('MAIL_STATE_INVALID');
      }
      // Read-only after ordered draft locks: never reverse the producer's application/draft lock order.
      if (context.expected) {
        const application = await tx.associationApplication.findUnique({ where: { id: context.expected.applicationId } });
        if (!application || (context.expected.selectionList && application.selectionList !== context.expected.selectionList)) throw new Error('MAIL_STATE_INVALID');
        if (context.expected.selectionApprovedAt !== undefined && (application.selectionApprovedAt?.toISOString() ?? null) !== context.expected.selectionApprovedAt) throw new Error('MAIL_STATE_INVALID');
        if (context.expected.informationRequestId) {
          const request = await tx.applicationInformationRequest.findUnique({ where: { id: context.expected.informationRequestId } });
          if (!request || request.applicationId !== application.id || request.status !== 'OPEN') throw new Error('MAIL_STATE_INVALID');
        }
      }
    } else if (context.type === 'reset' || context.type === 'credentials' || context.type === 'notice') {
      const account = await tx.account.findUnique({ where: { id: context.accountId } });
      if (!account || account.status !== 'ACTIVE' || account.email?.trim().toLowerCase() !== to) throw new Error('MAIL_STATE_INVALID');
      if (context.type !== 'notice') {
        const credential = await tx.authCredential.findFirst({ where: { accountId: context.accountId, type: 'EMAIL_PASSWORD' } });
        if (!credential || credential.secretHash !== context.credentialHash || (context.type === 'credentials' && !account.mustChangePassword)) throw new Error('MAIL_STATE_INVALID');
      }
      if (context.type === 'reset') {
        if (!Array.isArray(context.predecessorIds)) throw new Error('MAIL_PAYLOAD_INVALID');
        const token = await tx.passwordResetToken.findUnique({ where: { id: context.tokenId } });
        if (!token || token.accountId !== context.accountId || token.consumedAt || token.emailNormalized !== to) throw new Error('MAIL_STATE_INVALID');
        if (token.expiresAt <= now) throw new Error('MAIL_EXPIRED');
      }
    } else if (context.type === 'rejection') {
      const application = await tx.associationApplication.findUnique({ where: { id: context.applicationId } });
      if (!application || (application.status !== 'REJECTED' && application.eligibilityStatus !== 'FAILED') || application.email?.trim().toLowerCase() !== to || (context.expectedReason !== undefined && (application.rejectReason ?? application.eligibilityNotes ?? 'عدم استيفاء متطلبات المشاركة') !== context.expectedReason)) throw new Error('MAIL_STATE_INVALID');
    } else {
      const agreement = await tx.participationAgreement.findUnique({ where: { id: context.agreementId }, include: { associationAccount: true } });
      if (!agreement || agreement.status !== 'SIGNED' || !agreement.fullyExecutedAt || agreement.finalFileId !== context.fileId || agreement.finalSha256 !== context.sha256 || agreement.associationAccount?.email?.trim().toLowerCase() !== to) throw new Error('MAIL_STATE_INVALID');
      const marker = await tx.systemSetting.findUnique({ where: { key: context.markerKey } });
      const value = marker?.value as { status?: string; eventId?: string } | undefined;
      if (!value || value.eventId !== eventId || !['QUEUED', 'SENT'].includes(value.status ?? '')) throw new Error('MAIL_STATE_INVALID');
    }
  }

  private async suppressEmailCandidate(tx: Prisma.TransactionClient, context: DecryptedEmailDelivery['context']) {
    if (context.type === 'access') for (const token of context.draftTokens) await tx.applicationAccessToken.updateMany({ where: { id: token.id, draftId: token.draftId, consumedAt: null }, data: { consumedAt: new Date() } });
    if (context.type === 'reset') await tx.passwordResetToken.updateMany({ where: { id: context.tokenId, accountId: context.accountId, consumedAt: null }, data: { consumedAt: new Date() } });
  }

  private async covenantAttachment(delivery: DecryptedEmailDelivery) {
    const context = delivery.context;
    if (context.type !== 'covenant' || !this.storage) throw new Error('MAIL_CONFIGURATION_INVALID');
    const file = await prisma.fileObject.findUnique({ where: { id: context.fileId } });
    if (!file || file.bucket !== storageConfig.bucket || file.sha256 !== context.sha256 || file.mimeType !== 'application/pdf') throw new Error('MAIL_ATTACHMENT_INVALID');
    const content = await this.storage.getPrivateObject(file.objectKey);
    if (BigInt(content.length) !== file.sizeBytes || createHash('sha256').update(content).digest('hex') !== context.sha256) throw new Error('MAIL_ATTACHMENT_INVALID');
    return { filename: context.filename, content };
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
    const linkedEntity = event.type === OutboxEventType.ESCALATION_OPENED && typeof payload.escalationId === 'string'
      ? { entityType: 'escalation_cases', entityId: payload.escalationId }
      : typeof payload.missionId === 'string'
        ? { entityType: 'delivery_missions', entityId: payload.missionId }
        : { entityType: 'outbox_events', entityId: event.id };
    await prisma.notification.upsert({ where: { dedupeKey: `outbox:${event.id}` }, create: {
      associationId, audienceRole: target.role, type: String(event.type), title: target.title, body: target.body,
      severity: target.severity, ...linkedEntity, dedupeKey: `outbox:${event.id}`,
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
function isMailStateError(error: unknown) { return error instanceof Error && ['MAIL_STATE_INVALID', 'MAIL_EXPIRED'].includes(error.message); }
function mailAuditAction(type: DecryptedEmailDelivery['context']['type']) {
  return { access: 'APPLICATION_ACCESS_EMAIL_SENT', reset: 'PASSWORD_RESET_EMAIL_SENT', credentials: 'ONBOARDING_CREDENTIALS_EMAIL_SENT', rejection: 'APPLICATION_REJECTION_EMAIL_SENT', covenant: 'COVENANT_COMPLETION_EMAIL_SENT', notice: 'SECURITY_ALERT_EMAIL_SENT' }[type];
}
function describe(type: OutboxEventType) {
  if (type === OutboxEventType.DELIVERY_SUBMITTED) return { role: AccountRole.ASSOCIATION, title: 'تسليم بانتظار اعتماد الجمعية', body: 'أرسل المندوب إثبات التسليم وتوقيع المستفيد.', severity: NotificationSeverity.INFO };
  if (type === OutboxEventType.DELIVERY_ASSOCIATION_APPROVED) return { role: AccountRole.ADMIN, title: 'تسليم بانتظار اعتماد زاد', body: 'اعتمدت الجمعية التسليم وهو جاهز للاعتماد النهائي.', severity: NotificationSeverity.WARNING };
  if (type === OutboxEventType.RETURN_REQUESTED) return { role: AccountRole.ASSOCIATION, title: 'طلب إرجاع بانتظار الاستلام الفعلي', body: 'طلب المندوب إرجاع العهدة؛ لا تُحرر قبل التأكيد المادي.', severity: NotificationSeverity.WARNING };
  if (type === OutboxEventType.ESCALATION_OPENED) return { role: AccountRole.ADMIN, title: 'تصعيد تشغيلي جديد', body: 'يوجد تصعيد يحتاج قرار زاد.', severity: NotificationSeverity.WARNING };
  return { role: AccountRole.ADMIN, title: 'حدث تشغيلي', body: `حدث جديد: ${type}`, severity: NotificationSeverity.INFO };
}
