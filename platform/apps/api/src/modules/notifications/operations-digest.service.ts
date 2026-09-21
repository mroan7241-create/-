import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { prisma, Prisma } from '@alzad/db';
import { EmailService } from '../auth/email/email.service';
import type { AuthContext } from '../auth/auth.types';
import type { ScheduleStep1CompletionDto } from './schedule-step1-completion.dto';

const TIME_ZONE = 'Asia/Riyadh';
const DEFAULT_RECIPIENT = 'marwanalsawi@alzaad.org.sa';
const MAX_ATTEMPTS = 5;

type Marker = { status?: string; attempts?: number; sentAt?: string; lastError?: string };
type CompletionSchedule = { productionCommit?: string; verificationCompletedAt?: string; dueAt?: string; evidence?: Record<string, unknown> };

@Injectable()
export class OperationsDigestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OperationsDigestService.name);
  private timer?: NodeJS.Timeout;

  constructor(@Inject(EmailService) private readonly email: EmailService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.runScheduled().catch((error: unknown) => {
      this.logger.error(`فشل فحص التقرير التشغيلي: ${safeError(error)}`);
    }), 60_000);
    this.timer.unref();
    void this.runScheduled().catch((error: unknown) => this.logger.error(`فشل فحص التقرير التشغيلي الأولي: ${safeError(error)}`));
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async runScheduled(now = new Date()) {
    const completion = await this.runCompletionDue(now);
    const daily = await this.runDue(now);
    return { completion, daily };
  }

  async scheduleStep1Completion(ctx: AuthContext, dto: ScheduleStep1CompletionDto) {
    const completedAt = new Date(dto.verificationCompletedAt);
    if (!Number.isFinite(completedAt.getTime()) || completedAt.getTime() > Date.now() + 60_000) throw new Error('verificationCompletedAt is invalid');
    const commit = dto.productionCommit.toLowerCase();
    const idempotencyKey = `STEP1_COMPLETION_DIGEST:${commit}`;
    const marker = await prisma.systemSetting.findUnique({ where: { key: idempotencyKey } });
    if ((marker?.value as Marker | undefined)?.status === 'SENT') return { ok: true, alreadySent: true, idempotencyKey };
    const dueAt = new Date(completedAt.getTime() + 5 * 60_000);
    const key = `operations.step1.verification:${commit}`;
    const value = { productionCommit: commit, verificationCompletedAt: completedAt.toISOString(), dueAt: dueAt.toISOString(), evidence: dto.evidence } as Prisma.InputJsonValue;
    await prisma.$transaction([
      prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } }),
      prisma.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, associationId: ctx.associationId ?? null, action: 'STEP1_COMPLETION_DIGEST_SCHEDULED', entityType: 'system_settings', entityId: key, metadata: { productionCommit: commit, verificationCompletedAt: completedAt.toISOString(), dueAt: dueAt.toISOString() } } }),
    ]);
    return { ok: true, idempotencyKey, dueAt };
  }

  async runDue(now = new Date()) {
    const parts = riyadhParts(now);
    if (parts.hour !== 6) return { skipped: 'outside daily digest window' };
    const date = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
    const key = `DAILY_PLATFORM_DIGEST:${date}:${TIME_ZONE}`;
    if (!(await this.claim(key))) return { skipped: 'already sent or in progress', key };
    try {
      const last = await prisma.systemSetting.findUnique({ where: { key: 'operations.digest.lastSuccessfulAt' } });
      const cutoff = now;
      const from = readDate(last?.value) ?? new Date(cutoff.getTime() - 24 * 60 * 60 * 1000);
      const [applications, auditGroups, failedOutbox, backup, db] = await Promise.all([
        prisma.associationApplication.count({ where: { submittedAt: { gt: from, lte: cutoff } } }),
        prisma.auditLog.groupBy({ by: ['action'], where: { createdAt: { gt: from, lte: cutoff } }, _count: { _all: true }, orderBy: { action: 'asc' } }),
        prisma.outboxEvent.count({ where: { failedAt: { gt: from, lte: cutoff } } }),
        prisma.systemSetting.findUnique({ where: { key: 'operations.backup.lastSuccessful' } }),
        prisma.$queryRaw<Array<{ ok: number }>>(Prisma.sql`SELECT 1 AS ok`),
      ]);
      const events = auditGroups.length
        ? auditGroups.map((item) => `- ${item.action}: ${item._count._all}`).join('\n')
        : '- لا توجد أحداث مسجلة في الفترة';
      const commit = productionCommit();
      const backupStatus = backup ? 'ناجح ومسجل' : 'غير مسجل — يحتاج تدخلًا';
      const text = [
        `الفترة: (${from.toISOString()}, ${cutoff.toISOString()}]`,
        `طلبات جديدة: ${applications}`,
        'الأحداث الفعلية:', events,
        `أحداث Outbox الفاشلة: ${failedOutbox}`,
        `النسخ الاحتياطي: ${backupStatus}`,
        `Production commit: ${commit}`,
        `API: يعمل`, `Web: تحقق خارجي مطلوب`, `DB: ${db[0]?.ok === 1 ? 'يعمل' : 'غير متاح'}`,
        `يتطلب تدخلًا بشريًا: ${backup ? 'لا يوجد حسب البيانات الحالية' : 'إثبات النسخ الاحتياطي والاستعادة'}`,
      ].join('\n');
      await this.email.sendOperationalDigest({ to: recipient(), subject: `التقرير التشغيلي اليومي لمنصة الأجهزة الكهربائية — ${date}`, text });
      await prisma.$transaction([
        prisma.systemSetting.update({ where: { key }, data: { value: { status: 'SENT', attempts: 1, sentAt: cutoff.toISOString() } } }),
        prisma.systemSetting.upsert({ where: { key: 'operations.digest.lastSuccessfulAt' }, create: { key: 'operations.digest.lastSuccessfulAt', value: cutoff.toISOString() }, update: { value: cutoff.toISOString() } }),
        prisma.auditLog.create({ data: { action: 'DAILY_PLATFORM_DIGEST_SENT', entityType: 'system_settings', entityId: key, metadata: { from: from.toISOString(), cutoff: cutoff.toISOString(), commit } } }),
      ]);
      return { ok: true, key };
    } catch (error) {
      await this.fail(key, error);
      throw error;
    }
  }

  async runCompletionDue(now = new Date()) {
    const schedules = await prisma.systemSetting.findMany({ where: { key: { startsWith: 'operations.step1.verification:' } }, orderBy: { updatedAt: 'asc' } });
    let sent = 0;
    for (const row of schedules) {
      const schedule = (row.value ?? {}) as CompletionSchedule;
      const dueAt = readDate(schedule.dueAt);
      const commit = schedule.productionCommit?.toLowerCase();
      if (!dueAt || dueAt > now || !commit || !/^[0-9a-f]{40}$/.test(commit)) continue;
      const idempotencyKey = `STEP1_COMPLETION_DIGEST:${commit}`;
      if (!(await this.claim(idempotencyKey))) continue;
      try {
        const [applications, failedOutbox, migrations, db] = await Promise.all([
          prisma.associationApplication.count(),
          prisma.outboxEvent.count({ where: { status: 'FAILED' } }),
          prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`),
          prisma.$queryRaw<Array<{ ok: number }>>(Prisma.sql`SELECT 1 AS ok`),
        ]);
        const evidence = schedule.evidence ?? {};
        const lines = Object.entries(evidence).map(([key, value]) => `${key}: ${safeEvidence(value)}`);
        const subject = `اختبار جاهزية منصة الأجهزة الكهربائية – اكتمل التحقق – ${riyadhTimestamp(now)}`;
        const text = [
          'Step 1 status: VERIFIED_PRODUCTION_PENDING_EMAIL_PROOF',
          `Production commit: ${commit}`,
          `DB migrations: ${String(migrations[0]?.count ?? 0n)}`,
          `DB health: ${db[0]?.ok === 1 ? 'PASS' : 'FAIL'}`,
          `Application count: ${applications}`,
          `Outbox failures: ${failedOutbox}`,
          ...lines,
        ].join('\n');
        await this.email.sendOperationalDigest({ to: recipient(), subject, text });
        await prisma.$transaction([
          prisma.systemSetting.update({ where: { key: idempotencyKey }, data: { value: { status: 'SENT', attempts: 1, sentAt: now.toISOString() } } }),
          prisma.auditLog.create({ data: { action: 'STEP1_COMPLETION_DIGEST_SENT', entityType: 'system_settings', entityId: idempotencyKey, metadata: { productionCommit: commit, verificationCompletedAt: schedule.verificationCompletedAt, sentAt: now.toISOString() } } }),
        ]);
        sent += 1;
      } catch (error) {
        await this.fail(idempotencyKey, error);
      }
    }
    return { scanned: schedules.length, sent };
  }

  private async claim(key: string) {
    try {
      await prisma.systemSetting.create({ data: { key, value: { status: 'PROCESSING', attempts: 1 } } });
      return true;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const row = await prisma.systemSetting.findUnique({ where: { key } });
      const marker = (row?.value ?? {}) as Marker;
      if (marker.status === 'SENT' || marker.status === 'PROCESSING' || (marker.attempts ?? 0) >= MAX_ATTEMPTS) return false;
      const attempts = (marker.attempts ?? 0) + 1;
      await prisma.systemSetting.update({ where: { key }, data: { value: { status: 'PROCESSING', attempts } } });
      return true;
    }
  }

  private async fail(key: string, error: unknown) {
    const row = await prisma.systemSetting.findUnique({ where: { key } });
    const marker = (row?.value ?? {}) as Marker;
    const attempts = marker.attempts ?? 1;
    await prisma.$transaction([
      prisma.systemSetting.update({ where: { key }, data: { value: { status: 'FAILED', attempts, lastError: safeError(error).slice(0, 500) } } }),
      prisma.auditLog.create({ data: { action: 'DAILY_PLATFORM_DIGEST_FAILED', entityType: 'system_settings', entityId: key, metadata: { attempts } } }),
    ]);
  }
}

function recipient() { return process.env.DAILY_DIGEST_RECIPIENT?.trim() || DEFAULT_RECIPIENT; }
function productionCommit() { return process.env.APP_COMMIT_SHA?.trim() || process.env.GIT_COMMIT_SHA?.trim() || 'غير متاح'; }
function readDate(value: unknown) { const date = typeof value === 'string' ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? date : null; }
function safeError(error: unknown) { return error instanceof Error ? error.message : String(error); }
function isUniqueViolation(error: unknown) { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }
function pad(value: number) { return String(value).padStart(2, '0'); }
function riyadhParts(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') };
}
function safeEvidence(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).slice(0, 500);
  return JSON.stringify(value).slice(0, 500);
}
function riyadhTimestamp(value: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value).replace(',', '');
}
