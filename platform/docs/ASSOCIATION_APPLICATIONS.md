# طلبات انضمام الجمعيات (NODE-2)

المرجع الوحيد للسلوك المعتمد هو `Applications.gs` في الفرع القديم
(`submitAssociationApplication_`, `getApplicationStatus`,
`getApplicationLicenseFile`, `reviewAssociationApplication_`,
`listApplications_`) مع `Validation.gs` و`Normalize.gs`. كل انحراف عن
القديم في هذا المستند **مُعلَّم صراحة** بوسم «انحراف متعمَّد».

**نطاق الحالات**: `UNDER_REVIEW` / `ACCEPTED` / `REJECTED` فقط (قيد
المراجعة / مقبول / مرفوض). لا توجد ولن تُضاف في NODE-2 أي حالة أخرى
(DRAFT / SUBMITTED / ELIGIBLE / SCORED / MAIN_LIST / …) ولا أي محرّك
تقييم أو بوابة أهلية — لأنها ببساطة غير موجودة في النظام القديم.

---

## 1) مسار التقديم (`POST /association-applications`)

عام تمامًا (بلا جلسة)، `multipart/form-data`، حقل الملف `licenseFile`.
الترتيب أدناه **مطابق حرفيًا** لترتيب `submitAssociationApplication_`،
وهذا الترتيب جزء من العقد لا تفصيل تنفيذ (يحدد أي خطأ يُرى أولًا،
ومتى يُستهلك حدّ المعدَّل، ومتى يُرفع الملف):

1. **فخ العناكب (honeypot)** — إن كان الحقل `website` غير فارغ: يُعاد
   `{ok:true, id:'', message:…}` فورًا **بلا أي قراءة أو كتابة أو رفع
   أو استهلاك حدّ معدَّل أو سجل تدقيق**. الهدف ألّا يميّز البرنامج
   الآلي طلبه المرفوض عن طلب حقيقي.
2. **`clientRequestId`** — يجب أن يطابق `/^[A-Za-z0-9_-]{8,64}$/`
   (`applicationConfig.clientRequestIdPattern`)، وإلا
   `APPLICATION_INVALID_CLIENT_REQUEST_ID` (400).
3. **تحقق رخيص بلا I/O باهظ** — بنفس ترتيب القديم: بريد (تطبيع:
   trim + lowercase، طول ≤ 180)، جوال (`normalizeSaudiPhone`)، منطقة/مدينة،
   تصنيف، مجال عمل، اسم، اسم المسؤول، ملاحظات، رقم ترخيص، تاريخ انتهاء
   الترخيص، الإجابات الثماني.
4. **تناقض سريان الترخيص** — «الترخيص ساري = نعم» مع تاريخ انتهاء في
   الماضي (بتوقيت `Asia/Riyadh`) →
   `APPLICATION_LICENSE_EXPIRY_CONTRADICTION` (400).
5. **الإقرار** — `pledgeAccepted` يجب أن يساوي `'true'` نصًا، وإلا
   `APPLICATION_PLEDGE_REQUIRED` (400).
6. **قراءات التكرار المسبقة** (best-effort — الدفاع الحقيقي هو قيود DB):
   - نفس `clientRequestId` موجود → **رد idempotent ناجح** بنفس رقم
     الطلب (`duplicate:true`)، وليس خطأ.
   - البريد مرتبط بحساب دخول قائم → `ASSOCIATION_EMAIL_IN_USE` (409).
   - يوجد طلب `UNDER_REVIEW` بنفس البريد أو الجوال أو رقم الترخيص →
     `APPLICATION_DUPLICATE_PENDING` (409).
7. **حدّ المعدَّل** — `5` محاولات/ساعة لكل بريد مطبَّع، نطاق
   `association-application-submit`. موضعه بعد كل التحقق الرخيص
   وقبل رفع الملف — مطابق للقديم (`throttle_('apply:'+hash(email),5,3600)`)،
   حتى لا يُستهلك على أخطاء إدخال بسيطة ولا يُنفَق على رفع مكلف.
