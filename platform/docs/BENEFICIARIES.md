# المستفيدون والاحتياجات ومراجعتها (NODE-3)

هذا المستند يوثّق ما نُفِّذ فعليًا في NODE-3: نقل
`Beneficiaries.gs::listBeneficiaries/saveBeneficiary` و
`BeneficiaryNeeds.gs::saveBeneficiaryWithNeeds/setBeneficiaryNeeds/
removePendingBeneficiaryNeed/reviewBeneficiaryNeeds/bulkReviewBeneficiaries`
من الـbaseline القديم `daa5e6d5d98b3b724bd867ce1d9117ded14db3f9`.

خرائط الحالات نفسها موثَّقة في STATE_MAPPING.md (§4 مراجعة المستفيد،
§6 قرار الاحتياج، §7 تنفيذ الاحتياج، §11 أنواع الأجهزة) ولا تُكرَّر هنا.

---

## 1) نقاط النهاية والصلاحيات

| Method | Path | الأدوار | الوصف |
|---|---|---|---|
| `GET` | `/beneficiaries` | ADMIN, ASSOCIATION | قائمة مُرقَّمة خادميًا + بحث/تصفية/ترتيب |
| `POST` | `/beneficiaries` | ADMIN, ASSOCIATION | إنشاء مستفيد + احتياجاته في معاملة ذرّية واحدة |
| `GET` | `/beneficiaries/:id` | ADMIN, ASSOCIATION | تفاصيل مستفيد مع كل احتياجاته |
| `PATCH` | `/beneficiaries/:id` | ADMIN, ASSOCIATION | تعديل الحقول (+ مزامنة الاحتياجات اختياريًا) |
| `DELETE` | `/beneficiaries/needs/:needId` | ADMIN, ASSOCIATION | إزالة احتياج **معلَّق** قبل القرار النهائي |
| `POST` | `/beneficiaries/:id/review` | **ADMIN فقط** | مراجعة فردية: قرار المستفيد + قرار كل احتياج معًا |
| `POST` | `/beneficiaries/bulk-review` | **ADMIN فقط** | مراجعة بالجملة، كل عنصر معاملة مستقلة |

الأدوار مطابقة لِLegacy حرفيًا: `requireSession_(token, ['ADMIN','ASSOCIATION'])`
لكل دوال الإنشاء/التعديل/القائمة، و`requireSession_(token, ['ADMIN'])`
لِ`reviewBeneficiaryNeeds`/`bulkReviewBeneficiaries`. **`DELEGATE` بلا أي
وصول** لأي منها (لا في القديم ولا في الجديد).

كل `:id`/`:needId` يمرّ عبر `ParseUUIDPipe` (تحصين NODE-2.1).

---

## 2) نموذج العزل بين الجمعيات (tenant isolation)

- `associationId` لفاعل `ASSOCIATION` يأتي من `AuthContext` **حصرًا** —
  تمامًا كنمط `updateSelfSettings` في NODE-2. أي `associationId` مُرسَل من
  عميل بدور `ASSOCIATION` يُتجاهَل كليًا (قراءةً) أو يُستبدَل بجمعية الجلسة
  (كتابةً)، ولا يُستخدم في أي قرار.
- `ADMIN` وحده يستطيع تمرير `associationId` كمُصفٍّ للعرض أو كجمعية هدف
  عند الإنشاء نيابةً.
- محاولة `ASSOCIATION` قراءة/تعديل مستفيد جمعية أخرى تُعيد **404 لا 403**
  عمدًا — منعًا لتسريب وجود سجل عبر تعداد المعرّفات.
- الطبقة الأخيرة قاعدة بيانات لا كود: `beneficiary_needs` مرتبط بجدول
  `beneficiaries` عبر **composite FK** `(beneficiary_id, association_id)`
  (NODE-0.1)، فيستحيل بنيويًا أن يشير احتياج جمعية إلى مستفيد جمعية أخرى.

---

