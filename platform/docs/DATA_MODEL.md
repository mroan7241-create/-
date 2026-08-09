# DATA_MODEL.md

النموذج الكامل: `platform/packages/db/prisma/schema.prisma` (Source of
Truth). هذا الملف شرح نصي مختصر للقرارات غير الواضحة من القراءة
المباشرة للـschema، بالإضافة إلى `ERD.mmd` (رسم Mermaid).

**عدد الكيانات: 24** (association_applications وapplication_answers
كيانان منفصلان — عدد نماذج `model` الفعلي في `schema.prisma`، لا 23).

## مبادئ عامة

- **PK**: UUID (`uuidv7()`) على كل كيان. **لا** استخدام `publicCode`
  كـPK أو FK إطلاقًا.
- **`publicCode`**: نص فريد (`@unique`) يحمل الرقم البشري القديم
  (`BEN-000001`, `NED-000001`, `MND-000001`, `APP-000001`,
  `RCB-000001`, `RCI-000001`, ...) — لأغراض العرض وربط بيانات الهجرة
  فقط.
- **Soft delete** افتراضيًا للكيانات التشغيلية (`archived_at`/`status`)
  — **لا** hard delete. الاستثناء: `audit_logs`, `device_movements`,
  `delivery_attempts` — append-only حقيقية، بلا أي مسار تعديل أو حذف
  في طبقة التطبيق.
- **Timestamps**: UTC دومًا (`DateTime` في Prisma تُخزَّن `timestamptz`
  ضمنيًا مع PostgreSQL).

## قرارات تستحق تفصيلًا

### 1) `beneficiaries.legacy_status` و`legacy_needs_text`

الحقل القديم `'حالة المستفيد'` (سبع قيم: جديد/تحت المراجعة/معتمد/...)
منفصل تمامًا عن `'حالة مراجعة المستفيد'` الجديدة (ثلاث قيم فقط). كلاهما
كان موجودًا معًا في نفس صف Google Sheets في النظام القديم. نحتفظ
بالقديم كحقل قراءة تاريخية (`legacy_status`) فقط أثناء الهجرة — لا
يُكتب إليه أي منطق جديد، ولا يُقرأ منه أي قرار أعمال جديد. نفس المبدأ
لـ`legacy_needs_text` (الحقل النصي الحر `'الاحتياج'` قبل وجود جدول
`beneficiary_needs` علائقي).

### 2) `beneficiary_needs` — قيد فريد (beneficiary_id, device_type)

مطابق حرفيًا لقيد النظام القديم: مستفيد واحد لا يملك أكثر من احتياج
واحد من نفس نوع الجهاز. مُطبَّق كـDatabase `UNIQUE` حقيقي
(`@@unique([beneficiaryId, deviceType])`) — لا فقط تحقّق تطبيقي.

### 3) `device_allocations` — partial unique indexes

Prisma schema لا يدعم `@@unique` بشرط `WHERE` مباشرة. لذلك:

- الحقل معلَّق في `schema.prisma` (تعليق فوق `model DeviceAllocation`).
- القيد الفعلي أُضيف يدويًا في نهاية migration الأولى
  (`ux_device_allocations_active_device`,
  `ux_device_allocations_active_need`) — راجع
  `prisma/migrations/*_init/migration.sql`.

هذا يضمن على مستوى قاعدة البيانات نفسها (لا فقط منطق التطبيق):
- جهاز واحد لا يملك أكثر من تخصيص `ACTIVE` واحد في نفس اللحظة.
- احتياج واحد لا يملك أكثر من جهاز `ACTIVE` مخصَّص له في نفس اللحظة.

### 4) `device_units.current_location_type` / `current_location_ref`

يحل محل الحقل المسطَّح `'رقم المستفيد'` على الجهاز في النظام القديم.
`current_location_type` هو enum (`DeviceMovementLocationType`:
`WAREHOUSE`/`DELEGATE`/`BENEFICIARY`/`DAMAGED_HOLDING`)، و
`current_location_ref` مرجع اختياري (معرّف مندوب أو مستفيد) حسب النوع.

**NODE-0.1**: قاعدة "لا يوجد جهاز بموقع مجهول" مفروضة الآن جزئيًا
عبر CHECK constraint حقيقي (`ck_device_units_location_ref_by_type`):
`WAREHOUSE`/`DAMAGED_HOLDING` يجب أن يكون `current_location_ref` فيهما
`NULL` (الجمعية معروفة بالفعل عبر `association_id` على السجل نفسه، لا
كيان مستودع مستقل بعد)، و`DELEGATE`/`BENEFICIARY` يجب أن يكون المرجع
غير فارغ (`NOT NULL`). ما لا تفرضه DB (polymorphic FK غير ممكن بعمود
واحد يشير لجدولين مختلفين حسب النوع): أن `current_location_ref` يشير
فعليًا لصف موجود في `accounts` (دور DELEGATE) أو `beneficiaries` حسب
النوع، وأن ذلك السجل ينتمي لنفس `association_id`. هذا يبقى Service-level
validation صريحًا يُطبَّق عند تفعيل InventoryModule/DeliveriesModule
فعليًا (NODE-4/NODE-6). كل تحديث لهذا الحقل يجب أن يترافق أيضًا داخل نفس
Transaction مع `INSERT` في `device_movements` (راجع ARCHITECTURE.md §3).

