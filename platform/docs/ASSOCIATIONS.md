# إدارة الجمعيات (NODE-2)

مرجع السلوك: `DevicesAssociations.gs` في الفرع القديم
(`listAssociations_`, `saveAssociation_`, `updateAssociationSettings_`,
`revokeAssociationSessions_`) مع `Validation.gs` و`Pagination.gs`.
الجمعيات تُنشأ بمسارين فقط: **قبول طلب انضمام** (راجع
ASSOCIATION_APPLICATIONS.md §5) أو **إنشاء ADMIN مباشر** (§2 أدناه).

---

## 1) القائمة (`GET /associations` — ADMIN)

ترقيم (`page`, `pageSize` محصور [1,100]، افتراضي 25)، بحث نصّي غير حسّاس
لحالة الأحرف على الاسم/الرمز العام/البريد/المنطقة/المدينة، وتصفية
`status=ACTIVE|INACTIVE`.

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

1. `IdempotencyService.claim(tx, adminAccountId, 'association-create', opId, payload)`.
2. البريد مرتبط بحساب قائم → `ASSOCIATION_EMAIL_IN_USE` (409).
3. `nextPublicCode(tx,'ASC')` → إنشاء `associations`.
4. `nextPublicCode(tx,'USR')` → إنشاء `accounts` (دور `ASSOCIATION`،
   `must_change_password = true`).
5. `Argon2id` لكلمة المرور المؤقتة التي زوّدها ADMIN → `auth_credentials`.
6. `complete` بالرد `{associationId, accountId}`.

سجل التدقيق `ASSOCIATION_CREATED` يُكتب بعد نجاح الالتزام فقط.

- **كلمة المرور المؤقتة يزوّدها ADMIN هنا** (خلافًا لمسار قبول الطلب الذي
  يولّدها تلقائيًا)، وتخضع لـ`assertPasswordPolicy` نفسها: 8 خانات على
  الأقل مع حروف وأرقام.
- **`opId` إلزامي**: نفس `opId` بنفس الحمولة → لا إنشاء ثانٍ ويُعاد نفس
  الرد؛ نفس `opId` بحمولة مختلفة → `APPLICATION_IDEMPOTENCY_CONFLICT` (409).

---

## 3) التعديل (`PATCH /associations/:id` — ADMIN)

تعديل جزئي: أي حقل غير مُرسَل لا يُمَسّ. الحقول المسموحة:
`name`, `category`, `region`, `city`, `phone`, `email`, `status`.

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

سجل التدقيق `ASSOCIATION_UPDATED` يحمل `statusTransition` عند تغيّر
الحالة.

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