## 3) قواعد الأعمال المنقولة

### الإنشاء
- **احتياج واحد صالح على الأقل إلزامي** (`validateNewNeedDeviceTypes_`) —
  لا مستفيد بلا احتياج إطلاقًا.
- الأنواع المسموحة عند أي كتابة جديدة: `REFRIGERATOR`/`OVEN`/`WASHING_MACHINE`
  فقط (`Config.gs::NEW_NEED_DEVICE_TYPES` = ثلاجة/فرن/غسالة).
- تكرار نفس النوع داخل الطلب يُدمَج بلا خطأ (`uniqueTypes`).
- **تكرار الجوال داخل نفس الجمعية يُرفض** (`findConfirmedDuplicateBeneficiary_`):
  يُفحص الجوال الأساسي والإضافي معًا، وداخل الجمعية وحدها — لا يُفحص أي
  سجل لجمعية أخرى فلا تتسرّب بياناتها.

### التعديل ومزامنة الاحتياجات
- `deviceTypes` **غائبة** ⇒ لا تُمسّ قائمة الاحتياجات إطلاقًا (تعديل حقول
  وصفية بحت). **مُرسَلة** ⇒ تُعامَل كقائمة نهائية كاملة، والفارغة صراحةً
  مرفوضة دائمًا.
- تُضاف الأنواع الجديدة، ويُحذف **المعلَّق** الغائب عن القائمة. محاولة حذف
  احتياج **محسوم** تُرفض قبل أي كتابة.
- **لا نقل بين الجمعيات من نموذج التعديل العام** — أي `associationId`
  مختلف عن الحالي يُرفض صراحة (`BENEFICIARY_ASSOCIATION_IMMUTABLE`)، لا
  يُتجاهَل بصمت (Phase 2.3.4).

### قفل ما بعد القرار النهائي
بمجرد أن يصبح المستفيد `APPROVED` أو `REJECTED`:
لا إضافة ولا حذف ولا تعديل لأي احتياج خارج عملية القرار نفسها
(`BENEFICIARY_NEEDS_LOCKED`). الاستثناء الوحيد هو انتقالات القرار نفسه.

### المراجعة (فردية وبالجملة)
1. المستفيد يجب أن يكون `UNDER_REVIEW`؛ القرار **نهائي وغير قابل لإعادة
   الفتح** (`BENEFICIARY_ALREADY_REVIEWED`, 409).
2. يجب وجود احتياج معلَّق واحد على الأقل (`BENEFICIARY_NO_PENDING_NEEDS`).
3. **سبب رفض المستفيد إلزامي** عند الرفض (≤ 500 حرفًا).
4. **سبب رفض الاحتياج الفردي اختياري دائمًا** — لا يُرفض القرار لغيابه.
5. عند **الاعتماد**: يجب البتّ في **كل** احتياج معلَّق صراحةً
   (`BENEFICIARY_NEED_DECISION_MISSING`)، و**يجب أن ينتهي احتياج واحد على
   الأقل معتمدًا** (`BENEFICIARY_ALL_NEEDS_REJECTED`) — أي أن "كل
   الاحتياجات مرفوضة" يستحيل معه الاعتماد، فيصير المصير رفضًا حتمًا.
6. عند **الرفض**: كل الاحتياجات المعلَّقة تُغلَق إلى `REJECTED`
   **بسبب المستفيد الموحَّد نفسه** — حتى تلك التي أُرسل لها سبب فردي صراحةً
   (Phase 3.1 القسم 0: سبب واحد موحَّد لا أسباب متفرقة).
7. اعتماد أي احتياج يضبط فورًا `fulfillmentStatus = APPROVED_ENTITLEMENT`
   — **حقيقة أعمال بحتة، مستقلة تمامًا عن أي مخزون**. لا يوجد فحص توفر
   جهاز في NODE-3، ولا مخزون أصلًا.
8. التحقق كامل **قبل** أي كتابة: أول خطأ يُنهي العملية بلا أي أثر جزئي.

