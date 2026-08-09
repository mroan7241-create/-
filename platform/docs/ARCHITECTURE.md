# ARCHITECTURE.md — منصة جمعية الزاد (Node.js/NestJS/Next.js/PostgreSQL)

## 0) القاعدة الحاكمة الأولى: FEATURE PARITY FIRST

المرجع الوحيد للميزات المعتمدة هو النظام الفعلي على الفرع
`claude/code-index-review-kz5k4u`، commit
`daa5e6d5d98b3b724bd867ce1d9117ded14db3f9` ("الفرع القديم"). لا تُعتبر
أي حاجة مستقبلية (Procurement/RFQ، Main/Reserve، Basket، Custody
الجديد، Scoring lifecycle الجديد، Notification Engine كامل، Closure
workflow) ميزة معتمدة إلا إذا كانت منفَّذة فعليًا في الفرع القديم. راجع
`FEATURE_PARITY.md` لتغطية كل endpoint موجود فعليًا.

## 1) قواعد حاكمة (لا نقاش فيها)

- **GitHub هو Source of Truth الوحيد.** لا تعديل يدوي على قاعدة
  البيانات خارج migrations مُصدَرة (`packages/db/prisma/migrations/`).
- **لا حذف للفرع القديم أو لمشروع Apps Script** حتى بعد اعتماد Cutover
  صراحة (NODE-10).
- **لا business logic داخل controllers.** كل تحقّق/قرار أعمال يمر عبر
  طبقة Services؛ الـcontrollers تتحقق من DTO فقط وتستدعي service.
- **لا وصول مباشر لقاعدة البيانات من الـcontrollers** — عبر
  services/repositories فقط.
- **Authorization دائمًا Server-side.** لا اعتماد على إخفاء عناصر
  الواجهة — نفس مبدأ النظام القديم (`requireSession_`/tenant filtering
  في كل دالة، لا فقط في الواجهة).
- **timestamps بصيغة UTC في قاعدة البيانات**، وتُعرض بتوقيت
  `Asia/Riyadh` في الواجهة فقط — لا تُحفظ سلاسل تاريخ عربية منسَّقة
  كـSource of Truth (خلافًا للنظام القديم الذي كان يخزّن أحيانًا نصًا
  منسَّقًا في Google Sheets).

## 2) الخدمة الأولى: لماذا PostgreSQL علائقي حقيقي لا نسخة من Sheets

النظام القديم مبني على أوراق Google Sheets مسطَّحة، بحقول نصية حرة
لبعض العلاقات (مثل "أرقام الأجهزة" كنص مفصول بفواصل في ورقة
"التسليمات" القديمة)، وقفل عملية واحد (`ScriptLock`) بدل معاملات
قاعدة بيانات حقيقية، وتراجع (rollback) يدوي عبر لقطات "قبل" الكتابة.
هذا كان الحل الصحيح لبيئة Apps Script، لكنه ليس نموذج بيانات نريد
تقليده حرفيًا.

القرارات المعمارية للمنصة الجديدة:

- **Domain Model علائقي حقيقي** — كيانات مستقلة بعلاقات FK صريحة
  (`device_allocations`، `device_movements` بدل حقل "رقم المستفيد" حر
  على الجهاز، إلخ) — راجع `DATA_MODEL.md`.
- **UUID داخلي كـPK، `publicCode` منفصل للعرض.** لا يُستخدم أبدًا الرقم
  البشري القديم (`BEN-000001`...) كـForeign Key — يبقى فقط للعرض وربط
  بيانات الهجرة القديمة (`LEGACY_DATA_MIGRATION.md`).
  - **قرار**: استخدام `uuidv7()` (متوفرة أصلًا في PostgreSQL 18 كدالة
    مدمجة) بدل `gen_random_uuid()` العشوائي (uuid v4) — UUIDv7 قابل
    للفرز زمنيًا، ما يحسّن أداء الفهارس (`B-tree index locality`) على
    جداول append-only كبيرة (`audit_logs`, `device_movements`,
    `delivery_attempts`).
- **PostgreSQL Transactions حقيقية** بدل نمط "لقطة قبل + تراجع يدوي عند
  الفشل" — راجع القسم 3 أدناه لقائمة العمليات التي يجب أن تكون ACID.
- **Idempotency durable حقيقي** (`idempotency_keys` بقيد `UNIQUE
  (account_id, scope, key)`) بدل `CacheService` مؤقت (5 دقائق TTL) في
  النظام القديم.

## 3) العمليات التي يجب أن تكون ACID Transaction

مطابقة للعمليات الحرجة في النظام القديم (كل منها كانت تُدار بلقطة +
تراجع يدوي هناك؛ هنا تصبح `prisma.$transaction`):

1. مراجعة المستفيد + قرارات الاحتياجات (`reviewBeneficiaryNeeds_`).
2. إنشاء مستفيد + احتياجاته (`updateBeneficiaryWithNeeds_`).
3. تأكيد Receipt Batch (كتابة الكميات الثلاث + قفل المحضر).
4. إنشاء `device_units` من `good_qty` بعد التأكيد.
5. ربط Device باحتياج (`linkDeviceToNeed_` القديمة).
6. تحرير/Rebalance Allocation (فكّ ربط جهاز + تراجع حالة تنفيذ الاحتياج جماعيًا).
7. انتقال الجهاز (`device_units.status` + `device_movements` INSERT — **دائمًا معًا في نفس المعاملة**، لا جهاز بموقع غير معروف).
8. إتمام التسليم (`delivery_attempts` INSERT + `delivery_missions`/`beneficiary_needs` تحديث).

