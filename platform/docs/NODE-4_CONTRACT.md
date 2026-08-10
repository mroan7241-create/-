# NODE-4 — عقد التنفيذ: محاضر الاستلام + الملفات + مخزون الأجهزة

Baseline: `cdc19ce89ac7ce5f24723cd05a93c3a55d6ba7b2` (بعد NODE-3.3)، ورقعة تصليب NODE-4.1 فوق `371763804d0d498364d1bca12488bac58078c9f1`. مرجع legacy: `ReceiptBatches.gs` (Phase 3.1/3.1.1) على `daa5e6d5d98b3b724bd867ce1d9117ded14db3f9`.

## النطاق المُنفَّذ

- **دورة محضر الاستلام**: `DRAFT → AWAITING_ASSOCIATION_CONFIRMATION → {RECEIVED_COMPLETE | RECEIVED_WITH_DISCREPANCIES}` — انتقالات صارمة، لا رجوع.
- **الإنشاء** (ADMIN): جمعية+مورد+تاريخ إرسال+أصناف (نوع/مواصفة/كمية مُرسَلة)، عملية ذرّية، idempotent عبر opId.
- **الإرسال** (ADMIN): مسودة → بانتظار تأكيد فقط، مع إعادة تحقق نشاط الجمعية داخل القفل.
- **التأكيد** (ASSOCIATION، لجمعيتها حصرًا): بند غائب = استلام كامل (Legacy semantics)، معادلة الكميات (سليم+تالف+ناقص=مُرسَل) إلزامية لكل بند، سبب الفرق (مرجعي) إلزامي عند وجود فرق فعلي فقط، صورة كمية + توقيع مستلم إلزاميان (JPEG/PNG/WEBP فعليًا عبر magic bytes، 6 MiB)، اسم المستلم من حساب الجلسة نفسه (غير قابل للانتحال)، صفة المستلم مرجعية.
- **صور التلف**: 0 تالف=0 صور، 1 تالف=صورة واحدة بالضبط، >1 تالف=صورة واحدة على الأقل؛ كل صورة مرتبطة ببند/بنود تحمل تلفًا فعليًا فقط، `ReceiptDamagePhoto` هي SOT العلائقي.
- **المخزون**: بعد تأكيد ناجح فقط، وحدة `DeviceUnit` واحدة لكل وحدة من `goodQty` بالضبط (تالف/ناقص = صفر وحدات)، كود `DEV` ذرّي، `status=WAREHOUSE`.
- **بذرة التخصيص**: `AllocationTriggerPort.triggerForAssociation` تُستدعى مرة واحدة بعد commit ناجح أنتج ≥1 وحدة سليمة — تبقى NO-OP حتى NODE-5.
- **الملفات**: خاصة بالكامل، رفع خارج معاملة DB، تنظيف تعويضي best-effort عند أي فشل لاحق (بما فيه تعارض idempotency)، وصول فقط عبر رابط موقَّع محروس مع تدقيق عند كل عرض.
- **مخزون القراءة**: `GET /inventory/devices` + `GET /inventory/devices/:id` — **تكافؤ القراءة الأساسية فقط** (رمز/نوع/مواصفة/حالة/محضر الاستلام المصدر) من `getDeviceDetail`/جزء القراءة من `saveDevice` القديمتين، بلا N+1، بلا Bootstrap. الإثراء الكامل لدورة حياة الجهاز — سجل الحركات، التخصيص الحالي/التاريخي، حالة العهدة لدى مندوب — **معلَّق صراحةً** لاعتماده على بيانات NODE-5 (`DeviceAllocation` الفعلي) وNODE-6 (عهدة/تسليم)؛ لا نسخة وهمية منه هنا. راجع "تصحيح نطاق saveDevice/getDeviceDetail" أدناه.
- **NODE-4.1 — تصليب ما بعد الإطلاق**: (أ) بصمة idempotency للتأكيد أصبحت تنظّف best-effort أي كائنات رفعتها محاولة *replay* نفسها فور اكتشاف أنها إعادة تشغيل، لا فقط عند فشل حقيقي؛ (ب) شكل multipart (`items`/`damagePhotoLinks`) يُتحقَّق زمن تشغيل حقيقيًا (مصفوفة/UUID) قبل أي منطق أعمال، و`damagePhotoId` عبر DTO مُتحقَّق؛ (ج) MIME المُعلَن، إن وُجد، يجب أن يكون هو نفسه أحد الأنواع الثلاثة **و** مطابقًا لما اكتُشف من البايتات — لا قبول صامت لِMIME خارج القائمة؛ (د) `validateDeviceSpec` تتحقق الآن من كون المواصفة تتبع نوع الجهاز المُختار فعليًا عبر `reference_values.parentId` (تطابق `validateDeviceSpec_(deviceType,...)` القديمة حرفيًا)؛ (هـ) `PublicCodeService.nextPublicCodes(tx, prefix, count)` تحجز نطاقًا ذرّيًا واحدًا بدل استعلام منفصل لكل سجل، مُستخدَمة في إنشاء `ReceiptItem`/`DeviceUnit`/`ReceiptDamagePhoto` دفعة واحدة (`createMany`)؛ (و) قائمة `GET /receipts` أصبحت خفيفة (`itemCount` فقط، بلا بنود/صور تلف)، والتفاصيل الكاملة حصرًا عبر `GET /receipts/:id` عند الطلب؛ (ز) اختيار الجمعية في الواجهة يستخدم بحثًا خادميًا حقيقيًا (`AssociationSelect`) بدل `pageSize=200` (فوق سقف الخادم 100 أصلًا).

