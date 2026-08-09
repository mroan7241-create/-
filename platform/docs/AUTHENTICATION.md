# المصادقة والجلسات (NODE-1)

مرجع سلوكي لكل ما نُفِّذ في NODE-1: تسجيل الدخول، الجلسات، الأدوار،
سياق المستأجر (tenant context)، إعادة تعيين كلمة المرور، والحدّ من
المعدَّل (rate limiting). المصدر السلوكي لكل قاعدة هنا هو الفرع القديم
(`Auth.gs`، `Validation.gs`، `ExecutionTracking.gs`،
`DevicesAssociations.gs`) ما لم يُذكَر خلاف ذلك صراحةً كـ"انحراف
متعمَّد" — قُرئت هذه الملفات بالكامل قبل التنفيذ، لا اعتمادًا على
الملخصات.

---

## 0) تحديث NODE-1.1 — Auth Security & Session Correctness Patch

أربعة إصلاحات على منطق NODE-1 (لا تغيير في القواعد المعتمدة: idle 6h/
absolute 12h/سياسة كلمة المرور/الأدوار/ReferenceData — بلا أي migration
جديدة، `AuthCredential.identifier` كان يكفي أصلًا):

1. **عمر كوكي الجلسة** يطابق الآن `absoluteExpiresAt` (12h)، لا
   `expiresAt` المنزلق الأول (6h) — راجع §3 أدناه. قبل هذا الإصلاح كان
   المتصفح يحذف الكوكي بعد 6 ساعات حتى لو كانت الجلسة ممتدة فعليًا في DB.
2. **دخول المندوب O(1)** بدل فحص خطي (`findMany` + Argon2 على كل بيانات
   اعتماد نشطة) — عبر `AuthCredential.identifier = HMAC-SHA256(normalized
   code, AUTH_CREDENTIAL_LOOKUP_HMAC_KEY)`. راجع §2.1.
3. **تجزئة رمز إعادة تعيين كلمة المرور** أصبحت HMAC-SHA256 بمفتاح مخصَّص
   (`AUTH_RESET_TOKEN_HMAC_KEY`) بدل SHA-256 عادٍ — الرمز (8 خانات) أقل
   entropy بكثير من رمز جلسة عشوائي. راجع §8.
4. **حدود معاملة `confirmPasswordReset`**: تدقيق `PASSWORD_RESET_COMPLETED`
   يُسجَّل الآن بعد commit المعاملة فعليًا، لا من داخلها.
5. **رفض إقلاع Production** إن بقي أيٌّ من مفاتيح HMAC الثلاثة
   (`AUTH_RATE_LIMIT_HMAC_KEY`, `AUTH_CREDENTIAL_LOOKUP_HMAC_KEY`,
   `AUTH_RESET_TOKEN_HMAC_KEY`) بقيمته الافتراضية للتطوير —
   `assertProductionSecretsConfigured()` في `main.ts`.

## 0.1) تحديث NODE-1.2 — Production Secret Validation Hardening

فحص `assertProductionSecretsConfigured()` كان يرفض فقط القيم
الافتراضية المعروفة للتطوير — لكنه كان يقبل ضمنيًا في `NODE_ENV=production`:
قيمة فارغة (`""`)، قيمة تحوي مسافات فقط، سرًّا قصيرًا جدًا، أو نفس
السرّ مُعادًا استخدامه لأكثر من غرض (لأن `authConfig.*HmacKey` يستبدل
أي قيمة env "falsy لكن ليست nullish" — مثل `""` — بالافتراضي التطويري
ضمنيًا عبر `??`، فيُخفي هذه الحالات عن الفحص). الفحص الآن **يقرأ
متغيرات البيئة الخام مباشرة** (لا القيم بعد fallback) ويطبِّق على كل
واحد من الثلاثة **أربعة شروط**:

1. موجود وغير فارغ بعد `trim()` — لا مفقود، لا فارغ، لا whitespace فقط.
2. ليس القيمة الافتراضية المخصَّصة للتطوير (`*_DEV_DEFAULT` من `packages/shared/src/auth-secrets.ts`).
3. طوله (UTF-8 بايت، بعد trim) **≥ 32 بايت** (256 بت عشوائية على الأقل).
4. مختلف تمامًا عن قيمتَي المتغيرين الآخرين — لا يُعاد استخدام مفتاح واحد لأكثر من غرض.