8. **تحقق الملف ثم رفعه** — قبل فتح أي معاملة (راجع §4).
9. **معاملة واحدة** — `files` → `public_code_counters` (رمز `APP-`) →
   `association_applications` → `application_answers` (الثمانية دفعة واحدة).
10. **حذف تعويضي** — أي فشل بعد رفع ناجح يحذف الكائن (راجع §4).

### قواعد التحقق بالتفصيل

| الحقل | القاعدة | عند الخطأ |
|---|---|---|
| `name` | نص مطلوب، ≤ 150 حرفًا، تُزال أحرف التحكم | 400 |
| `category` | **اختياري**؛ إن أُرسل يجب أن يكون قيمة نشطة في `ASSOCIATION_CATEGORY` بعد تطبيق مرادفات Legacy (`بر` → `جمعية بر`) | `APPLICATION_INVALID_REFERENCE` |
| `sector` | **إلزامي**، قيمة نشطة في `ASSOCIATION_SECTOR` | `APPLICATION_INVALID_REFERENCE` |
| `region` / `city` | كلاهما نشط، والمدينة **ابن فعلي** للمنطقة في `reference_values` (لا grandfathering لطلب جديد — القديم لا يمرّر `previous` هنا أبدًا) | `APPLICATION_INVALID_REFERENCE` |
| `phone` | `05XXXXXXXX` / `5XXXXXXXX` / `9665XXXXXXXX` / `+9665XXXXXXXX` → يُخزَّن دائمًا `05XXXXXXXX` | 400 |
| `email` | صيغة بريد، ≤ 180، يُخزَّن `trim().toLowerCase()` | 400 |
| `contactName` | مطلوب، ≤ 100 | 400 |
| `notes` | اختياري، ≤ 500 | — |
| `licenseNumber` | مطلوب، ≤ 60 | 400 |
| `licenseExpiryDate` | `YYYY-MM-DD` حصرًا، وتاريخ تقويمي **موجود فعلًا** (لا تدحرج) — راجع §التاريخ الصارم أدناه | `APPLICATION_VALIDATION_FAILED` |
| `answers` | JSON بالمفاتيح الثمانية من `LEGACY_APPLICATION_QUESTIONS`، كل قيمة boolean صريحة | `APPLICATION_ANSWER_REQUIRED` |
| `licenseFile` | JPEG/PNG/WEBP بـmagic bytes فعلية، ≤ 8 MiB | `APPLICATION_LICENSE_INVALID` / `APPLICATION_LICENSE_TOO_LARGE` |

> **`scoreLabel` («7/8») مؤشّر عرض فقط.** يُحسب من عدد إجابات «نعم» ولا
> يدخل في أي قرار قبول/رفض ولا يُخزَّن كحقل مشتق. القرار يدوي بالكامل،
> كما في القديم تمامًا.

---

### التاريخ الصارم لانتهاء الترخيص (NODE-2.1)

`new Date('2026-02-31T00:00:00.000Z')` **لا يرمي** في JavaScript، بل
يتدحرج بصمت إلى `2026-03-03`، و`2026-13-01` تصبح `2027-01-01`. فكان
تاريخ مستحيل يُقبَل ويُخزَّن كتاريخ مختلف تمامًا عمّا كتبه المتقدِّم، ثم
تُقارَن به قاعدة التناقض أدناه.

التصحيح: تُضبط الصيغة بـ`^\d{4}-\d{2}-\d{2}$`، ثم تُستخرج الأجزاء
الثلاثة كأعداد صحيحة ويُعاد بناء التاريخ بـ`Date.UTC`، ثم يُقارَن ما
استقر عليه فعلًا (`getUTCFullYear`/`getUTCMonth()+1`/`getUTCDate`) بما
طُلب — أي انزياح يعني تدحرجًا فيُرفَض بـ`APPLICATION_VALIDATION_FAILED`.
أمثلة مرفوضة: `2026-02-31`، `2026-04-31`، `2026-13-01`، `2026-02-29`
(سنة غير كبيسة)، `2026-05-00`. الصيغ غير `YYYY-MM-DD` (`2030/12/31`،
`31-12-2030`، طابع زمني كامل) مرفوضة كذلك.