**تنبيه صريح مطلوب في هذا الملف**: لا ندّعي atomicity كاملة عندما تشمل
العملية Object Storage خارجي (رفع ملف). النمط المعتمد لملفات الاستلام
والتوقيعات والإثباتات:

```
1) staged upload → يُرفع الملف إلى مسار مؤقت (object_key بادئة "staging/")
2) DB transaction → تُنشأ سجلات files + الكيان المرتبط بها معًا؛ عند
   النجاح يُنقل/يُعاد تسمية الملف من staging إلى مساره النهائي (خطوة
   ما بعد commit، idempotent — إعادة المحاولة آمنة)
3) cleanup strategy → مهمة دورية (خارج نطاق NODE-0) تحذف كائنات staging
   الأقدم من مهلة معينة لم تُربَط بأي سجل قاعدة بيانات (رفع نجح لكن
   الـtransaction فشلت بعده)
```

## 4) AutoAllocation — لا نقل الآن، لكن التصميم يستوعبه

`AutoAllocation.gs` **لا يُنقل في NODE-0** (ولا حتى NODE-1 إلى
NODE-4) — القواعد المعتمدة (`RELEASE.md`/`StateRules.gs`) التي يجب أن
يُنفّذها المحرك لاحقًا بالضبط دون أي تغيير في الخوارزمية نفسها:

1. تعظيم عدد المستفيدين المكتملين بالكامل (globally، لا لكل جمعية
   منفصلة).
2. تقليل الاحتياجات الناقصة إلى أدنى حد.
3. تقليل استرجاع (`reclaim`) تخصيصات جزئية جاهزة موجودة بالفعل.
4. Tie-break حتمي (`deterministic technical tie`) — نفس المدخلات تنتج
   نفس النتيجة دومًا، لا عشوائية.

التخصيصات الجزئية (`partial allocations`) يمكن إعادة موازنتها فقط قبل
تعيين مندوب (`DeliveryStatus.NOT_STARTED`/قبل `assignDelegate`
المكافئ) — بعدها لا رجوع.

**تصميم القيود البنيوية التي تخدم هذا لاحقًا** (مُطبَّقة فعليًا في
`schema.prisma`/الـmigration الأولى):

- `device_allocations`: partial unique index `WHERE status = 'ACTIVE'`
  على `device_id` وعلى `beneficiary_need_id` منفصلين — جهاز واحد
  بتخصيص نشط واحد، واحتياج واحد بجهاز نشط واحد، دون قفل تطبيقي إضافي.
- **حماية التزامن لكل جمعية**: عند نقل المحرك فعليًا (NODE-5)، يجب أن
  يُمسك قفل على مستوى الجمعية (مثلًا `pg_advisory_xact_lock` بمفتاح
  مشتق من `association_id`) قبل تشغيل التخصيص، حتى لا يعمل allocator
  مرتين متعارضتين لنفس الجمعية بالتزامن — يعادل انضباط
  `LockService.getScriptLock()` في النظام القديم لكن بحبيبة أدق (لكل
  جمعية، لا قفل عالمي واحد على المشروع كله).

## 5) هوية جمعية الزاد وRTL

المرجع الوحيد للهوية البصرية هو `Index.html` على الفرع القديم — ألوان
عنابي (`--zad-*`) وذهبي (`--gold-*`) منقولة حرفيًا كـdesign tokens في
`apps/web/app/globals.css` (NODE-0 يكتفي بالمتغيرات الأساسية + RTL
foundation؛ لا نقل typography الكاملة أو المكوّنات بعد — راجع
`MIGRATION_ROADMAP.md`). كل شاشة `<html lang="ar" dir="rtl">` من جذر
التخطيط (`app/layout.tsx`) — لا استثناء.

## 6) حدود الـModules (NODE-0)

كل module في `apps/api/src/modules/*` هيكل فقط (controller placeholder
واحد + `_module-status` endpoint إعلامي) — الحدود بين Domains مرسومة
الآن لتُعبَّأ تدريجيًا:

`AuthModule`, `AccountsModule`, `AssociationsModule`,
`ApplicationsModule`, `BeneficiariesModule`, `BeneficiaryNeedsModule`,
`ReferenceDataModule`, `ReceiptsModule`, `InventoryModule`,
`AllocationModule`, `DelegatesModule`, `DeliveriesModule`,
`ActivitiesModule`, `FilesModule`, `AuditModule`, `SettingsModule`.

## 7) لماذا لا Redis الآن

لا حاجة فعلية ظهرت في NODE-0 (لا جلسات موزَّعة متعددة العمليات بعد، لا
rate-limiting متقدم، لا queue فعلية). `idempotency_keys` و
`outbox_events` في PostgreSQL كافيان لهذه المرحلة. يُعاد التقييم عند
NODE-5/NODE-6 إن ظهرت حاجة حقيقية (مثلًا queue لمعالجة `outbox_events`
بشكل غير متزامن).

## 8) NEEDS_DECISION المسجَّلة في هذه المرحلة

راجع نهاية `MIGRATION_ROADMAP.md` للقائمة الكاملة — تتضمن قرارات لم
تُحسم بعد (نمط `getBootstrapData` الضخم مقابل REST مستقل لكل نطاق، شكل
دقيق لـService/Repository boundary، إلخ).
