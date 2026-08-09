import { Global, Module } from '@nestjs/common';
import { PublicCodeService } from './public-code.service';
import { IdempotencyService } from './idempotency.service';

/**
 * NODE-3 — مزوّد **واحد** مشترك للأوّليات المشتركة عديمة الحالة
 * (`PublicCodeService` / `IdempotencyService`).
 *
 * لماذا وُحِّدت هنا بدل تكرارها في providers كل module:
 * كانت كل وحدة تُعلن `PublicCodeService` في مصفوفة providers الخاصة بها،
 * فيبني Nest **نسخة مستقلة لكل وحدة** (المزوّد ليس عالميًا، ونطاقه وحدته).
 * ذلك كان يعمل صدفةً لأن السلوك عديم الحالة، لكنه جعل `app.get(Token)`
 * غير محدَّد فعليًا: يُعيد نسخة أول وحدة يجدها في الرسم البياني، لا
 * "النسخة" التي تستخدمها وحدة بعينها. أي اختبار يتجسّس على النسخة
 * المُعادة من `app.get(...)` كان يتجسّس على كائن قد لا يستخدمه أحد.
 *
 * ظهر هذا فعليًا عند إضافة وحدة ثالثة تستهلك `PublicCodeService` في
 * NODE-3: تغيّر ترتيب الحلّ، فتوقّف تجسّس اختبارَي التعويض في NODE-2 عن
 * إصابة النسخة التي تستدعيها `ApplicationsService`، وسقط اختباران كانا
 * أخضرين — دون أي خلل حقيقي في منطق NODE-2 نفسه.
 *
 * الحل الصحيح (لا تعديل الاختبارات): مزوّد `@Global` واحد ⇒ نسخة واحدة
 * في التطبيق كله ⇒ `app.get(...)` يُعيد حتمًا نفس الكائن الذي تحقنه كل
 * وحدة. هذا يستعيد المعنى المقصود أصلًا من الاختبارَين بلا إضعاف أي
 * تأكيد فيهما.
 */
@Global()
@Module({
  providers: [PublicCodeService, IdempotencyService],
  exports: [PublicCodeService, IdempotencyService],
})
export class CommonModule {}