---

## 4) التزامن والذرّية

- كل مراجعة تبدأ داخل معاملة بـ`SELECT … FOR UPDATE` على صف المستفيد،
  فمراجعتان متزامنتان تتسلسلان: واحدة تفوز، والأخرى ترى الحالة المبتوتة
  وتُرفض بـ409 نظيف. (اختبار حقيقي بـ`Promise.all` على HTTP.)
- `IdempotencyService` القائم (لا آلية جديدة) — نطاقات NODE-3:

  | scope | المفتاح | المصدر القديم |
  |---|---|---|
  | `beneficiary-create` | `opId` | `createBeneficiaryWithNeeds` |
  | `beneficiary-update:<id>` | `opId` | `updateBeneficiaryWithNeeds:<id>` |
  | `beneficiary-need-remove:<needId>` | `opId` | `removePendingBeneficiaryNeed:<needId>` |
  | `beneficiary-review:<id>` | `opId` | `reviewBeneficiaryNeeds:<id>` |

  نفس `opId` بنفس الحمولة ⇒ إعادة النتيجة المخزَّنة بلا تنفيذ ثانٍ؛ بحمولة
  مختلفة ⇒ 409 تعارض.

  **ملاحظة parity مهمة**: المراجعة بالجملة **لا** تملك نطاقًا خاصًا بها —
  كل عنصر يستخدم نفس نطاق المراجعة الفردية `beneficiary-review:<id>`
  بـ`opId` الخاص به، مطابقةً حرفية لِ`bulkReviewBeneficiaries` القديمة
  التي تستدعي `runLockedIdempotent_('reviewBeneficiaryNeeds:' + id, …)`
  لكل عنصر. فإعادة إرسال نفس الدفعة لا تنفّذ أي قرار مرتين.

- **الدفعة ليست معاملة واحدة**: كل عنصر معاملته الذرّية المستقلة. قاعدة
  "كل شيء أو لا شيء" محصورة **داخل** العنصر الواحد، لا عبر الدفعة — فشل
  عنصر لا يُرجِع عنصرًا نجح قبله ولا يوقف من بعده. الرد يحمل
  `success[]`/`failed[]` بدقة.
- `audit` يُكتب **بعد** الالتزام الناجح فقط، وفشله لا يُسقط العملية
  (نمط NODE-1.1/NODE-2 بلا تغيير).

---

## 5) بذرة التخصيص التلقائي (AutoAllocation) — NO-OP فقط

**NODE-3 لا ينقل `AutoAllocation.gs` إطلاقًا** (نطاق NODE-5).

ما نُقِل هو **توقيت** النداء وتجميعه فقط، عبر:
- `apps/api/src/modules/allocation/allocation-trigger.port.ts` — واجهة
  `AllocationTriggerPort` + رمز الحقن `ALLOCATION_TRIGGER_PORT`.
- `noop-allocation-trigger.service.ts` — تنفيذ لا يفعل شيئًا سوى سطر
  تشخيصي على مستوى debug.

قواعد الاستدعاء (مطابقة لِ`Patch 3.2A.1` حرفيًا):
- **المراجعة الفردية**: نداء واحد فور نجاح اعتماد أنتج ≥1 استحقاق معتمد.
  لا نداء عند الرفض، ولا عند إعادة تشغيل idempotent (لا قرار جديد وقع).
- **المراجعة بالجملة**: تُجمَع `associationId` لكل عنصر **نجح** وكان قراره
  اعتمادًا بـ≥1 احتياج معتمد، ثم يُنفَّذ نداء واحد فقط **لكل جمعية فريدة**
  بعد انتهاء الدفعة كاملة — لا نداء لكل مستفيد. (خمسة مستفيدين من جمعية
  واحدة ⇒ نداء واحد؛ جمعيتان ⇒ نداءان.)