رسالة الخطأ عند الفشل تذكر **أسماء** المتغيرات غير الصالحة فقط —
لا تطبع أي قيمة سرّية إطلاقًا، حتى في حالة الفشل نفسها.

---

## 1) الأدوار الثلاثة

`ADMIN` و`ASSOCIATION` و`DELEGATE` فقط — لا رابع. `ADMIN`/`ASSOCIATION`
يدخلان ببريد+كلمة مرور، `DELEGATE` برمز دخول (`MND-XXXXXX`).

## 2) تسجيل الدخول — `POST /api/v1/auth/login`

جسم الطلب Discriminated Union حسب `type`:

```json
{ "type": "user", "email": "...", "password": "..." }
{ "type": "delegate", "code": "MND-XXXXXX" }
```

### ADMIN/ASSOCIATION (`loginUser`)
1. تطبيع البريد (trim + lowercase). شكل غير صالح أو كلمة مرور فارغة → `AUTH_INVALID_CREDENTIALS` فورًا (بلا استهلاك rate limit).
2. استهلاك rate limit `login:user` (8 محاولات/15 دقيقة لكل بريد).
3. بحث `AuthCredential` من نوع `EMAIL_PASSWORD` بالبريد. إن لم يوجد، أو الحساب غير ACTIVE، أو الدور ليس ADMIN/ASSOCIATION، أو كلمة المرور خاطئة → **خطأ عام واحد موحَّد** `AUTH_INVALID_CREDENTIALS` (401) + تأخير 350ms (يطابق `Utilities.sleep(350)` القديم لتعمية زمن الاستجابة). **لا يُكشَف** أيّ من هذه الحالات عن الأخرى — هذا يطابق سلوك `.find()` في `Auth.gs` القديم الذي يُرشِّح على `status==='نشط'` ضمن نفس شرط البحث.
4. إن كان الدور `ASSOCIATION`: يُتحقَّق أن `associationId` موجود وأن الجمعية `ACTIVE` — **بعد** نجاح كلمة المرور فقط، ويُستثنى ADMIN من هذا الفحص تمامًا (يطابق `assertActorEnabled_`). الفشل هنا خطأ **مميَّز** `AUTH_ASSOCIATION_DISABLED` (403) — لا يُطوى ضمن الخطأ العام، لأنه لا يكشف شيئًا لم يثبته المستخدم أصلًا بنجاح كلمة المرور.
5. نجاح: إنشاء جلسة، تحديث `lastLoginAt`، تدقيق `LOGIN_SUCCESS`.

### DELEGATE (`loginDelegate`)
1. تنسيق الرمز يجب أن يطابق `^MND-[A-Z0-9]{6,12}$` وإلا `AUTH_INVALID_CREDENTIALS` فورًا (بعد تطبيع: trim + uppercase — `normalizeDelegateCode`).
2. استهلاك rate limit `login:delegate` (8/15 دقيقة لكل رمز).
3. **بحث O(1)، لا فحص خطي** (منذ NODE-1.1 — راجع §2.1 أدناه): `identifier` في `AuthCredential` هو `HMAC-SHA256(normalized code, AUTH_CREDENTIAL_LOOKUP_HMAC_KEY)`، فيتيح `findUnique` مباشرًا بدل `findMany` + حلقة `argon2.verify` على كل بيانات اعتماد المناديب النشطة.
4. بعد إيجاد الصف عبر lookup hash: **يبقى `argon2.verify` إلزاميًا** (دفاع متعمَّق — lookup وحده لا يُعتبَر إثبات هوية كافيًا).
5. باقي القواعد مطابقة لمسار ASSOCIATION (فحص حالة الجمعية بعد نجاح الرمز، تدقيق، جلسة).

### 2.1) دخول المندوب — تصميم lookup الآمن (NODE-1.1)

**المشكلة الأصلية (NODE-1)**: بما أن رمز المندوب هو السرّ نفسه ولا
يُخزَّن خامًا، لم يكن هناك عمود يمكن الاستعلام المباشر عنه — فكان
`loginDelegate` يجلب **كل** بيانات اعتماد `DELEGATE_ACCESS_CODE`
النشطة (`findMany`) ثم يشغّل `argon2.verify` عليها واحدًا واحدًا حتى
يجد تطابقًا (O(n) في عدد المناديب، ويزداد بطئًا خطيًا مع نمو قاعدة
المستخدمين).