قاعدة «الترخيص ساري = نعم مع تاريخ في الماضي» بتوقيت `Asia/Riyadh`
(`todayInRiyadh()` → `APPLICATION_LICENSE_EXPIRY_CONTRADICTION`) لم تتغيّر
إطلاقًا؛ هذا البند يشدّ فحص الصيغة السابق لها فقط.

---

## 2) الـIdempotency: `clientRequestId` مقابل `opId`

مفتاحان مختلفان لغرضين مختلفين تمامًا:

| | `clientRequestId` | `opId` |
|---|---|---|
| مَن يولّده | متصفّح مقدّم الطلب (`crypto.randomUUID()` مرة واحدة عند تحميل النموذج، محفوظ في `sessionStorage`) | متصفّح الـADMIN، لكل محاولة مراجعة |
| النطاق | عام، بلا حساب | مربوط بـ`account_id` + `scope` |
| التخزين | عمود `association_applications.client_request_id` (UNIQUE) | جدول `idempotency_keys` (UNIQUE على `account_id, scope, key`) |
| عند التكرار | رد ناجح بنفس الطلب (`duplicate:true`) | رد النتيجة المخزَّنة (`alreadyProcessed:true`) |
| عند حمولة مختلفة لنفس المفتاح | لا ينطبق | `APPLICATION_IDEMPOTENCY_CONFLICT` (409) |

`IdempotencyService.claim` يستخدم
`INSERT … ON CONFLICT (account_id, scope, key) DO NOTHING RETURNING id`
داخل نفس المعاملة التي تقفل السجل المستهدف — فطلبان متزامنان بنفس
`opId` يتسلسلان تلقائيًا عبر قفل الصف على `idempotency_keys` نفسه، بلا
أي polling. النتيجة تُخزَّن في `response_json` **بعد** نجاح كل شيء عبر
`complete`، ولا تُعاد أبدًا نتيجة `IN_PROGRESS` جزئية.

---

## 3) سياسة التكرار (قيد المراجعة فقط)

القديم كان يعتمد على `LockService` + إعادة فحص داخل القفل. المنصة
الجديدة قد تعمل على أكثر من instance، فالدفاع الحقيقي هو **فهارس فريدة
جزئية** في PostgreSQL:

```sql
CREATE UNIQUE INDEX ux_pending_application_email
  ON association_applications (email)
  WHERE status = 'UNDER_REVIEW' AND email IS NOT NULL;
CREATE UNIQUE INDEX ux_pending_application_phone
  ON association_applications (phone)  WHERE status = 'UNDER_REVIEW';
CREATE UNIQUE INDEX ux_pending_application_license
  ON association_applications (license_number)
  WHERE status = 'UNDER_REVIEW' AND license_number IS NOT NULL;
```

`WHERE status = 'UNDER_REVIEW'` جوهري: السجلات التاريخية المبتوتة
(`ACCEPTED`/`REJECTED`) **لا** تمنع طلبًا جديدًا مشروعًا بنفس البريد أو
الجوال أو رقم الترخيص — وهو نفس سلوك القديم (`row['الحالة'] === 'قيد المراجعة'`).

بجانبها فحص منفصل تمامًا: **بريد مرتبط بحساب دخول قائم**
(`auth_credentials.identifier`) يُرفض دائمًا بـ`ASSOCIATION_EMAIL_IN_USE`
بصرف النظر عن حالة أي طلب — يطابق `findUserByEmail_` القديمة. لذلك
جمعية سبق قبولها لا يمكنها التقدّم مجددًا بنفس البريد، لكن يمكن ذلك
بنفس الجوال/الترخيص وبريد آخر.

### ملاحظة تنفيذية مهمة (خطأ أُصلح أثناء اختبار NODE-2)

