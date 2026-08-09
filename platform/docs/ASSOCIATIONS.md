# إدارة الجمعيات (NODE-2)

مرجع السلوك: `DevicesAssociations.gs` في الفرع القديم
(`listAssociations_`, `saveAssociation_`, `updateAssociationSettings_`,
`revokeAssociationSessions_`) مع `Validation.gs` و`Pagination.gs`.
الجمعيات تُنشأ بمسارين فقط: **قبول طلب انضمام** (راجع
ASSOCIATION_APPLICATIONS.md §5) أو **إنشاء ADMIN مباشر** (§2 أدناه).

---

## 1) القائمة (`GET /associations` — ADMIN)

ترقيم (`page`, `pageSize` محصور [1,100]، افتراضي 25)، بحث نصّي غير حسّاس
لحالة الأحرف على الاسم/الرمز العام/البريد/المنطقة/المدينة، **وبحث برقم
الجوال** (NODE-2.1)، وتصفية `status=ACTIVE|INACTIVE`.

### البحث برقم الجوال (NODE-2.1)

القديم يبحث في `phone` ضمن
`applySearch_(items, search, ['name','id','email','phone','region','city'])`.
هنا `associations.phones` عمود `text[]`، وفلاتر Prisma للمصفوفات لا توفّر
مطابقة جزئية (`has`/`hasSome`/`hasEvery` فقط، لا `contains`). لذلك يُطبَّع
مُدخَل البحث أولًا بنفس `normalizeSaudiPhone` المستخدَم عند التخزين، فيُطابَق
الرقم الكامل بأي صيغة مقبولة (`05XXXXXXXX` / `5XXXXXXXX` / `966…` / `+966…`)
مطابقةً دقيقة. مُدخَل رقمي **جزئي** (أثناء الكتابة) لا يُطبَّع فلا يضيف شرط
جوال ولا يُفشل البحث — بقية الحقول تعمل كما هي. هذا تضييق مقصود وموثَّق
مقابل البحث الجزئي في القديم، مقابل بقاء الاستعلام كله في Prisma بلا SQL
خام وبلا كسر الترقيم الخادمي.

### التحقق من معاملات الاستعلام (NODE-2.1)

`page`/`pageSize`/`status`/`sortBy`/`sortDir` تمرّ عبر
`ListAssociationsQueryDto` مع `ValidationPipe` العامة — تحقق **زمن تشغيل**
حقيقي لا مجرد نوع TypeScript. كان `Number(page)` السابق يُنتج `NaN` بصمت
لمُدخَل غير رقمي فينتهي إلى `skip: NaN` وخطأ Prisma خام بصيغة 500، وكان
`status` يمرّ كنصّ عشوائي مباشرةً إلى `where.status`. الآن كلاهما **400
نظيف**، ولا قيمة افتراضية صامتة تُخفي مُدخَلًا مرفوضًا عن المستدعي.

**NODE-2.2 — سقف `page`:** `page` محصور الآن `[1, MAX_PAGE=100000]`
(`common/pagination.util.ts`). السقف ليس ادّعاءً بأن عمق الترقيم قد يبلغ
100,000 صفحة، بل حاجز ضد `skip = (page - 1) * pageSize` غير المحدود: بدونه
كان `page=1e308` أو `page=9007199254740991` يجتاز `@IsInt`/`@Min(1)` ثم
يصل بـ`skip` لانهائي/غير آمن خامًا إلى Prisma فيظهر 500 مع احتمال تسريب
تفاصيل Prisma/Postgres. إضافةً إلى ذلك تتحقق `normalizePagination` نفسها
من الحدود (دفاع متعدد الطبقات لأي استدعاء داخلي لا يمرّ بالـDTO) وترمي
خطأً صريحًا بدل القصّ الصامت. `pageSize` يبقى `[1,100]` كما هو.

### الترتيب (`sortBy`/`sortDir`) — NODE-2.1

ميزة خادمية حقيقية في القديم لا زخرفة واجهة، وقد تُحقِّق ذلك من المصدر:
`DevicesAssociations.gs::listAssociations_` يستدعي فعلًا
`applySort_(items, options.sortBy, options.sortDir)`، و
`Index.html::renderAssociations` يمرّر
`sortFields: [['name','الاسم'], ['city','المدينة'], ['progress','نسبة الإنجاز']]`
إلى `toolbar` → `sortSelect` فيُرسم `<select data-act="set-sort">` حقيقي،
و`lazyFetchOptions` يمرّر `sortBy`/`sortDir` إلى الخادم.

