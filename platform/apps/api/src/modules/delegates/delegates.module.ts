import { Module } from '@nestjs/common';
import { DelegatesController } from './delegates.controller';
import { DelegatesService } from './delegates.service';
import { RateLimitService } from '../../common/rate-limit.service';

/**
 * `PublicCodeService`/`IdempotencyService` تُحقَن من `CommonModule`
 * العالمي (`@Global`) — لا تُعاد إعلانها هنا؛ راجع تعليق NODE-3 في
 * common/common.module.ts لسبب دقيق (تعدُّد نسخ كان يكسر تجسّس
 * الاختبارات فعليًا). `RateLimitService` عديم الحالة أيضًا لكنه غير
 * عالمي بعد — نفس نمط applications.module.ts/auth.module.ts.
 */
@Module({
  controllers: [DelegatesController],
  providers: [DelegatesService, RateLimitService],
})
export class DelegatesModule {}