### 5) `receipt_items` — CHECK constraints

مُطبَّقة في migration الأولى (SQL خام بعد الجزء المولَّد من Prisma):

```sql
sent_qty > 0
good_qty >= 0
damaged_qty >= 0
missing_qty >= 0
(good_qty + damaged_qty + missing_qty = sent_qty) OR (كلها صفر — قبل التأكيد)
```

القيد الأخير يسمح بحالة "لم يُؤكَّد بعد" (الكميات الثلاث صفر افتراضيًا)
لكنه يفرض المطابقة الكاملة فور كتابة أي قيمة فعلية — يجب أن تُكتب
الكميات الثلاث معًا داخل نفس Transaction عند التأكيد (لا تحديث جزئي).

### 6) `receipt_damage_photos` — علاقة صورة↔بند مستقلة

نفس مبدأ النظام القديم: صورة تلف واحدة (`file_id`) قد ترتبط بأكثر من
بند (`receipt_item_id`) — صف علاقة مستقل لكل ربط، لا مصفوفة معرّفات في
عمود واحد. `id` (رقم الربط) فريد لكل صف حتى لو تكرر `file_id` نفسه عبر
عدة صفوف.

### 7) `delivery_missions` مقابل `delivery_attempts`

فصل صريح غير موجود بهذا الوضوح في النظام القديم (كانت ورقة "التسليمات"
تخلط الاثنين): `delivery_missions` تمثل الحالة التشغيلية الحالية
للمستفيد (مندوب مُعيَّن، حالة واحدة حالية)، و`delivery_attempts` سجل
append-only لكل محاولة تسليم فعلية على حدة (قد تتكرر عدة مرات لنفس
المهمة عند تعذّر التسليم). **لا تُفعَّل** أي custody workflow جديدة في
NODE-0 — الحالات المنقولة هي فقط الحالات الموجودة فعليًا في
`DeliveryStatus` (راجع STATE_MAPPING.md §9).

### 8) `files` — لا رابط عام دائم

يستبدل Google Drive metadata (`معرف الملف/الاسم/النوع/الحجم` كانت
تُخزَّن كأعمدة مباشرة على كل ورقة في النظام القديم). كل ملف الآن سجل
مستقل بـ`storage_provider`/`bucket`/`object_key` — **دائمًا PRIVATE**؛
الوصول فقط عبر signed URL مؤقت تصدره طبقة الـAPI بعد فحص authorization
كامل (لا اعتماد على "الرابط سري بذاته" كما كان الحال جزئيًا في النظام
القديم قبل Phase 3.1.1 §6).

### 9) `idempotency_keys` — durable حقيقي

يستبدل الاعتماد الجزئي على `CacheService` (TTL 5 دقائق، `runLockedIdempotent_`
في `DataUtils.gs`) بجدول حقيقي: `UNIQUE (account_id, scope, key)`،
`status` (`IN_PROGRESS`/`COMPLETED`/`FAILED`) يمنع سباقًا بين طلبين
بنفس المفتاح يصلان معًا (ما كان النظام القديم يحلّه بقفل ScriptLock
واحد لكامل العملية — هنا عبر transaction قصيرة تكتب `IN_PROGRESS` أولًا
ضمن unique constraint).

### 10) `outbox_events` — Transactional Outbox بسيط

الهدف الوحيد في NODE-0: منع فقد side-effects عند فشل ما بعد commit
(مطابق لمبدأ "عزل audit/allocation عن نجاح العملية الأساسية" في
`reviewBeneficiaryNeeds_`/`bulkReviewBeneficiaries` بالفرع القديم — راجع
BeneficiaryNeeds.gs). **لا Notification Engine كامل الآن** — الأنواع
الثلاثة المدرجة (`BENEFICIARY_APPROVED`, `RECEIPT_CONFIRMED`,
`STOCK_INCREASED`) أمثلة توضيحية فقط لما سيُنشَر لاحقًا، بلا أي مستهلك
(`consumer`) مُنفَّذ بعد.

### 11) NODE-0.1 — Source of Truth الوحيد للتخصيص (إزالة الربط المزدوج)