- النداء يقع **بعد** التزام المعاملة دائمًا، وأي فشل منه لا يُسقط قرارًا
  نجح فعليًا — يُسجَّل تحذيرًا ويظهر في `allocationWarnings` الاختياري بلا
  تحويل أي عنصر ناجح إلى فاشل.

الاختبارات تتحقق من ذلك عبر تنفيذ تجسّس (spy) يُحقن بدل NO-OP فتُقاس
**عدد النداءات ومعرّفات الجمعيات** — بلا تشغيل أي مُخصِّص حقيقي (لا وجود
لأي مُخصِّص أصلًا).

---

## 6) الأداء وشكل الاستعلامات

- **لا N+1**: عدّادات احتياجات الصفحة تُجلب عبر `groupBy` **واحد**
  (`beneficiaryId, decisionStatus`) لكل الصفحة مجتمعة، بنفس مبدأ
  `attachNeedsSummaryToBeneficiaries_` القديمة ونمط `countsByAssociation`
  في NODE-2. عدد الاستعلامات ثابت (findMany + count + groupBy) مهما بلغ
  حجم الصفحة.
- **الترقيم** يعيد استخدام `PaginationQueryDto`/`normalizePagination`
  بحدودها كما هي (`MAX_PAGE_SIZE=100`, `MAX_PAGE=100_000` من NODE-2.2).
- **الترتيب حتمي**: كل ترتيب يحمل كاسر تعادل على `id` — بدونه قد يتكرر
  سجل أو يختفي عبر حدود الصفحات عند تساوي مفتاح الترتيب.
- **الفهارس المستخدَمة** (كلها قائمة من NODE-0.1، لم يُضَف فهرس تخميني):
  - `beneficiaries(association_id, review_status)` — يخدم العزل + تصفية
    الحالة، وهما شرطا كل استعلام قائمة تقريبًا.
  - `beneficiaries(phone)` — يخدم فحص تكرار الجوال والبحث برقم كامل.
  - `beneficiary_needs(beneficiary_id)` — يخدم `groupBy` وجلب التفاصيل.
  - `beneficiary_needs(association_id, decision_status, fulfillment_status)`.
  - `UNIQUE(beneficiary_id, device_type)` — انظر §7.

---

## 7) قيد "لا احتياج مكرَّر" — قيد كامل لا فهرس جزئي

القيد `UNIQUE(beneficiary_id, device_type)` **كامل** عمدًا (لا مشروط
بحالة القرار). التحقق المصدري: في `BeneficiaryNeeds.gs` تُبنى خريطة
`existingByType` من **كل** صفوف احتياج المستفيد بلا أي تصفية على "حالة
القرار" (`setBeneficiaryNeeds_`، `updateBeneficiaryWithNeeds_`) — أي أن
احتياجًا **مرفوضًا** من نوع ما يمنع إعادة تسجيل نفس النوع تمامًا كالمعلَّق
والمعتمد.

لذلك **لم** يُستخدم فهرس جزئي على `PENDING/APPROVED` فقط: كان سيسمح
بإعادة تقديم نوع سبق رفضه، وهو سلوك **لا وجود له** في النظام القديم.
(الخدمة تفحص أولًا برسالة واضحة، والقيد خط الدفاع الأخير ضد السباق —
نفس نمط NODE-2.)

## 8) القيم التاريخية لنوع الجهاز

لا وجود لقيمة تاريخية خارج الأنواع الثلاثة على `beneficiary_needs`: العمود
`device_type` هو enum `DeviceType` الموحَّد (NODE-0.1)، وقيد النظام القديم
نفسه كان محصورًا في `NEW_NEED_DEVICE_TYPES` الثلاثة عند تسجيل أي احتياج.
النطاق الأوسع تاريخيًا يخصّ `device_units`/`receipt_items` وحدهما، ولهما
أصلًا حقل أرشيف نصي منفصل `legacyDeviceTypeText` — لا علاقة له بالاحتياجات.

---

## 9) أكواد الأخطاء