## NODE-4.2 — إغلاق محضر الاستلام (رقم مستند + إثباتات إضافية + دعم صور تلف متعددة حقيقي)

باسلاين: `9871558f230299687ecfe2322221b9f3b78e719b` (بعد NODE-4.1). رقعة إغلاق فقط — لا NODE-5/6، لا procurement/RFQ/PO.

- **رقم المستند** (`documentNumber`): نص حر اختياري على `ReceiptBatch`، يُدخَل عند الإنشاء فقط، يُعرَض في تفاصيل المحضر (ADMIN وASSOCIATION). لا معنى مرجعيًا له خارج العرض — ليس مفتاح نظام مشتريات.
- **إثبات شراء إداري** (`adminProofFileId`, `FileCategory.RECEIPT_ADMIN_PROOF`): ملف اختياري يُرفَق عند إنشاء المحضر (PDF أو JPEG/PNG/WEBP، 8 MiB). `POST /receipts` أصبح multipart-capable لدعم الملف مع بقاء التوافق الخلفي الكامل — يقبل أيضًا `Content-Type: application/json` بلا أي ملف تمامًا كما كان في NODE-4/4.1 (multer لا يتدخل إطلاقًا في طلبات غير multipart). عند multipart تصل `items` كنص JSON (نفس نمط `damagePhotoLinks` في التأكيد)، وعند JSON تصل كمصفوفة حقيقية — التحقق الشكلي في `parseCreateItems` (`confirm-multipart.util.ts`)، والتحقق الحقيقي (enum/مواصفة/موجب صحيح) داخل `ReceiptsService.createBatch` كما كان.
- **محضر/ختم الجمعية** (`associationReportFileId`, `FileCategory.RECEIPT_ASSOCIATION_REPORT`): ملف اختياري **افتراضيًا** يُرفَق عند التأكيد (PDF أو JPEG/PNG/WEBP، 8 MiB) عبر حقل multipart جديد `associationReportFile` على `POST /receipts/:id/confirm`. إلزامه يُضبَط حصرًا عبر `system_settings` — المفتاح `receipt.associationReportRequired` (`RECEIPT_ASSOCIATION_REPORT_REQUIRED_KEY` في `receipts.service.ts`): غياب الصف = اختياري، وفقط قيمة `true` boolean **صارمة** (لا `"true"` نصية ولا `1`) تجعله إلزاميًا. عند الإلزام بلا ملف: `400 RECEIPT_ASSOCIATION_REPORT_REQUIRED` نظيف قبل أي رفع. لا UI عام لإدارة `system_settings` في هذه الرقعة — الضبط مباشرة في الجدول.
- **مُدقِّق مستندات مخصَّص** (`validateReceiptDocumentFile` في `file-validation.util.ts`): صورة (JPEG/PNG/WEBP بـmagic bytes) **أو** PDF (`%PDF-` بـmagic bytes)، 8 MiB، MIME المُعلَن (إن وُجد) يجب أن يطابق المكتشَف فعليًا تمامًا — نفس صرامة `validateReceiptEvidenceFile` الحالية (JPEG/PNG/WEBP فقط، 6 MiB) التي تبقى **بلا تغيير** لصورة الكمية/التوقيع/التلف. لا صيغ تنفيذية/مكتبية/مضغوطة في أيٍّ من المدقِّقَين.
- **idempotency**: بصمة الإنشاء (`receipt-batch-create`) تضم الآن `documentNumber` و`sha256` إثبات الشراء (إن وُجد) — بلا مفتاح كائن مولَّد أو timestamp. بصمة التأكيد (`receipt-batch-confirm`) تضم بالمثل `sha256` محضر/ختم الجمعية (إن وُجد، وإلا `null`) — فيُعتبَر تغيير محتوى الملف بين محاولتين بنفس `opId` تعارض idempotency حقيقيًا (`409 APPLICATION_IDEMPOTENCY_CONFLICT`) بنفس آلية بقية الحقول. الرفع يبقى خارج معاملة DB مع تنظيف تعويضي best-effort (فشل حقيقي أو كائن محاولة replay مكرَّرة) — نفس نمط NODE-4/4.1 حرفيًا، الآن يشمل ملفَي الإثبات الإداري ومحضر الجمعية أيضًا.
- **صور التلف — دعم حقيقي متعدد (لا Shortcut)**: الخادم كان يدعم فعليًا `damagePhotoLinks` كمصفوفة مصفوفات (صورة → بند/بنود) منذ NODE-4/4.1 بلا تعديل هنا. الفجوة كانت في واجهة `association/receipts` فقط: كانت تربط "كل الأصناف التالفة بأول صورة" (shortcut) وتقبل ملفًا واحدًا فعليًا. الآن: إدخال ملفات متعدد (`multiple`)، كل صورة مُختارة تُعرَض باسمها مع صناديق اختيار للبنود التالفة الحالية فقط، وإزالة أي صورة قبل الإرسال. تحقق العميل قبل الإرسال يطابق قواعد الخادم حرفيًا: كل صورة مرتبطة ببند تالف واحد على الأقل، كل بند تالف مُغطًّى بصورة واحدة على الأقل، `totalDamaged=1` ⇒ صورة واحدة بالضبط، `totalDamaged>1` ⇒ صورة واحدة على الأقل، `totalDamaged=0` ⇒ صفر صور. الإرسال بنفس ترتيب `damagePhotos`/`damagePhotoLinks`.
- **تفاصيل الاستلام النهائي (ASSOCIATION)**: `GET /receipts/:id` (نفس endpoint السابق) كان يعيد أصلًا كل البنود+الكميات+صور التلف+`differenceNotes` منذ NODE-4، لكن واجهة `association/receipts` لم تكن تعرض شيئًا من ذلك بعد التأكيد (فقط المستلم/التاريخ + زرَّي كمية/توقيع). أُضيف جدول بنود كامل (نوع/مواصفة/مُرسَل/سليم/تالف/ناقص/سبب الفرق/ملاحظات الفرق/صور التلف لكل بند) + زر محضر/ختم الجمعية عند وجوده — روابط موقَّعة عند الضغط فقط، لا تحميل مسبق، بنفس نمط بقية الإثباتات.
- **تفاصيل ADMIN**: `documentNumber`، `ملاحظات الفرق` لكل بند، وزرّا "إثبات الشراء الإداري"/"محضر-ختم الجمعية" (عند وجودهما) أُضيفت للوحة تفاصيل `admin/receipts` — بقية الإثباتات كما كانت (عند الطلب فقط).
- **رابط موقَّع للإثباتات الجديدة**: `GET /receipts/:id/evidence/:evidenceType` يقبل الآن `adminProof`/`report` إضافةً لـ`quantity`/`signature`/`damage` — بنفس عزل tenant وaudit (`RECEIPT_EVIDENCE_VIEWED`) الحاليَين حرفيًا.
- **migration**: append-only واحدة (`20260810120000_node4_2_receipt_document_and_evidence`) — عمودان جديدان اختياريان (`document_number`, لا حاجة enum) + عمودا FK اختياريان (`admin_proof_file_id`, `association_report_file_id`) على `receipt_batches`، وقيمتا enum جديدتان على `FileCategory` (`RECEIPT_ADMIN_PROOF`, `RECEIPT_ASSOCIATION_REPORT`). لا تعديل على أي migration سابقة، ولا Procurement/RFQ/PO entities جديدة.