`device_units` كان يحمل في NODE-0 حقلًا مباشرًا
`beneficiaryNeedId`/`beneficiaryNeed` إلى جانب كيان `device_allocations`
المستقل — مصدر حقيقة مزدوج لنفس المعنى (أي احتياج مخصَّص له هذا الجهاز
حاليًا). أُزيل هذا الربط بالكامل في NODE-0.1، **ولم يُضَف** `beneficiaryId`
مباشر بدلًا منه. المصدر الوحيد الآن: حالة الجهاز (`device_units.status`)
+ وجود `device_allocations` نشطة (`status = 'ACTIVE'`) — والتي بحكم
partial unique index (البند 3 أعلاه) لا يمكن أن تتكرر لنفس الجهاز أو
لنفس الاحتياج في نفس اللحظة.

### 12) NODE-0.1 — Tenant / Association Integrity (composite foreign keys)

`association_id` denormalized عمدًا على كل كيان تابع لجمعية (لتحسين
tenant filtering والأداء — لا يتطلب كل استعلام JOIN إلى الكيان الأب
لمعرفة الجمعية). المخاطرة: drift — سجل يحمل `association_id` مختلفًا
عن association_id الكيان الفعلي الذي يشير إليه (مثلًا احتياج لجمعية A
يشير خطأً إلى مستفيد جمعية B).

الحل: composite unique keys `(id, associationId)` على الكيانات الأب
(`beneficiaries`, `beneficiary_needs`, `device_units`) + composite
foreign keys من الكيانات التابعة تشير إلى هذين العمودين معًا، لا `id`
فقط:

```
beneficiary_needs   (beneficiary_id, association_id) → beneficiaries(id, association_id)
device_allocations  (device_id, association_id)       → device_units(id, association_id)
device_allocations  (beneficiary_need_id, association_id) → beneficiary_needs(id, association_id)
device_allocations  (beneficiary_id, association_id)  → beneficiaries(id, association_id)
device_movements    (device_id, association_id)       → device_units(id, association_id)
delivery_missions   (beneficiary_id, association_id)  → beneficiaries(id, association_id)
```

PostgreSQL يرفض الآن أي `INSERT`/`UPDATE` يحاول تمرير `association_id`
لا يطابق association_id الفعلي للسجل المُشار إليه — **قبل** وصول أي
Service validation. مُختبَر بـ12+ حالة تكامل حقيقية ضد PostgreSQL (راجع
`packages/db/test/db-integrity.test.ts`، الأقسام 1-4).

**ما بقي Service-level فقط**: مطابقة `delegate_account_id` (على
`delivery_missions`/`delivery_attempts`) لنفس `association_id` — لم
تُطلَب composite FK لها صراحة في هذه المرحلة، و`accounts.association_id`
أصلًا nullable (حساب ADMIN بلا جمعية)، فربطها بقيد بنيوي صارم يحتاج
تصميمًا إضافيًا (هل NULL مسموح دومًا لـADMIN المُعيَّن كمندوب مؤقت؟) —
يُحسم عند تفعيل DelegatesModule فعليًا (NODE-6).

### 13) NODE-0.1 — Reference Values uniqueness (partial unique indexes)

القيد الأصلي `@@unique([type, value, parentId])` في NODE-0 كان غير
كافٍ: PostgreSQL يعامل كل `NULL` كقيمة مختلفة عن غيرها ضمن `UNIQUE`
عادي، فلا يمنع تكرار قيم جذرية (`parent_id IS NULL`) بنفس `(type,
value)` — مثال: نوع `REGION` بنفس القيمة `"الرياض"` مرتين بلا أب، كلاهما
كان يمر بلا رفض.

الحل: أُزيل ذلك القيد من `schema.prisma`، واستُبدل بـpartial unique
indexes حقيقية في الـmigration:

```sql
CREATE UNIQUE INDEX ux_reference_values_root
  ON reference_values (type, value) WHERE parent_id IS NULL;

CREATE UNIQUE INDEX ux_reference_values_child
  ON reference_values (type, value, parent_id) WHERE parent_id IS NOT NULL;
```

النتيجة: تكرار جذر بنفس `(type, value)` مرفوض، وتكرار child بنفس
`(type, value)` تحت **نفس** الأب مرفوض، لكن نفس child (نفس `type`/
`value`) تحت أبوين مختلفين **مسموح** — متوافق مع النموذج الهرمي الحالي
(مثال: مدينة بنفس الاسم قد تتكرر تحت منطقتين مختلفتين). مُختبَر صراحة
(الحالتان 5-6 + حالة "مسموح" في `db-integrity.test.ts`).

### 14) NODE-0.1 — Device Type unification (enum واحد + أرشيف تاريخي منفصل)

قبل هذه المراجعة: `beneficiary_needs.device_type` كان enum
(`NeedDeviceType`)، بينما `receipt_items.device_type` و
`device_units.device_type` كانا نصًا حرًا (`String`) — لا ضمان أن
القيمة تطابق أحد الأنواع الثلاثة المعتمدة.