| الكود | HTTP | المعنى |
|---|---|---|
| `BENEFICIARY_NOT_FOUND` | 404 | غير موجود، أو خارج نطاق جمعية الفاعل |
| `BENEFICIARY_ALREADY_REVIEWED` | 409 | سبق البتّ نهائيًا |
| `BENEFICIARY_NEEDS_LOCKED` | 409 | تعديل احتياجات بعد القرار النهائي |
| `BENEFICIARY_NO_PENDING_NEEDS` | 409 | لا احتياج معلَّق للمراجعة |
| `BENEFICIARY_NEED_NOT_FOUND` | 404 | الاحتياج غير موجود لهذا المستفيد |
| `BENEFICIARY_NEED_ALREADY_DECIDED` | 409 | إعادة تقرير/حذف احتياج محسوم |
| `BENEFICIARY_NEED_DUPLICATE_DECISION` | 400 | نفس الاحتياج مرتين في طلب واحد |
| `BENEFICIARY_NEED_DECISION_MISSING` | 400 | اعتماد بلا بتّ في كل معلَّق |
| `BENEFICIARY_ALL_NEEDS_REJECTED` | 400 | اعتماد بلا احتياج معتمد واحد |
| `BENEFICIARY_REJECTION_REASON_REQUIRED` | 400 | رفض بلا سبب |
| `BENEFICIARY_REQUIRES_NEED` | 400 | لا مستفيد بلا احتياج |
| `BENEFICIARY_INVALID_DEVICE_TYPE` | 400 | نوع خارج الثلاثة المعتمدة |
| `BENEFICIARY_DUPLICATE_PHONE` | 409 | جوال مكرَّر داخل نفس الجمعية |
| `BENEFICIARY_ASSOCIATION_IMMUTABLE` | 400 | محاولة نقل بين الجمعيات |
| `BENEFICIARY_ASSOCIATION_REQUIRED` | 400 | ADMIN بلا تحديد جمعية عند الإنشاء |
| `BENEFICIARY_VALUE_OUT_OF_RANGE` | 400 | عدد أفراد/دخل خارج المدى |
| `BENEFICIARY_INVALID_REFERENCE` | 400 | حالة اجتماعية غير معتمدة |
| `BENEFICIARY_BULK_EMPTY` | 400 | دفعة بلا عناصر |

لا تُعاد أي رسالة Prisma/Postgres خام إطلاقًا — بما في ذلك داخل
`failed[]` في الدفعة: الرسالة تُؤخذ من `ApiError` المعروف وحده، وأي خطأ
غير متوقَّع يُستبدَل برسالة عامة ويُسجَّل داخليًا فقط.

---

## 10) واجهات المستخدم

- `/admin/beneficiaries` — **جدول** (لا بطاقات) مطابقةً لِ
  `Index.html::renderBeneficiaries` التي تستخدم `beneficiariesTable`
  لدور ADMIN حصرًا (Phase 3.2A)، مع نافذة مراجعة فردية بقرار لكل احتياج،
  وشريط مراجعة بالجملة يعرض **كل** عنصر فاشل صراحة (لا يُخفيه نجاح غيره).
- `/association/beneficiaries` — **بطاقات** (كما في القديم للجمعية) مع
  نموذج إنشاء/تعديل، مقيَّدة بجمعية الجلسة، وتُخفي تعديل الاحتياجات بعد
  القرار النهائي.

الترقيم والبحث والتصفية والترتيب كلها خادمية بالكامل — لا تحميل شامل ثم
تصفية في المتصفح.

---

## 11) خارج نطاق NODE-3 صراحة

- الاستيراد الجماعي من Excel/CSV (`inspectBeneficiaryExcel`/
  `importBeneficiaries`/`downloadBeneficiaryImportTemplateXlsx`).
- `assignDelegate` و`updateBeneficiaryLocation`.
- مخزون الأجهزة ووحداتها والعهدة والتسليم (NODE-4).
- محرّك التخصيص التلقائي الفعلي (NODE-5).