**الحل (NODE-1.1)**: `AuthCredential.identifier` (عمود موجود أصلًا في
الـschema، بلا أي migration جديدة) يُخزَّن الآن كـ**lookup hash** حتمي
(deterministic) — لا الرمز الخام ولا placeholder غير سرّي:

```
normalized = normalizeDelegateCode(rawCode)         // trim + uppercase
identifier = HMAC-SHA256(normalized, AUTH_CREDENTIAL_LOOKUP_HMAC_KEY)
secretHash = Argon2id(normalized)                    // بلا تغيير عن NODE-1
```

عند الدخول: `findUnique({type_identifier: {type: DELEGATE_ACCESS_CODE,
identifier: computeLookupHash(normalizedInput)}})` — استعلام واحد،
لا فحص خطي. الدالتان `normalizeDelegateCode`/`computeCredentialLookupHash`
مُعرَّفتان مرة واحدة في `packages/shared/src/credential-lookup.ts` (مصدر
حقيقة وحيد يستخدمه كل من `apps/api` عند الدخول، و`packages/db/src/seed.ts`
عند البذر) — **أي كود مستقبلي** يُنشئ أو يُجدِّد رمز دخول مندوب (مثل
`saveDelegate`/`regenerateDelegateCode` في NODE-6) **يجب** استخدام نفس
الدالتين المشتركتين، لا اختراع تطبيع/hash منفصل.

لماذا HMAC لا SHA-256 عادي لهذا الغرض تحديدًا؟ لأن `identifier` مخزَّن
كنص عادي غير سرّي منطقيًا (فهرس بحث)، لكنه مشتق من رمز المندوب الفعلي —
استخدام hash بلا مفتاح سرّي كان سيسمح لأي طرف يملك نسخة من قاعدة
البيانات (تسريب/نسخة احتياطية) بحساب lookup hash لأي رمز مُخمَّن
ومطابقته مباشرة دون الحاجة لكسر Argon2id إطلاقًا. مفتاح HMAC السرّي
(`AUTH_CREDENTIAL_LOOKUP_HMAC_KEY`) يمنع ذلك — مطابقة الـidentifier لا
تثبت شيئًا بدون معرفة المفتاح السرّي أيضًا، وArgon2id يبقى خط الدفاع
الثاني الإلزامي حتى بعد نجاح lookup.

كلا المسارين يُرجعان نفس الشكل عند النجاح: `{ ok: true, user: {...} }` مع تعيين كوكي `alzad_session`.

---

## 3) الجلسات — Opaque Server-Side Sessions

**قرار معماري مُلزم**: لا JWT عديم الحالة. الجلسة رمز عشوائي
(`crypto.randomBytes(32).toString('base64url')`) يُرسَل للعميل **مرة
واحدة فقط** داخل كوكي؛ لا يُخزَّن الرمز الخام في قاعدة البيانات إطلاقًا
— فقط `SHA-256(token)` في `auth_sessions.token_hash`.

### الكوكي
- الاسم: `alzad_session`.
- `HttpOnly=true` — غير قابل للقراءة من JavaScript إطلاقًا (لا XSS-exfiltration).
- `Secure=true` في الإنتاج فقط (`NODE_ENV==='production'`)؛ `false` محليًا للسماح بـ`http://localhost`.
- `SameSite=Lax`، `Path=/`.
- **عمر الكوكي (`Expires`) = `absoluteExpiresAt` (السقف المطلق 12h)، لا `expiresAt` المنزلق (idle 6h)** — إصلاح NODE-1.1. قبل هذا الإصلاح كانت الكوكي تُضبَط بعمر idle الأول (6h)، فيحذفها المتصفح عند تلك الساعة حتى لو كانت الجلسة نفسها لا تزال ممتدة في DB (تم تمديد `expires_at` عبر طلبات موثَّقة لاحقة). الكوكي غلاف نقل فقط — لا تفرض idle timeout بذاتها؛ الخادم (`SessionAuthGuard`) هو الحكم الوحيد لصلاحية الجلسة الفعلية على كل طلب عبر `expires_at`/`absolute_expires_at` في DB. لا حاجة لإعادة إرسال الكوكي عند كل تمديد منزلق، لأن عمرها الثابت (absolute) لا يتغيّر أصلًا طوال حياة الجلسة.
- **ممنوع تمامًا**: `localStorage`، `sessionStorage`، أو أي تخزين قابل لقراءة JS لرمز الجلسة — لا في الواجهة (`apps/web`) ولا في أي عميل آخر.

