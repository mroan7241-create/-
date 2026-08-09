# SECURITY_MODEL.md

## نموذج الأدوار (بلا تغيير عن النظام القديم)

فقط ثلاثة أدوار (`AccountRole`) — **لا إضافة أدوار جديدة الآن**:

- `ADMIN` — صلاحية كاملة حسب النظام الحالي.
- `ASSOCIATION` — محصور بجمعيته الخاصة (`association_id`) فقط، على كل
  نطاق بيانات (مستفيدون، احتياجات، محاضر استلام، مخزون، مناديب،
  تسليمات).
- `DELEGATE` — لا يرى إلا المهمات المخصَّصة له (`delivery_missions`
  حيث `delegate_account_id = هو`) ضمن جمعيته.

## Tenant Isolation — قاعدة صارمة

`association_id` موجود على كل كيان مملوك لجمعية (راجع `schema.prisma`)
حيث يفيد ذلك. **التحقق دائمًا Server-side** — لا اعتماد على إخفاء عناصر
واجهة، تمامًا كمبدأ النظام القديم (`listBeneficiaries_` في
`Beneficiaries.gs` يفرض `rows.filter(row => row['association_id'] ===
user.associationId)` بصرف النظر عمّا يرسله العميل في الطلب، ولا يثق
بأي `associationId` قادم من الـpayload لمستخدم ASSOCIATION).

القاعدة المكافئة في المنصة الجديدة: كل query في Services (لا
Controllers) يجب أن يتضمن شرط `association_id` مشتقًا من الجلسة
المصادَق عليها فقط — **لا** من أي حقل في الـDTO الوارد من العميل، حتى
لو أرسله. هذا يُفرض بـautomated authorization/tenant isolation tests
منذ NODE-1 (وليس اختبارًا لاحقًا اختياريًا).

## المصادقة (منفَّذة فعليًا منذ NODE-1 — راجع AUTHENTICATION.md للتفصيل الكامل)

- كلمات المرور: `secret_hash` فقط (لا نص صريح أبدًا) — **Argon2id**
  حصرًا (`memoryCost=19456 KiB`, `timeCost=2`, `parallelism=1`، قابلة
  للضبط عبر env). `previous_secret_hash` يمنع إعادة استخدام كلمة
  المرور فورًا بعد تغييرها (نفس مبدأ "كلمة مرور سابقة مشفرة" في ورقة
  "المستخدمون" القديمة).
- رموز دخول المناديب (`DELEGATE_ACCESS_CODE`): نفس معاملة كلمة المرور
  (Argon2id hash فقط، لا نص صريح) — فحص خطي بمقارنة زمن ثابت عبر
  `argon2.verify` لكل بيانات اعتماد نشطة (الرمز لا يُفهرَس مباشرة لأنه
  السرّ نفسه).
- **الجلسات opaque server-side** — رمز عشوائي (`crypto.randomBytes(32)`)
  عبر كوكي `HttpOnly`/`Secure` (إنتاج)/`SameSite=Lax`؛ **لا JWT عديم
  الحالة**، ولا تخزين للرمز في `localStorage`/`sessionStorage` إطلاقًا.
  يُخزَّن فقط `SHA-256(token)` في `auth_sessions.token_hash`. Sliding
  TTL = 6 ساعات، سقف مطلق = 12 ساعة لا يُمدَّد أبدًا.
- **إبطال الجلسات**: تغيير كلمة المرور، إعادة تعيينها (بالبريد أو عبر
  ADMIN)، أو تسجيل الخروج — كلها تُبطل `auth_sessions` عبر `revoked_at`
  (تغيير كلمة المرور يُبطل **كل** جلسات الحساب، بما فيها الحالية). حساب
  `SUSPENDED` أو جمعية `INACTIVE` تُكتشَف فورًا في `SessionAuthGuard`
  على أول طلب تالٍ حتى لو كانت الجلسة نفسها لا تزال ضمن TTL — لا جلسة
  قديمة تبقى فعّالة بعد تغيير حالة أمني حرج.
