# DATA_MODEL.md

النموذج الكامل: `platform/packages/db/prisma/schema.prisma` (Source of
Truth). هذا الملف شرح نصي مختصر للقرارات غير الواضحة من القراءة
المباشرة للـschema، بالإضافة إلى `ERD.mmd` (رسم Mermaid).

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
`current_location_ref` مرجع اختياري (معرّف مندوب أو مستفيد) حسب النوع
— **لا يوجد جهاز بموقع غير معروف** (نفس القاعدة المطلوبة صراحة)، لأن
كل تحديث لهذا الحقل يجب أن يترافق داخل نفس Transaction مع `INSERT` في
`device_movements` (راجع ARCHITECTURE.md §3).

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