### دورة الحياة (تطابق `APP.sessionSeconds`/`APP.maxSessionSeconds` القديمة تمامًا)
- **Idle/Sliding TTL**: 6 ساعات (`21600` ثانية) — `AUTH_SESSION_IDLE_SECONDS`.
- **Absolute cap**: 12 ساعة (`43200` ثانية) — `AUTH_SESSION_ABSOLUTE_SECONDS`، ثابت منذ الإنشاء، **لا يُمدَّد أبدًا**.

كل طلب موثَّق (`SessionAuthGuard`) ينفّذ بالترتيب:
1. قراءة الكوكي، حساب `SHA-256(token)`، بحث `auth_sessions` (مع `account`+`association`).
2. غير موجودة، أو `revokedAt IS NOT NULL`، أو `expiresAt <= now`، أو `absoluteExpiresAt <= now`، أو الحساب ليس ACTIVE، أو (إن كان الدور مربوطًا بجمعية) الجمعية ليست ACTIVE → **جميعها** ترفض بنفس الخطأ الموحَّد `AUTH_SESSION_EXPIRED` (401) — تعمُّد عدم كشف السبب الدقيق لجلسة قائمة أصلًا فشلت لاحقًا (فرق عن رفض تسجيل الدخول، الذي له أكواد مميَّزة عند الاقتضاء).
3. نجاح: تمديد الجلسة — `expiresAt = min(now + 6h, absoluteExpiresAt)` — **لا يتجاوز أبدًا** السقف المطلق.

### تسجيل الخروج — `POST /auth/logout`
يضبط `revoked_at = now()` في معاملة، يمسح الكوكي، تدقيق `LOGOUT`.
**Idempotent من ناحية الأمان**: استدعاء `logout` على جلسة مُبطَلة سلفًا (أو غير موجودة) يُرجع 401 `AUTH_SESSION_EXPIRED` الموحَّد — لا خطأ غريب أو استثناء غير متوقَّع.

---

## 4) تجزئة كلمات المرور — Argon2id

كل بيانات الاعتماد الجديدة (بريد+كلمة مرور، ورموز دخول المناديب) تُجزَّأ
بـ**Argon2id** حصرًا (`argon2` npm package). **ممنوع**: SHA-256 عادي،
bcrypt بلا داعٍ، نص صريح، أو تشفير قابل للعكس.

المعاملات (`apps/api/src/config/auth.config.ts#argon2`, قابلة للضبط عبر env):
`memoryCost=19456 KiB` (~19MiB، الحد الأدنى الموصى به من OWASP)،
`timeCost=2`، `parallelism=1`.

`AuthCredential.secretHash` = الـhash المُرمَّز الكامل من Argon2.
`previousSecretHash` يُحتفَظ به لمنع إعادة استخدام كلمة المرور فورًا
بعد تغييرها (سلوك قديم من `assertPasswordPolicy_`).

**لا استيراد لكلمات مرور Production القديمة في NODE-1** — قرار
مؤجَّل صراحة إلى NODE-8، مع استراتيجية توافق/rehash-on-first-login
موثَّقة في `LEGACY_DATA_MIGRATION.md`.

---

## 5) `mustChangePassword` — بوابة عالمية على مستوى الخادم

إن كان `mustChangePassword=true` **و** الدور `ASSOCIATION`: الجلسة
تُنشأ بنجاح، لكن **أي** endpoint محمي آخر غير المعفى صراحةً
بـ`@AllowMustChangePassword()` يُرفَض بـ403 `AUTH_PASSWORD_CHANGE_REQUIRED`
— يُفحَص هذا داخل `SessionAuthGuard` نفسه (لا منطق واجهة، ولا تكرار في
كل Controller). الـendpoints المعفاة حصرًا: `GET /auth/me`،
`POST /auth/logout`، `PATCH /auth/password`. بعد نجاح تغيير كلمة
المرور: `mustChangePassword=false`.

---

## 6) `GET /api/v1/auth/me`

endpoint بنيوي جديد (لا مقابل مباشر له في القديم) — يعيد فقط:
`{ id, publicCode, name, role, associationId, mustChangePassword }`.
لا كلمة مرور ولا hash ولا رمز جلسة في أي استجابة API إطلاقًا — مُتحقَّق
منه صراحةً في الاختبارات (بند 28 من مجموعة الاختبارات).