- **الحدّ من المعدَّل (rate limiting)**: DB-backed حصرًا (`auth_rate_limits`،
  لا Redis) — يعمل بشكل صحيح عبر أكثر من instance واحد للـAPI.

## الملفات (`files`) — PRIVATE دائمًا

لا Public URL دائم لأي ملف (تراخيص جمعيات، صور استلام، صور تلف،
توقيعات، إثباتات تسليم) — الوصول فقط عبر:

1. طلب موقَّع بالجلسة (Authorization header) إلى endpoint مخصَّص.
2. الـService يتحقق من tenant isolation + الدور (مثلًا: ASSOCIATION لا
   يرى ملف تسليم مستفيد ليس تابعًا لجمعيته) قبل أي إصدار.
3. عند النجاح فقط: signed URL **مؤقت** (مدة صلاحية قصيرة) يُصدَر
   للعميل — لا رابط دائم يُخزَّن أو يُشارَك.

هذا يطابق ترقية Phase 3.1.1 §6 في النظام القديم ("توقيع حقيقي بصورة +
endpoint إثباتات محروس") ويُعمَّم على كل فئات الملفات، لا فقط توقيع
الاستلام.

## Idempotency كخط دفاع أمني أيضًا

`idempotency_keys` (`UNIQUE (account_id, scope, key)`) يمنع إعادة تنفيذ
عملية حساسة (اعتماد مستفيد، تأكيد محضر) مرتين بسبب إعادة إرسال شبكي —
نفس الفلسفة الأمنية/الوظيفية لـ`runLockedIdempotent_` في النظام القديم
لكن بآلية durable حقيقية بدل Cache مؤقت.

## Audit — append-only، غير قابل للتعديل من التطبيق العادي

`audit_logs` لا تملك أي مسار `UPDATE`/`DELETE` في طبقة الخدمات — إدراج
فقط. فشل تسجيل حركة تدقيق بعد نجاح عملية أساسية لا يُسقط تلك العملية
(نفس مبدأ عزل audit في `reviewBeneficiaryNeeds_`)، لكنه لا يعني أبدًا
السماح بتعديل سجل تدقيق موجود.

## Validation

كل DTO يستخدم `class-validator` + `ValidationPipe({whitelist: true,
forbidNonWhitelisted: true})` — أي حقل غير معرَّف صراحة في الـDTO
يُرفض الطلب كاملًا (لا تجاهل صامت لحقول إضافية قد تحمل نية خبيثة).

## أسرار

- لا أي secret حقيقي في GitHub — `.env.example` قيم تطوير وهمية فقط
  (`change-me-dev-only`).
- `SESSION_TOKEN_PEPPER` وما شابه: قيم بيئة إنتاجية حقيقية تُدار خارج
  المستودع بالكامل (secret manager عند النشر الفعلي — خارج نطاق
  NODE-0).

## ما لم يُنفَّذ بعد (بصراحة)

منذ NODE-1: يوجد `SessionAuthGuard` عالمي حقيقي (`APP_GUARD`) يفرض
الجلسة/الدور/`mustChangePassword`/حالة الحساب والجمعية على **كل**
endpoint غير `@Public()` — موثَّق بالكامل في `AUTHENTICATION.md` ومُختبَر
بـ54 اختبار تكامل/أمان حقيقي. ما لا يزال غير منفَّذ: tenant isolation
الكامل على نطاقات الأعمال (مستفيدون/أجهزة/محاضر...) لأن تلك الـmodules
نفسها لا تزال `NOT_STARTED`/`FOUNDATION_READY` (راجع FEATURE_PARITY.md)
— القاعدة الموصوفة أعلاه في "Tenant Isolation" تبقى الخطة التي يُقاس
تنفيذ NODE اللاحقة عليها لكل نطاق أعمال فعلي. مزوّد بريد Production
حقيقي، واستيراد كلمات مرور Production القديمة، كلاهما مؤجَّل صراحة.
