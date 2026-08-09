import { Injectable } from '@nestjs/common';
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
 * instance). نفس دلالة legacy throttle_: نافذة تُجدَّد (TTL يُعاد ضبطه
 * لكامل windowSeconds) عند كل محاولة طالما لم تنقضِ — فطالما استمرت
 * المحاولات فالنافذة لا تنتهي إلا بفجوة صمت >= windowSeconds.
 *
 * التزامن: upsert ذري واحد عبر ON CONFLICT — لا حاجة لقفل تطبيقي، آمن
 * عبر أكثر من instance يكتب لنفس (scope, subject_hash) في آنٍ واحد.
 */
@Injectable()
export class RateLimitService {
  /** يزيد العدّاد لو النافذة سارية، أو يبدأ نافذة جديدة لو انتهت — يرمي AUTH_RATE_LIMITED عند تجاوز الحد. */
  async consume(scope: string, subjectRaw: string, rule: RateLimitRule): Promise<void> {
    const subjectHash = hmacHex(`${scope}:${subjectRaw}`);
    const now = new Date();
    const windowMs = rule.windowSeconds * 1000;

    const rows = await prisma.$queryRaw<{ attempt_count: number }[]>`
      INSERT INTO auth_rate_limits (id, scope, subject_hash, window_started_at, attempt_count, expires_at, created_at, updated_at)
      VALUES (uuidv7(), ${scope}, ${subjectHash}, ${now}, 1, ${new Date(now.getTime() + windowMs)}, ${now}, ${now})
      ON CONFLICT (scope, subject_hash) DO UPDATE SET
        attempt_count = CASE
          WHEN auth_rate_limits.expires_at > ${now} THEN auth_rate_limits.attempt_count + 1
          ELSE 1
        END,
        window_started_at = CASE
          WHEN auth_rate_limits.expires_at > ${now} THEN auth_rate_limits.window_started_at
          ELSE ${now}
        END,
        expires_at = ${new Date(now.getTime() + windowMs)},
        updated_at = ${now}
      RETURNING attempt_count;
    `;

    const attemptCount = rows[0]?.attempt_count ?? 1;
    if (attemptCount > rule.limit) {
      throw authRateLimited();
    }
  }

  /**
   * استراتيجية تنظيف (موثَّقة): لا مهمة دورية (cron) في NODE-1 — الصفوف
   * منتهية الصلاحية غير مؤذية (upsert يعيد استخدامها فور انتهاء
   * expires_at)، وحجم الجدول محدود بعدد الهويات الفريدة الفعلية. عند
   * الحاجة لاحقًا: `DELETE FROM auth_rate_limits WHERE expires_at < now() - interval '1 day'`
   * كمهمة دورية بسيطة — لم تُنفَّذ الآن لأنها ليست ضرورة أمنية أو
   * وظيفية في هذه المرحلة.
   */
}
