import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { prisma } from '@alzad/db';
import { hmacHex } from './crypto.util';
import { authRateLimited } from './api-error';

interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

/**
 * حدّ معدَّل دائم (DB-backed) — يستبدل throttle_ القديم المبني على
 * CacheService (لا يصلح إلا لعملية واحدة؛ منصتنا قد تعمل على أكثر من
 * instance). Fixed window: أول محاولة تحدد expires_at، ولا تمددها
 * المحاولات اللاحقة، حتى بعد بلوغ الحد.
 *
 * التزامن: upsert ذري واحد عبر ON CONFLICT — لا حاجة لقفل تطبيقي، آمن
 * عبر أكثر من instance يكتب لنفس (scope, subject_hash) في آنٍ واحد.
 */
@Injectable()
export class RateLimitService implements OnModuleInit {
  private static cleanupTimer: NodeJS.Timeout | null = null;
  private readonly logger = new Logger(RateLimitService.name);

  onModuleInit(): void {
    if (RateLimitService.cleanupTimer) return;
    // Limited indexed cleanup, not a DELETE on every request. Each instance may
    // race safely with another instance via SKIP LOCKED.
    RateLimitService.cleanupTimer = setInterval(() => {
      void this.cleanupExpired().catch(() => this.logger.warn('Rate-limit cleanup failed; the next cycle will retry.'));
    }, 5 * 60 * 1000);
    RateLimitService.cleanupTimer.unref();
  }

  /** يزيد العدّاد لو النافذة سارية، أو يبدأ نافذة جديدة لو انتهت — يرمي AUTH_RATE_LIMITED عند تجاوز الحد. */
  async consume(scope: string, subjectRaw: string, rule: RateLimitRule): Promise<void> {
    if (!Number.isInteger(rule.limit) || rule.limit < 1 || !Number.isFinite(rule.windowSeconds) || rule.windowSeconds <= 0) {
      throw new Error('Invalid rate-limit rule');
    }
    const subjectHash = hmacHex(`${scope}:${subjectRaw}`);
    const now = new Date();
    const windowMs = rule.windowSeconds * 1000;

    const rows = await prisma.$queryRaw<{ attempt_count: number }[]>`
      INSERT INTO auth_rate_limits (id, scope, subject_hash, window_started_at, attempt_count, expires_at, created_at, updated_at)
      VALUES (uuidv7(), ${scope}, ${subjectHash}, ${now}, 1, ${new Date(now.getTime() + windowMs)}, ${now}, ${now})
      ON CONFLICT (scope, subject_hash) DO UPDATE SET
        attempt_count = CASE
          WHEN auth_rate_limits.expires_at > ${now} THEN LEAST(auth_rate_limits.attempt_count + 1, ${rule.limit + 1})
          ELSE 1
        END,
        window_started_at = CASE
          WHEN auth_rate_limits.expires_at > ${now} THEN auth_rate_limits.window_started_at
          ELSE ${now}
        END,
        expires_at = CASE
          WHEN auth_rate_limits.expires_at > ${now} THEN auth_rate_limits.expires_at
          ELSE ${new Date(now.getTime() + windowMs)}
        END,
        updated_at = ${now}
      RETURNING attempt_count;
    `;

    const attemptCount = rows[0]?.attempt_count ?? 1;
    if (attemptCount > rule.limit) {
      throw authRateLimited();
    }
  }

  /** Uses the existing expires_at index; never deletes an active window. */
  async cleanupExpired(): Promise<number> {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      WITH expired AS (
        SELECT id FROM auth_rate_limits
        WHERE expires_at < now()
        ORDER BY expires_at
        LIMIT 5000
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM auth_rate_limits AS limits
      USING expired
      WHERE limits.id = expired.id
      RETURNING limits.id
    `;
    return rows.length;
  }
}