الحل: enum داخلي واحد ثابت (`DeviceType`: `REFRIGERATOR`/`OVEN`/
`WASHING_MACHINE`) مستخدَم عبر الكيانات الثلاثة معًا:

- `beneficiary_needs.device_type`: **يبقى إلزاميًا** (`NOT NULL`) —
  النظام القديم كان يفرض هذا القيد أصلًا عند تسجيل احتياج جديد.
- `receipt_items.device_type` و`device_units.device_type`: **اختياريان**
  (`DeviceType?`)، مع حقل مصاحب `legacyDeviceTypeText` (نص حر) — لأن
  السجلات التاريخية (ورقة "الأجهزة" القديمة) كانت تسمح بأنواع أوسع من
  الثلاثة الجديدة (`REFERENCE_SEED_DEVICE_TYPES` القديمة). CHECK
  constraint (`ck_receipt_items_device_type_present`،
  `ck_device_units_device_type_present`) يفرض DB-level أن أحد الحقلين
  على الأقل غير فارغ دومًا — لا صف بلا أي دلالة لنوع الجهاز.
- **إلزام `device_type` (enum) لكل سجل تشغيلي جديد** (لا نص حر) يبقى
  Service-level (DTO validation عند الإنشاء الفعلي في NODE-4) — DB
  لا يمكنها تمييز "سجل جديد يُنشأ الآن" عن "سجل مستورَد تاريخيًا" بذاتها.

راجع `STATE_MAPPING.md` و`LEGACY_DATA_MIGRATION.md` للتفصيل الكامل.

## إضافات NODE-1 (مصادقة/جلسات/reference data)

عبر migration جديدة `20260809050238_node1_auth_reference_data` (لم
تُعدَّل migration `20260809043546_init` — append-only ملزم من هذه
النقطة فصاعدًا):

- `accounts.last_login_at` (`DateTime?`) — يُحدَّث بعد كل دخول ناجح فقط.
- `auth_sessions.absolute_expires_at` (`DateTime`, NOT NULL) — سقف
  مطلق ثابت منذ الإنشاء (12 ساعة)، منفصل عن `expires_at` المنزلق (6
  ساعات). راجع AUTHENTICATION.md §3 لخوارزمية التمديد الكاملة.
- `ReferenceValueType` (enum) وُسِّع من 5 إلى 10 قيم عبر `ALTER TYPE
  ... ADD VALUE` (لا DML على القيم الجديدة ضمن نفس الـmigration —
  آمن): أُضيف `ASSOCIATION_SECTOR`, `DEVICE_SPEC`, `SUPPLIER`,
  `DIFFERENCE_REASON`, `RECEIVER_TITLE` لمطابقة `REFERENCE_DATA_TYPES_`
  القديمة الكاملة (10 أنواع).
- `password_reset_tokens` (id, account_id, email_normalized,
  token_hash, attempt_count, expires_at, consumed_at, created_at؛
  `@@index([account_id])`, `@@index([expires_at])`) — يستبدل اعتماد
  القديم على `CacheService` بنموذج دائم صالح عبر أكثر من instance.
- `auth_rate_limits` (id, scope, subject_hash, window_started_at,
  attempt_count, expires_at, created_at, updated_at؛
  `@@unique([scope, subject_hash])`, `@@index([expires_at])`) —
  `subject_hash` = HMAC-SHA256 للمعرِّف الخام، لا يُخزَّن المعرِّف نفسه.

راجع `AUTHENTICATION.md` للسلوك الكامل، و`ReferenceValue.parentId`
(FK ذاتي حقيقي على `id` — على خلاف عمود "يتبع" النصي المسطَّح في
القديم) في مخطط الـschema أعلاه للعلاقات الهرمية (REGION→CITY،
DEVICE_TYPE→DEVICE_SPEC).

## الفهارس (Indexing Plan)

مطابقة لما طُلب صراحة — لا فهارس عشوائية إضافية:

```
accounts(email, status)
associations(status)
beneficiaries(association_id, review_status)
beneficiaries(phone)
beneficiary_needs(beneficiary_id)
beneficiary_needs(association_id, decision_status, fulfillment_status)
device_units(association_id, device_type, status)
device_allocations(association_id, status)
receipt_batches(association_id, status)
delivery_missions(delegate_account_id, status)
delivery_missions(association_id, status)
audit_logs(entity_type, entity_id, created_at)
audit_logs(actor_account_id, created_at)
idempotency_keys(account_id, scope, key)  — عبر UNIQUE constraint نفسه، لا فهرس منفصل إضافي
```

راجع `ERD.mmd` للرسم الكامل للعلاقات.