`Prisma` لا يضمن صيغة `meta.target` في خطأ `P2002`: لقيد فرادة معرَّف في
`schema.prisma` يُعيد **أسماء الأعمدة** (`client_request_id`)، ولفهرس
أُنشئ في raw SQL خارج المخطط (`ux_pending_*`) يُعيد **اسم الفهرس**.
الاعتماد على اسم القيد وحده جعل مسار التعويض (الرد الـidempotent عند
سباق `clientRequestId` حقيقي) لا يُفعَّل أبدًا، فكان السباق الطبيعي يعود
بـ500 بدل رد ناجح. `isUniqueConstraintError` الآن يطابق الاثنين معًا،
واختبار تزامن حقيقي (`Promise.all` بطلبين متطابقين) يحرس هذا السلوك.

---

## 4) دورة حياة ملف الترخيص

- **خاص دائمًا**: لا bucket عام، ولا رابط دائم، ولا `getUrl()` كما في
  القديم. الوصول الوحيد هو **signed URL عمره 300 ثانية**
  (`storageConfig.licenseSignedUrlSeconds`) عبر endpoint محمي بـADMIN.
- **اسم عشوائي بالكامل**: `association-licenses/<uuid>.<ext>` — لا يحمل
  أي بيان مستخدم. اسم الملف الأصلي القادم من العميل **لا يُخزَّن** عمدًا
  (`original_name = 'license'`) لأنه قد يحمل PII بلا ضرورة.
- **النوع من المحتوى لا من الادّعاء**: `detectImageMimeFromBytes` يفحص
  البايتات فعليًا (JPEG `FF D8 FF`، توقيع PNG الثماني، `RIFF`…`WEBP`).
  MIME مُعلَن يخالف المكتشَف = تزوير = رفض.
- **الرفع قبل المعاملة**: تخزين الكائنات ليس جزءًا من معاملة قاعدة
  البيانات ولا يمكن التراجع عنه معها. لذلك يُرفع الملف أولًا، ثم تُفتح
  المعاملة.
- **حذف تعويضي (compensating delete)**: أي فشل بعد رفع ناجح — فشل قيد،
  سباق تكرار خسر، أو أي استثناء — يستدعي `deleteObjectBestEffort`
  الذي **لا يرمي أبدًا** حتى لا يُخفي خطأ التنظيف الخطأ الأصلي. النتيجة
  المضمونة: لا كائن يتيم بلا سجل يشير إليه. (مطابق لـ
  `DriveApp.getFileById(...).setTrashed(true)` في القديم.)

الاختبارات تتحقق من هذا مقابل **خادم S3 حقيقي** (s3rver محليًا، MinIO في
CI) لا mock: تُجبَر المعاملة على الفشل بعد الرفع، ثم يُتحقَّق أن الـbucket
خالٍ فعلًا.

---

## 5) آلة حالة المراجعة

```
UNDER_REVIEW ──accept──▶ ACCEPTED   (نهائي)
     │
     └────────reject──▶ REJECTED   (نهائي)
```

لا يوجد أي انتقال آخر: لا ACCEPTED→REJECTED، ولا REJECTED→ACCEPTED، ولا
عودة إلى UNDER_REVIEW. أي محاولة مراجعة ثانية على طلب مبتوت →
`APPLICATION_ALREADY_REVIEWED` (409).

**التحكم في التزامن**: كل مسار مراجعة يبدأ بقفل صف صريح داخل المعاملة:

```sql
SELECT id, status, email, name FROM association_applications
 WHERE id = $1 FOR UPDATE
```

فطلبان متزامنان (قبولان بمعرّفَي عملية مختلفين، أو قبول ورفض معًا)
يتسلسلان حتمًا: الأول يلتزم، والثاني يقرأ الحالة الجديدة بعد الالتزام
فيرفض بـ`APPLICATION_ALREADY_REVIEWED`. لا يمكن بأي ترتيب أن تُنشأ
جمعيتان لطلب واحد — ويحرس ذلك اختبار تزامن حقيقي.

### تسلسل القبول (`acceptApplication`) — داخل معاملة واحدة

1. `IdempotencyService.claim(tx, accountId, 'application-accept', opId, {id})` —
   إن لم يُدَّعَ (مكرَّر) يُعاد الرد المخزَّن فورًا (راجع §6).