## استثناءات صريحة (خارج النطاق)

- لا AutoAllocation حقيقي (NODE-5).
- لا مندوبين/تسليم (NODE-6).
- لا DamageCase downstream workflow.
- لا procurement/RFQ/PO.
- لا استيراد Excel/CSV لمحاضر الاستلام.
- لا UI عام لإدارة `system_settings` (NODE-4.2) — الضبط اليدوي المباشر في الجدول فقط.

## انحرافات متعمَّدة عن Legacy

- **إزالة الفحص المبكر لحالة المحضر قبل معاملة التأكيد** (خارج نمط Legacy الذي كان يرفض فورًا): اكتُشف أثناء الاختبار أن الرفض المبكر قبل ادّعاء idempotency يكسر إعادة تشغيل (replay) مشروعة لنفس opId على محضر انتقل بالفعل لحالة نهائية بواسطة نفس opId — تصحيح ضروري لصحة idempotency، موثَّق في `receipts.service.ts`.

**NODE-4.1**: انحراف `validateDeviceSpec` (كانت لا تربط المواصفة بنوع الجهاز صراحة) أُصلح بالكامل — المواصفة الآن تتبع نوع الجهاز فعليًا عبر `reference_values.parentId`، مطابقًا لِ`validateDeviceSpec_(deviceType, value)` القديمة حرفيًا. لم يعد هذا انحرافًا.