القائمة البيضاء المُنفَّذة: `name`، `city` — تُترجَم إلى `orderBy` حقيقي في
Prisma. أي قيمة أخرى تُرفض بـ400 من `@IsIn` قبل أي استعلام، فلا يُبنى مرجع
عمود من نص العميل إطلاقًا. `sortDir` محصور بـ`asc`/`desc`. الافتراضي عند
غياب `sortBy` يبقى `name` تصاعديًا.

`progress` (نسبة الأجهزة المسلَّمة) **مؤجَّل عمدًا**: يُحتسب في القديم من
جدول الأجهزة، وهو نطاق لم يُهاجَر بعد (عدّادات الأجهزة كلها أصفار اليوم)،
فترتيب بحقل صفري دائمًا سيكون ميزة وهمية.

كل صف يحمل عدّادات تشغيلية: `beneficiariesCount`, `devicesCount`,
`delegatesCount`. تُحسب بثلاثة استعلامات `groupBy` مجمَّعة على معرّفات
الصفحة الحالية دفعةً واحدة — **لا N+1** بحال (كان القديم يقرأ الأوراق
كاملةً ويجمّع في الذاكرة).

`GET /associations/:id` يضيف كتلة `account` لحساب الدخول التشغيلي
(`id, publicCode, email, status, mustChangePassword, lastLoginAt`) —
ولا شيء غيرها: لا `secret_hash`، ولا `previous_secret_hash`، ولا أي رمز
جلسة. يحرس ذلك اختبار يمسح أجسام الردود كلها بحثًا عن هذه الأنماط.

**حساب تشغيلي واحد لكل جمعية** مضمون على مستوى قاعدة البيانات:

```sql
CREATE UNIQUE INDEX ux_accounts_one_association_role
  ON accounts (association_id)
  WHERE role = 'ASSOCIATION' AND archived_at IS NULL;
```

هذا يجعل `findFirst({associationId, role: ASSOCIATION})` — التي يعتمد
عليها `resetAssociationPassword` وتفاصيل الجمعية — محدَّدة النتيجة دائمًا
بلا غموض، ويطابق نموذج القديم (حساب دخول واحد لكل جمعية). الفهرس مشروط
بالدور، فحسابات `DELEGATE` المتعددة لنفس الجمعية مسموحة كالمعتاد.

---

## 2) الإنشاء المباشر (`POST /associations` — ADMIN)

يطابق `saveAssociation_` بلا `payload.id`. الاختلاف الهيكلي الوحيد:
القديم كان يدمج الإنشاء والتعديل في دالة واحدة يميّزها وجود `id` في
الحمولة؛ الجديد يفصلهما إلى `POST` و`PATCH` صريحين (نفس المنطق، عقد أوضح
وأقل عرضة لخطأ «تعديل تحوّل إلى إنشاء»).

كل ما يلي داخل **معاملة واحدة**:

0. **تحقق البيانات المرجعية قبل المعاملة** (NODE-2.1): `region`/`city`
   يُتحقَّق منهما كزوج أب/ابن فعلي نشط في `reference_values`، و`category`
   (اختياري) يجب أن يكون قيمة نشطة في `ASSOCIATION_CATEGORY` — بنفس
   `validateRegionCity`/`validateAssociationCategory` المستخدَمَين في طلب
   الانضمام العام حرفيًا (لا نسخة ثانية من المنطق). المرادف التاريخي
   `"بر"` يُطبَّع إلى `"جمعية بر"` قبل التخزين. لا grandfathering هنا
   إطلاقًا — السجل جديد (القديم كذلك لا يمرّر `previous` عند الإنشاء).
   الخطأ: `APPLICATION_INVALID_REFERENCE` (400).
1. `IdempotencyService.claim(tx, adminAccountId, 'association-create', opId, payload)`.
2. البريد مرتبط بحساب قائم → `ASSOCIATION_EMAIL_IN_USE` (409).
3. `nextPublicCode(tx,'ASC')` → إنشاء `associations`.
4. `nextPublicCode(tx,'USR')` → إنشاء `accounts` (دور `ASSOCIATION`،
   `must_change_password = true`).
5. `Argon2id` لكلمة المرور المؤقتة التي زوّدها ADMIN → `auth_credentials`.
6. `complete` بالرد `{associationId, accountId}`.

سجل التدقيق `ASSOCIATION_CREATED` يُكتب بعد نجاح الالتزام فقط.