2. `SELECT … FOR UPDATE` على صف الطلب.
3. الطلب غير موجود → `APPLICATION_NOT_FOUND` (404).
4. الحالة ليست `UNDER_REVIEW` → `APPLICATION_ALREADY_REVIEWED` (409).
5. البريد صار مرتبطًا بحساب آخر بين التقديم والمراجعة →
   `ASSOCIATION_EMAIL_IN_USE` (409).
6. قراءة الطلب كاملًا.
7. `nextPublicCode(tx,'ASC')` — عدّاد ذرّي (راجع §8).
8. إنشاء `associations` (الاسم/التصنيف/المنطقة/المدينة/الجوال/البريد من الطلب، الحالة `ACTIVE`).
9. `nextPublicCode(tx,'USR')`.
10. إنشاء `accounts` (دور `ASSOCIATION`، حالة `ACTIVE`، `must_change_password = true`).
11. توليد كلمة مرور مؤقتة قوية + `Argon2id` + إنشاء `auth_credentials`
    (`type=EMAIL_PASSWORD`، `identifier` = بريد الطلب).
12. تحديث الطلب: `status=ACCEPTED`، `resulting_association_id`،
    `reviewed_at`، `reviewed_by_id`.
13. `IdempotencyService.complete(...)` بالرد المخزَّن — **بلا كلمة المرور**.

بعد **نجاح الالتزام فقط** يُكتب سجل التدقيق `APPLICATION_ACCEPTED`
(خارج المعاملة عمدًا: محاولة فاشلة يجب ألّا تترك أثر تدقيق كاذبًا).

### تسلسل الرفض

`reason` مطلوب فعليًا (≤ 300 حرفًا، يُقصّ عند التجاوز، والفارغ/المسافات
يُرفض)، ثم نفس نمط claim → `FOR UPDATE` → تحقق الحالة → تحديث إلى
`REJECTED` → `complete`، وسجل `APPLICATION_REJECTED` بعد الالتزام.
الرفض **لا ينشئ** أي جمعية أو حساب أو بيانات دخول.

---

## 6) دلالات كلمة المرور المؤقتة (انحراف متعمَّد عن Legacy)

القديم كان يخزّن نتيجة العملية في `CacheService` ويعيدها كما هي عند
التكرار — أي أن **كلمة المرور الصريحة كانت قابلة للاسترجاع من الكاش**.
NODE-2 لا يفعل ذلك إطلاقًا:

- كلمة المرور المؤقتة تُولَّد، تُهَش بـArgon2id، وتُعاد في **رد الاستدعاء
  الناجح الأول فقط**.
- لا تُكتب في `idempotency_keys.response_json`، ولا في `audit_logs`، ولا
  في أي عمود أو سجل آخر. الرد المخزَّن يحمل فقط
  `{associationId, associationPublicCode, accountId, temporaryPasswordPreviouslyIssued:true}`.
- عند إعادة التنفيذ بنفس `opId`:
  `{ok:true, alreadyProcessed:true, associationId, associationPublicCode, temporaryPassword:null, temporaryPasswordPreviouslyIssued:true}`.
- كلمة مرور ضائعة تُستعاد **حصرًا** عبر
  `POST /auth/associations/:id/reset-password` (موجود من NODE-1) — لا
  عبر إعادة تشغيل عملية القبول.

الواجهة تعكس ذلك: عند القبول الأول تُعرض كلمة المرور مرة واحدة مع تحذير
صريح وزر نسخ؛ وعند رد `alreadyProcessed` تُعرض رسالة توجّه المشرف إلى
إعادة التعيين بدل حقل فارغ أو معطوب. راجع SECURITY_MODEL.md.

---

## 7) عقد خصوصية متابعة الحالة

`GET /association-applications/status/:clientRequestId` عام بلا جلسة —
تمامًا كالقديم. لأن معرّف الطلب وحده ليس إثبات هوية، فالرد **لا يحمل أي
PII إطلاقًا**:

```json
{ "ok": true, "found": true, "id": "APP-000123",
  "status": "UNDER_REVIEW", "submittedAt": "…", "rejectionReason": "" }
```