## تصحيح نطاق saveDevice/getDeviceDetail (NODE-4.1)

قرار معماري صريح لهذه المنصة — **لا** يُنفَّذ writer `saveDevice` الكامل في NODE-4/NODE-4.1:

- NODE-4 يملك المخزون الفعلي الناتج عن محاضر الاستلام + قراءة المخزون الأساسية فقط.
- `DeviceAllocation` هي SOT الوحيد للتخصيص — لا مصدر حقيقة موازٍ.
- التخصيص التلقائي بالكامل ملك NODE-5.
- أي تعديل تخصيص يدوي معتمَد قبل تسليمه لمندوب هو جزء من قواعد تخصيص NODE-5، لا NODE-4.
- تغييرات حالة العهدة/المندوب/التسليم ملك NODE-6.
- لم تُضَف حقول اسم/ملاحظات وصفية على طراز الشيت القديم لمجرد نسخ نموذج `Devices` القديم — نموذج `DeviceUnit` الأدنى الحالي كما هو.

لذلك: `getDeviceDetail`/جزء القراءة من `saveDevice` **MIGRATED جزئيًا وبدقة** — تفاصيل المخزون الأساسية (رمز/نوع/مواصفة/حالة/محضر الاستلام المصدر) مُهاجَرة ومُختبَرة، بينما إثراء دورة الحياة الكاملة (حركات/تخصيص/عهدة) **معلَّق صراحةً** حتى NODE-5/NODE-6 — لا `PARITY_VERIFIED` ولا ادّعاء تكافؤ كامل قبل ذلك.