### كلمة المرور المؤقتة داخل حمولة الـidempotency (NODE-2.1 — تصحيح أمني)

الحمولة المُقارَنة كانت `{name, email, phone, category, region, city, status}`
**بلا** `temporaryPassword`. النتيجة: إعادة تشغيل بنفس `opId` وبنفس بقية
الحقول لكن **بكلمة مرور مختلفة** كانت تُعدّ طلبًا مطابقًا فيُعاد رد نجاح
idempotent — بينما هي في الحقيقة حمولة مختلفة يجب أن تُرفض بـ409.

لا يجوز في المقابل أن تعبر بايتات كلمة المرور الصريحة إلى أي شيء يُخزَّن
أو يُسجَّل. الحل المُنفَّذ: تدخل الحمولة **بصمة HMAC حتمية** بدل القيمة
الخام:

```
temporaryPasswordFingerprint = HMAC-SHA256(secret, "association-create-password:v1:" + password)
```

- **لماذا HMAC لا SHA-256 عادي**: كلمات المرور المؤقتة قابلة للتخمين
  بالقاموس؛ تجزئة بلا مفتاح في عمود مخزَّن تُتيح هجوم قاموس دون اتصال.
- **أي مفتاح ولماذا آمن**: يُعاد استخدام `authConfig.rateLimitHmacKey`
  نفسه المستخدَم أصلًا لتحويل المعرِّفات الحساسة إلى `subject_hash` —
  نفس الغرض بالضبط (بصمة غير قابلة للعكس تُقارَن بالتساوي فقط)، مع
  **فصل نطاق** صريح عبر بادئة رسالة ثابتة، فلا تتقاطع بصمة هنا مع بصمة
  هناك. **لم يُضَف أي secret أو متغير بيئة جديد**، ويبقى شرط
  `assertProductionSecretsConfigured` (المفاتيح الثلاثة مختلفة) كما هو.
- **أثر تدوير المفتاح**: `opId` قديم يُعاد بعده يُرفض بـ409 (fail-closed)
  — سلوك محافظ لا يُنشئ تكرارًا.

`IdempotencyService` نفسه لم يتغيّر (يجزّئ ما يُعطى له فقط)، ولا يسجّل
الحمولة في أي `Logger` — تُحقِّق من ذلك مباشرةً في `idempotency.service.ts`.
يحرس هذا اختباران: أحدهما يثبت 409 عند اختلاف كلمة المرور وحدها، والآخر
يمسح `idempotency_keys` و`audit_logs` و`auth_credentials` و`accounts` و
`associations` نصّيًا فلا يجد أي أثر لكلمة المرور الصريحة.

- **كلمة المرور المؤقتة يزوّدها ADMIN هنا** (خلافًا لمسار قبول الطلب الذي
  يولّدها تلقائيًا)، وتخضع لـ`assertPasswordPolicy` نفسها: 8 خانات على
  الأقل مع حروف وأرقام.
- **`opId` إلزامي**: نفس `opId` بنفس الحمولة → لا إنشاء ثانٍ ويُعاد نفس
  الرد؛ نفس `opId` بحمولة مختلفة → `APPLICATION_IDEMPOTENCY_CONFLICT` (409).

---

## 3) التعديل (`PATCH /associations/:id` — ADMIN)

تعديل جزئي: أي حقل غير مُرسَل لا يُمَسّ. الحقول المسموحة:
`name`, `category`, `region`, `city`, `phone`, `email`, `status`.

`:id` يمرّ عبر `ParseUUIDPipe` (NODE-2.1) فيُرفض المعرّف المشوَّه بـ400
نظيف قبل أي استعلام Prisma — كان سابقًا يصل إلى Postgres فيرتد خطأ
`invalid input syntax for type uuid` خامًا بصيغة 500.

### القيم المرجعية التاريخية (grandfathering) — NODE-2.1

المصدر المُتحقَّق منه في القديم:
`ReferenceData.gs::isGrandfatheredValue_(value, previous)` =
`!!previous && String(value) === String(previous)`، ويمرّر
`DevicesAssociations.gs::saveAssociation` قيمة السجل المخزَّنة كـ`previous`
عند التعديل فقط. أي أن **إرسال نفس القيمة المخزَّنة يُقبَل ويُعاد حفظه كما
هو حتى لو لم يعد معتمدًا** — مجرّد تمرير الحقل لا يُفعِّل الرفض — بينما أي
قيمة **مختلفة** يجب أن تكون معتمدة حاليًا.

القواعد المُنفَّذة:

1. حقل مرجعي **لم يُرسَل** لا يُتحقَّق منه إطلاقًا: تعديل الاسم أو الجوال
   أو البريد ينجح رغم وجود تصنيف/منطقة/مدينة تاريخية غير معتمدة. هذا هو
   جوهر grandfathering (ألّا تمنع بيانات قديمة تعديل حقل آخر تمامًا).
2. `category` المُرسَل: يُتحقَّق منه؛ وإن فشل يُقبَل **فقط** إن كان مطابقًا
   حرفيًا للقيمة المخزَّنة. تُعاد القيمة الرسمية بعد تطبيع المرادفات، كما
   يفعل القديم في فرع القيمة التاريخية نفسه.
3. `region`/`city`: إن أُرسل أحدهما أو كلاهما، يُتحقَّق من **الزوج النهائي
   المدمَج** (الجديد لما أُرسل + المخزَّن لما لم يُرسَل) كعلاقة أب/ابن
   كاملة، ما لم يكن الزوج النهائي مطابقًا تمامًا للمخزَّن.

**لا يمكن أبدًا استبدال قيمة غير صالحة بأخرى غير صالحة** — القيمة الجديدة
الوحيدة المقبولة هي قيمة صالحة حاليًا.

**انحراف مقصود وموثَّق عن القديم**: `validateRegionCity_` القديمة تُمرِّر
grandfathering لكل حقل **على حدة**، فتسمح بتغيير المنطقة إلى قيمة معتمدة
مع إبقاء مدينة قديمة لا تتبعها — أي تكوين زوج غير صالح **جديد**. نحن نمنع
ذلك (القاعدة 3 أعلاه) تنفيذًا لقاعدة "لا تُستبدَل قيمة غير صالحة بأخرى غير
صالحة".

### بريد التواصل ≠ بريد الدخول (تمييز جوهري)

**تعديل ADMIN لبريد الجمعية يغيّر بريد التواصل فقط، ولا يغيّر
`auth_credentials.identifier` (بريد تسجيل الدخول) إطلاقًا.**

هذا ما يفعله الكود فعليًا (`associations.service.ts::updateAssociation`
لا يمسّ `auth_credentials` بحال)، وهو مقصود: تغيير هوية الدخول عملية
أمنية يجب أن تكون صريحة ومقصودة، لا أثرًا جانبيًا لتحديث بيان تواصل.
النتيجة العملية التي يحرسها اختبار مخصَّص:

- البريد القديم **يظل** صالحًا لتسجيل الدخول بنفس كلمة المرور.
- البريد الجديد **لا** يصلح هوية دخول (`AUTH_INVALID_CREDENTIALS`).

الواجهة تذكر ذلك صراحةً في نموذج التعديل حتى لا يُفاجأ المشرف.

### التعطيل وإبطال الجلسات

الانتقال `ACTIVE → INACTIVE` (وهو فقط، لا التعديلات الأخرى) يستدعي
`revokeAssociationSessions` الذي يُبطل **كل الجلسات النشطة لكل حسابات
الجمعية**: حساب `ASSOCIATION` وحسابات `DELEGATE` معًا — مطابقًا
`revokeAssociationSessions_` القديمة. أثر ذلك فوري: أي كوكي جلسة قائم
يصبح مرفوضًا (401) عند الطلب التالي.

**إعادة التفعيل `INACTIVE → ACTIVE` لا تُحيي الجلسات المُبطلة.**
`revoked_at` نهائي بتصميمه — يلزم تسجيل دخول جديد. (جلسات الحسابات
الأخرى، مثل ADMIN، لا تتأثر إطلاقًا.)

**ذرّية التعطيل (NODE-2.1)**: تحديث `associations.status` وإبطال الجلسات
كانا استدعاءين منفصلين — فشل بينهما كان يترك الجمعية `INACTIVE` وجلساتها
حيّة (نافذة وصول لحساب موقوف) أو العكس. الآن الاثنان داخل
`prisma.$transaction` واحدة وبنفس عميل `tx`: إمّا يثبتان معًا أو لا يثبت
أيّهما. لم يتغيّر أي سلوك آخر: النطاق يبقى `associationId` وحده (وحسابات
ADMIN لا تحمل `associationId` أصلًا فلا تدخله)، وإعادة التفعيل لا تلمس
`auth_sessions` بحال.

سجل التدقيق `ASSOCIATION_UPDATED` يحمل `statusTransition` عند تغيّر
الحالة، ويبقى **بعد** التزام المعاملة (نمط "التدقيق بعد الالتزام"
المعتمَد منذ NODE-1.1 — التدقيق ليس جزءًا من معاملة قاعدة البيانات).