- لا اسم، ولا بريد، ولا جوال، ولا اسم مسؤول، ولا رقم ترخيص، ولا إجابات،
  ولا أي إشارة لملف الترخيص.
- `rejectionReason` غير فارغ **فقط** عندما تكون الحالة `REJECTED`.
- طلب غير موجود → `{ok:true, found:false}` بلا أي تفصيل إضافي.

---

## 8) الرموز العامة (`APP-`) والعدّاد الذرّي

`PublicCodeService.nextPublicCode(tx, 'APP')` ينفّذ upsert-and-increment
ذرّيًا واحدًا:

```sql
INSERT INTO public_code_counters (prefix, next_value, updated_at)
VALUES ($1, 1, now())
ON CONFLICT (prefix) DO UPDATE
  SET next_value = public_code_counters.next_value + 1, updated_at = now()
RETURNING next_value
```

يُستدعى دائمًا داخل نفس معاملة السجل المُرقَّم، فإن تراجعت المعاملة تراجع
الرقم معها. هذا يستبدل `nextId_` القديمة (`MAX(...)+1`) التي كانت آمنة
فقط لأن كل كتابة كانت مسلسَلة عبر `LockService`. راجع
LEGACY_DATA_MIGRATION.md لخطة مصالحة العدّاد عند استيراد أرقام Legacy.

---

## 9) حدود المعدَّل

| النطاق | المفتاح | الحد | مطابق لِـ |
|---|---|---|---|
| `association-application-submit` | البريد المطبَّع | 5 / ساعة | `throttle_('apply:'+hash(email), 5, 3600)` |
| `association-application-status` | `clientRequestId` | 20 / ساعة | `throttle_('appstatus:'+hash(clientRequestId), 20, 3600)` |

كلاهما مخزَّن في `auth_rate_limits` (DB-backed) بدل `CacheService` —
انحراف متعمَّد لأن الكاش لا يصلح عبر أكثر من instance. النافذة تُجدَّد عند
كل محاولة (نفس دلالة `throttle_`)، والمفتاح مخزَّن كـHMAC لا كنص صريح.

**ملاحظة على قابلية بلوغ حدّ التقديم**: بما أن فحص «طلب واحد قيد
المراجعة» يسبق حدّ المعدَّل، فإن الحدّ لا يُبلَغ بإرسال ناجح متكرر (الثاني
يُرفض قبله)، بل بمحاولات تتجاوز التحقق الرخيص ثم تفشل لاحقًا (ملف غير
صالح مثلًا). هذا سلوك القديم نفسه حرفيًا، وهو مقصود: الحدّ يحمي من
الإغراق بالمحاولات المكلفة لا من إعادة الإرسال المشروعة.

---

## 10) أكواد الأخطاء

| الكود | HTTP | متى |
|---|---|---|
| `APPLICATION_INVALID_CLIENT_REQUEST_ID` | 400 | معرّف الطلب لا يطابق النمط |
| `APPLICATION_ANSWER_REQUIRED` | 400 | إجابة سؤال قبول ناقصة أو غير boolean |
| `APPLICATION_PLEDGE_REQUIRED` | 400 | بلا موافقة على الإقرار |
| `APPLICATION_INVALID_REFERENCE` | 400 | تصنيف/مجال/منطقة/مدينة غير معروف أو غير متوافق |
| `APPLICATION_LICENSE_EXPIRY_CONTRADICTION` | 400 | «ساري» مع تاريخ منتهٍ |
| `APPLICATION_LICENSE_INVALID` | 400/404 | ليس JPEG/PNG/WEBP فعليًا، أو MIME مزوَّر، أو لا ملف مرتبط بالطلب |
| `APPLICATION_LICENSE_TOO_LARGE` | 400 | > 8 MiB |
| `APPLICATION_VALIDATION_FAILED` | 400 | تاريخ غير صالح |
| `APPLICATION_DUPLICATE_PENDING` | 409 | طلب `UNDER_REVIEW` بنفس البريد/الجوال/الترخيص |
| `ASSOCIATION_EMAIL_IN_USE` | 409 | البريد مرتبط بحساب دخول قائم |
| `APPLICATION_ALREADY_REVIEWED` | 409 | مراجعة طلب مبتوت |
| `APPLICATION_IDEMPOTENCY_CONFLICT` | 409 | نفس `opId` بحمولة مختلفة |
| `APPLICATION_NOT_FOUND` | 404 | طلب غير موجود |
| `AUTH_RATE_LIMITED` | 429 | تجاوز حدّ المعدَّل |
| `AUTH_FORBIDDEN` | 403 | دور غير ADMIN على مسار مراجعة |

