import { Prisma } from '@alzad/db';

/**
 * أقفال PostgreSQL الاستشارية على مستوى المعاملة لمنع سباق "تكرار الجوال
 * داخل الجمعية" — NODE-3.1 (البند 4).
 *
 * ## المشكلة التي يحلّها
 * فحص التكرار كان `findFirst` ثم `create`/`update`: نافذة TOCTOU حقيقية.
 * طلبان متزامنان بنفس الجوال لنفس الجمعية يمرّان كلاهما من الفحص قبل أن
 * يكتب أيٌّ منهما، فينتهيان بصفّين متضاربين. لا يوجد قيد فريد على
 * `(association_id, phone)` في القاعدة — وإضافته كانت ستتطلّب migration
 * جديدة (ممنوعة في هذه الرقعة)، كما أنها **لا تغطي** أصلًا التصادم
 * المتقاطع بين `phone` و`secondary_phone` وهو جزء أصيل من القاعدة
 * القديمة (`findConfirmedDuplicateBeneficiary_` يقارن الرقم بالعمودين
 * معًا). القفل الاستشاري ميزة تشغيلية بحتة في Postgres: **بلا أي تغيير
 * على المخطط**.
 *
 * ## اشتقاق المفتاح
 * نص المفتاح: `beneficiary-phone:<associationId>:<normalizedPhone>` —
 * ثم `hashtextextended(text, 0)` داخل Postgres نفسه للحصول على `bigint`
 * حتمي (64-bit) يُمرَّر لِ`pg_advisory_xact_lock(bigint)`. اخترنا تجزئة
 * Postgres لا تجزئة JS لأنها حتمية عبر كل العمليات والإصدارات بلا أي
 * كود إضافي نصونه. النطاق **لكل (جمعية، جوال)**: لا قفل عام واحد، فلا
 * تتسلسل جمعيات/أرقام غير متعلقة ببعضها إطلاقًا — وقاعدة "نفس الرقم
 * مسموح عبر جمعيتين مختلفتين" تبقى كما هي حرفيًا لأن معرّف الجمعية جزء
 * من نص المفتاح.
 *
 * ## ترتيب الأقفال (منع الجمود)
 * حين تشمل العملية أكثر من رقم (أساسي + إضافي، أو القيم الحالية + الجديدة
 * عند التعديل) تُكتسَب الأقفال بترتيب **رقمي حتمي** حسب قيمة المفتاح
 * `bigint` تصاعديًا. معاملتان تتنافسان على نفس المفتاحين تطلبانهما بنفس
 * الترتيب حتمًا، فيستحيل الجمود المتبادل (deadlock) الكلاسيكي.
 *
 * القفل من نوع `xact`: يُحرَّر تلقائيًا عند COMMIT أو ROLLBACK، فلا
 * تسريب أقفال عند أي خطأ.
 */
const LOCK_NAMESPACE = 'beneficiary-phone';

/**
 * يكتسب قفلًا استشاريًا لكل (جمعية، جوال) من القائمة، بترتيب حتمي.
 * يجب استدعاؤها **داخل** المعاملة وقبل أي قراءة يُبنى عليها قرار الكتابة.
 */
export async function acquirePhoneLocks(
  tx: Prisma.TransactionClient,
  associationId: string,
  phones: (string | null | undefined)[],
): Promise<void> {
  const unique = Array.from(new Set(phones.filter((p): p is string => !!p)));
  if (unique.length === 0) return;

  const keyTexts = unique.map((phone) => `${LOCK_NAMESPACE}:${associationId}:${phone}`);

  // خطوة 1: احسب المفاتيح مرتَّبة تصاعديًا في استعلام واحد. الترتيب
  // يُفرَض هنا صراحةً بدل الاعتماد على ترتيب تقييم دوال في قائمة SELECT
  // (وهو غير مضمون في Postgres) — فيكون ترتيب الاكتساب حتميًا بالفعل.
  const rows = await tx.$queryRaw<{ lock_key: bigint }[]>`
    SELECT DISTINCT hashtextextended(k, 0) AS lock_key
    FROM unnest(${keyTexts}::text[]) AS k
    ORDER BY lock_key ASC
  `;

  // خطوة 2: اكتساب كل قفل على حدة بنفس هذا الترتيب بالضبط.
  for (const row of rows) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${row.lock_key}::bigint)`;
  }
}