---

## 4) الإعدادات الذاتية (`PATCH /associations/me/settings` — ASSOCIATION)

يطابق `updateAssociationSettings_`. مسموح فيه **حقلان لا غير**:
`phone` و`email`.

- **`associationId` من AuthContext حصرًا.** لا يوجد حقل بهذا الاسم في
  الـDTO أصلًا، و`ValidationPipe` مضبوط بـ`whitelist: true` و
  `forbidNonWhitelisted: true` فيرفض أي حقل غير معرَّف بـ400 قبل أن يصل
  إلى الخدمة. حتى لو مرّ، الخدمة تقرأ `ctx.associationId` ولا تنظر إلى
  الجسم. لا مسار إطلاقًا لتعديل جمعية أخرى من هنا.
- **لا تصعيد صلاحيات**: `status`, `name`, `category`, `region`, `city`
  كلها مرفوضة على هذا المسار — جمعية لا تستطيع تفعيل نفسها ولا تغيير
  اسمها أو تصنيفها.
- **ADMIN و DELEGATE لا يستطيعان استخدام هذا المسار** (`@Roles(ASSOCIATION)`
  + تحقق ثانٍ داخل الخدمة يرمي `AUTH_FORBIDDEN`).
- البريد المُعطى يُرفض إن كان مستخدَمًا في حساب آخر
  (`ASSOCIATION_EMAIL_IN_USE`).

### زامن `accounts.email` هنا، لا هناك

خلافًا لتعديل ADMIN، الإعدادات الذاتية **تُزامن `accounts.email`** مع
البريد الجديد في نفس المعاملة (`associations.phones/email` +
`accounts.email` معًا) — وهذا ما تفعله `updateAssociationSettings_`
القديمة بالضبط، فحُوفظ عليه حرفيًا.

لكن حتى هنا `auth_credentials.identifier` **لا يتغيّر**: `accounts.email`
هو بريد العرض/المراسلة على الحساب، وليس هوية تسجيل الدخول. تغيير هوية
الدخول يبقى عملية منفصلة غير منقولة في NODE-2.

ترتيب المسارات في الـcontroller مهم: `me/settings` معرَّف **قبل** `:id`
حتى لا تلتقطه المسارات ذات المعامل.

---

## 5) إعادة تعيين كلمة المرور

`POST /auth/associations/:id/reset-password` (ADMIN) — **موجود من NODE-1
ولم يُعَد تنفيذه في NODE-2**. شاشة `/admin/associations` تستدعيه كما هو.
كلمة المرور المؤقتة تُعرض مرة واحدة فقط ولا تُخزَّن، و`mustChangePassword`
يُضبط على `true`. هذا هو **المسار الوحيد** لاستعادة كلمة مرور ضائعة —
لا عبر إعادة تشغيل عملية قبول الطلب (راجع SECURITY_MODEL.md).

---

## 6) الـEndpoints

| Method | Path | الوصول |
|---|---|---|
| PATCH | `/api/v1/associations/me/settings` | ASSOCIATION |
| GET | `/api/v1/associations` | ADMIN |
| POST | `/api/v1/associations` | ADMIN |
| GET | `/api/v1/associations/:id` | ADMIN |
| PATCH | `/api/v1/associations/:id` | ADMIN |
| POST | `/api/v1/auth/associations/:id/reset-password` | ADMIN (NODE-1) |

## 7) الشاشات

- `/admin/associations` — قائمة بعدّادات + بحث/تصفية/ترقيم، نموذج إنشاء
  (مع كلمة مرور مؤقتة و`opId` مولَّد تلقائيًا)، نموذج تعديل، مفتاح
  تفعيل/تعطيل مع تحذير صريح عن إنهاء الجلسات، وزر إعادة تعيين كلمة المرور.
- `/association/settings` — جوال وبريد فقط.

## 8) أكواد الأخطاء

| الكود | HTTP | متى |
|---|---|---|
| `ASSOCIATION_NOT_FOUND` | 404 | جمعية غير موجودة |
| `ASSOCIATION_EMAIL_IN_USE` | 409 | البريد مرتبط بحساب آخر |
| `APPLICATION_IDEMPOTENCY_CONFLICT` | 409 | نفس `opId` بحمولة مختلفة عند الإنشاء |
| `AUTH_FORBIDDEN` | 403 | دور غير مسموح على المسار |