---

## 11) الـEndpoints

| Method | Path | الوصول | ملاحظات |
|---|---|---|---|
| POST | `/api/v1/association-applications` | عام | multipart، حقل الملف `licenseFile` |
| GET | `/api/v1/association-applications/status/:clientRequestId` | عام | بلا PII |
| GET | `/api/v1/association-applications` | ADMIN | ترقيم/بحث/تصفية بالحالة — `page`/`pageSize`/`status` بتحقق زمن تشغيل (400 لا 500) — `page` محصور `[1, MAX_PAGE=100000]` و`pageSize` `[1,100]`؛ سقف `page` (NODE-2.2) حاجز ضد `skip` غير محدود لا ادّعاء عمق ترقيم، راجع ASSOCIATIONS.md، **بلا `sortBy`/`sortDir`** (راجع §13) |
| GET | `/api/v1/association-applications/:id` | ADMIN | التفاصيل + الإجابات الثماني — `:id` عبر `ParseUUIDPipe` (400 على معرّف مشوَّه) |
| GET | `/api/v1/association-applications/:id/license-file` | ADMIN | `{url}` signed 300s + سجل تدقيق — `:id` عبر `ParseUUIDPipe` (400 على معرّف مشوَّه) |
| POST | `/api/v1/association-applications/:id/review` | ADMIN | `{decision, reason?, opId}` — `:id` عبر `ParseUUIDPipe` (400 على معرّف مشوَّه) |

## 12) الشاشات

- `/apply` — النموذج العام (RTL، هوية الزاد، تحقق مسبق للملف، حقل فخ
  مخفي، `clientRequestId` يُولَّد مرة واحدة ويُعاد استخدامه عند إعادة المحاولة).
- `/apply/status` — متابعة الحالة بلا PII.
- `/admin/applications` — قائمة + تفاصيل + معاينة الترخيص عبر الرابط
  الموقَّع + قبول/رفض (الرفض يشترط سببًا؛ القبول يعرض كلمة المرور مرة واحدة).

---

## 13) الترتيب في قائمة الطلبات — لا ميزة ترتيب في القديم (NODE-2.1)

فُحص المصدر القديم مباشرةً، والنتيجة أن **`sortBy`/`sortDir` ليست ميزة
قائمة لطلبات الانضمام**، فلم تُخترع هنا:

- `Applications.gs::listApplications_` يقتصر على
  `applySearch_` + فلترة الحالة + `paginate_`، و**لا يستدعي `applySort_`
  إطلاقًا** — بخلاف `DevicesAssociations.gs::listAssociations_` و
  `listDevices_` اللذين يستدعيانه فعلًا (فرق مقصود في المصدر لا سهو).
- `Index.html::renderApplications` يستدعي
  `toolbar({placeholder, filters, count})` **بلا `sortFields`**، و
  `sortSelect` يُعيد نصًا فارغًا عند غياب `sortFields` — فلا يُرسم أي عنصر
  ترتيب في صفحة «طلبات الانضمام» أصلًا (بينما `renderAssociations` يمرّر
  `sortFields` فعلًا).
- الترتيب ثابت دائمًا في `getAssociationApplications_`:
  `.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1))` — أي
  `submittedAt` تنازليًا.

لذلك يبقى `GET /association-applications` على ترتيب ثابت
`submittedAt DESC`، ويُرفض أي `sortBy`/`sortDir` بـ400 (حقل غير معرَّف في
الـDTO تحت `forbidNonWhitelisted`). ترتيب قائمة **الجمعيات** ميزة حقيقية
وقد نُفِّذت — راجع ASSOCIATIONS.md §الترتيب.