---

## 7) `PATCH /api/v1/auth/password`

`ADMIN`/`ASSOCIATION` فقط، يعمل حتى لو `mustChangePassword=true`.
1. التحقق من كلمة المرور الحالية (`argon2.verify`) — فشل → `AUTH_VALIDATION_FAILED` (400).
2. سياسة كلمة المرور **القديمة حرفيًا** (`assertPasswordPolicy_` من `Validation.gs`): طول ≥ 10 خانات، تحوي حرفًا ورقمًا معًا، تختلف عن الحالية **وعن السابقة** (`previousSecretHash`).
3. في معاملة واحدة: تحديث `secretHash` (نقل الحالي إلى `previousSecretHash`)، `mustChangePassword=false`، **إبطال كل جلسات الحساب النشطة — بما فيها الجلسة الحالية نفسها** (يطابق أثر `revokeSessions_`/`actorEpoch_` القديم؛ العميل يُعاد توجيهه لتسجيل الدخول من جديد).
4. تدقيق `PASSWORD_CHANGED` (بلا أي سرّ في metadata).

---

## 8) إعادة تعيين كلمة المرور بالبريد

نموذج بيانات دائم جديد (`password_reset_tokens`) يستبدل اعتماد القديم
على `CacheService` (لا يصلح كأساس عبر أكثر من instance واحد في المنصة
الجديدة). **الثوابت من القديم حرفيًا**: TTL = 900 ثانية (15 دقيقة)،
حد أقصى 6 محاولات خاطئة (`PASSWORD_RESET_TTL_SECONDS`/
`PASSWORD_RESET_MAX_ATTEMPTS` من `Auth.gs`).

**تجزئة الرمز (NODE-1.1)**: `password_reset_tokens.token_hash =
HMAC-SHA256(normalized code, AUTH_RESET_TOKEN_HMAC_KEY)` — **ليس**
SHA-256 عادٍ كما كان في NODE-1. رمز الاستعادة (8 خانات فقط من أبجدية
33 رمزًا) أقل entropy بكثير من رمز جلسة عشوائي 32-بايت؛ SHA-256 عادٍ
بلا مفتاح سرّي كان يعني أن أي طرف يملك نسخة من قاعدة البيانات (تسريب/
نسخة احتياطية) يستطيع تجربة كل الاحتمالات المعقولة (brute-force
offline) لإيجاد الرمز الأصلي من الـhash المخزَّن مباشرة، بلا الحاجة
لاختراق الخادم أصلًا. HMAC بمفتاح سرّي مستقل (`AUTH_RESET_TOKEN_HMAC_KEY`
— لا يُعاد استخدام `AUTH_RATE_LIMIT_HMAC_KEY` أو
`AUTH_CREDENTIAL_LOOKUP_HMAC_KEY` له) يمنع هذا الهجوم: بلا معرفة
المفتاح، معرفة الـhash المخزَّن وحدها لا تكفي لاستنتاج الرمز أو
التحقق من تخمين. المقارنة عند التأكيد تبقى timing-safe
(`crypto.timingSafeEqual`) كما في NODE-1.

### `POST /auth/password-reset/request`
- استجابة **عامة موحَّدة دائمًا** بصرف النظر عن: بريد غير موجود، حساب
  موقوف، جمعية معطَّلة، دور غير مؤهَّل (لا يوجد مسار بريد للمناديب أصلًا
  — لا credential من نوع `EMAIL_PASSWORD` لهم) — **لا كشف لوجود
  الحساب من عدمه** (anti-enumeration)، يطابق الرسالة العامة القديمة.
- Rate limit: 5 محاولات/15 دقيقة لكل بريد (`password-reset-request`).
- عند الأهلية: إنشاء رمز `RST-XXXXXXXX`، إرسال عبر `EmailService`
  (انظر §10) داخل try/catch — فشل الإرسال يُعيد الرسالة العامة **بلا**
  تخزين الرمز (رمز لن يصل صاحبه بلا فائدة). عند النجاح: إبطال أي رمز
  سابق نشط لنفس الحساب ثم إنشاء الرمز الجديد داخل معاملة واحدة. تدقيق
  `PASSWORD_RESET_REQUESTED` (بلا الرمز/البريد الحسّاس في metadata).

### `POST /auth/password-reset/confirm`
- Rate limit: 10 محاولات/15 دقيقة لكل بريد (`password-reset-verify`) — يُستهلَك دائمًا، حتى قبل أي بحث عن الرمز.
- كل شيء داخل معاملة واحدة (قفل `SELECT ... FOR UPDATE` على الرمز النشط): فحص الوجود/الانتهاء/عدد المحاولات، مقارنة زمن ثابت (`timingSafeEqual`) للرمز، زيادة عداد المحاولات عند الخطأ (وإبطال الرمز فورًا عند بلوغ الحد الأقصى)، ثم عند التطابق: تطبيق نفس سياسة كلمة المرور، تحديث `secretHash`/`previousSecretHash`، `mustChangePassword=false`، **إبطال كل جلسات الحساب**، وضع `consumedAt` (استخدام واحد فقط).
- **رسالة الفشل موحَّدة تمامًا** بين: رمز خاطئ / منتهي / مُستخدَم / لا يوجد طلب / تجاوز عدد المحاولات — بلا أي تمييز.
- **ملاحظة تصحيح مهمة (اكتُشفت أثناء الاختبار، NODE-1)**: أي `throw` داخل `prisma.$transaction` يُلغي (rollback) كل الكتابة ضمن نفس المعاملة — بما فيها تحديث `attemptCount`/`consumedAt` الذي يجب أن يبقى حتى عند فشل تلك المحاولة تحديدًا. الحل المُطبَّق: المعاملة تُعيد نتيجة (`{ok:false}` أو `{ok:true, account}`) بدل رمي استثناء من الداخل، ويُرمى الخطأ **بعد** التزام (commit) المعاملة في الخارج.
- **حدّ معاملة التدقيق (NODE-1.1)**: تدقيق `PASSWORD_RESET_COMPLETED` **لا** يُسجَّل من داخل `$transaction` — يُسجَّل بعد التزامها فعليًا (`outcome.ok === true` بعد انتهاء `$transaction`)، فلا يمكن أبدًا أن يظهر `PASSWORD_RESET_COMPLETED` لمحاولة فاشلة أو لعملية لم تُطبَّق فعليًا، بصرف النظر عن ترتيب التنفيذ الداخلي.
- مناديب لا يملكون بريد+كلمة مرور فيُرفَضون دائمًا برسالة عامة (لا credential مطابق أصلًا).

---

## 9) `POST /auth/associations/:id/reset-password` — ADMIN فقط

يطابق `resetAssociationPassword` القديم (`DevicesAssociations.gs`) بعد
قراءته كاملًا: `ADMIN` فقط (غيره → `AUTH_FORBIDDEN`)، يولّد كلمة مرور
مؤقتة قوية (`generateStrongTempPassword`، ≥10 خانات + حرف ورقم)، ينقل
كلمة المرور الحالية إلى `previousSecretHash`، يضبط
`mustChangePassword=true`، **يُبطل جلسات حساب الجمعية فقط** (لا يمسّ
جلسات مناديبها — يطابق النطاق القديم). كلمة المرور المؤقتة تُعاد **مرة
واحدة فقط** في استجابة الـAPI مباشرة للـADMIN؛ لا تُخزَّن نصًا صريحًا
ولا تظهر في أي سجل تدقيق (`ASSOCIATION_PASSWORD_RESET`) أبدًا.

---

## 10) `EmailService` — تجريد بلا مزوّد إنتاجي بعد

واجهة (`EmailService`) بطريقتين: `sendPasswordResetCode`،
`sendSecurityAlert`. NODE-1 يوفّر تطبيقين فقط:
- `DevEmailService` — يسجّل فقط أن رسالة "كانت لتُرسَل"، **لا يطبع
  الرمز أبدًا** في أي بيئة (حتى Development).
- `FakeEmailService` — للاختبارات فقط، يلتقط آخر رسالة/رمز في الذاكرة
  (`app.get(EmailService)` بعد `overrideProvider` في اختبارات e2e).

**لا مزوّد بريد إنتاجي حقيقي متصل في NODE-1** — قرار مؤجَّل عمدًا (خارج
النطاق صراحة). عقد `Production adapter` مستقبلي يُضاف لاحقًا خلف نفس
الواجهة بلا تغيير في `AuthService`.

---

## 11) الحدّ من المعدَّل — DB-backed، لا Redis

جدول `auth_rate_limits` (id, scope, subject_hash, window_started_at,
attempt_count, expires_at, created_at, updated_at،
`UNIQUE(scope, subject_hash)`) — يعمل بشكل صحيح عبر أكثر من instance
واحد للـAPI (يستبدل `throttle_`/`CacheService` القديم غير الصالح لأكثر
من عملية Node واحدة). `subject_hash` = **HMAC-SHA256** للمعرِّف (بريد/
رمز/associationId) — **لا يُخزَّن أي معرِّف خام** في الجدول.

التحديث ذرّي عبر استعلام SQL خام واحد (`INSERT ... ON CONFLICT
(scope, subject_hash) DO UPDATE ...  RETURNING attempt_count`) لضمان
السلامة تحت التزامن.

| Scope | الحد | النافذة |
|---|---|---|
| `login:user` | 8 | 15 دقيقة |
| `login:delegate` | 8 | 15 دقيقة |
| `password-reset-request` | 5 | 15 دقيقة |
| `password-reset-verify` | 10 | 15 دقيقة |
| `association-password-reset` (مُعرَّف، غير مُستهلَك بعد في NODE-1) | 5 | 15 دقيقة |

**استراتيجية التنظيف** (موثَّقة، غير منفَّذة كـcron في NODE-1): صفوف
`auth_rate_limits` حيث `expires_at < now() - interval '1 day'` قابلة
للحذف الآمن دوريًا (job مستقبلي أو `DELETE` مجدول) — لا حاجة تشغيلية
فورية لأن الجدول صغير جدًا (صف واحد لكل `scope+subject` النشط فقط) ولا
يُقرَأ إلا بمفتاحه الفريد.

---

## 12) الأدوار وسياق المستأجر (Tenant Context)

`@Roles(...)` + فحص موحَّد داخل `SessionAuthGuard` العالمي (`APP_GUARD`)
— لا تكرار للتحقق داخل أي Controller فردي. `AuthContext` (`accountId`,
`role`, `associationId`, `sessionId`) يُرفَق بكل طلب من الجلسة/الحساب
**حصرًا** — **لا يُقرَأ `associationId` من جسم الطلب أو الاستعلام
لحسابات ASSOCIATION/DELEGATE إطلاقًا**؛ فقط ADMIN قد يُحدِّد جمعية
مستهدفة صراحة حيث يسمح endpoint بذلك (مثل `reset-password/:id`).
مُختبَر صراحةً أن تمرير `associationId` مزيَّف في query/body لا يغيّر
شيئًا في السياق الفعلي (راجع `test/auth-session.e2e-spec.ts`).

---

## 13) أكواد الخطأ الموحَّدة

```
AUTH_INVALID_CREDENTIALS       401  بيانات دخول خاطئة (بريد/كلمة مرور/رمز مندوب)
AUTH_ACCOUNT_DISABLED          403  حساب مُوقَف (جلسة قائمة أصلًا تكتشف لاحقًا)
AUTH_ASSOCIATION_DISABLED      403  جمعية معطَّلة (عند الدخول أو أثناء جلسة قائمة)
AUTH_SESSION_EXPIRED           401  لا جلسة/جلسة منتهية/مُبطَلة
AUTH_FORBIDDEN                 403  دور غير مصرَّح له بهذا الـendpoint
AUTH_PASSWORD_CHANGE_REQUIRED  403  mustChangePassword=true يمنع endpoint غير معفى
AUTH_RATE_LIMITED              429  تجاوز حد المحاولات
AUTH_VALIDATION_FAILED         400  فشل تحقق عام (سياسة كلمة مرور، رمز استعادة، ValidationPipe)
```

كل استجابة خطأ API: `{ ok: false, error: { code, message, correlationId } }`
— لا stack trace أو تفاصيل SQL/Prisma خامة تصل للعميل أبدًا
(`HttpExceptionFilter`).

---

## 14) الفرونت-إند (نطاق NODE-1 فقط)

`apps/web/app/login` (تبويبا إدارة/جمعية ومندوب)، `login/forgot-password`
(طلب + تأكيد)، `change-password` (شاشة إلزامية)، `dashboard` (غلاف
موثَّق أدنى + زر خروج)، `dev/session` (فحص تطوير اختياري). كل الطلبات
عبر `fetch(..., { credentials: 'include' })` — الكوكي هو الحامل
الوحيد؛ لا قراءة/تخزين للرمز في JS إطلاقًا. لا إعادة تصميم لبقية
الواجهة ولا شاشات Dashboard/أعمال حقيقية في هذه المرحلة.
