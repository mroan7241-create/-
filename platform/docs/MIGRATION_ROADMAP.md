# MIGRATION_ROADMAP.md

**كل مرحلة أدناه توثيق تخطيطي فقط** — لا تنفيذ لأي منها إلا NODE-0 (هذا
المستند نفسه نتاج NODE-0). لا يبدأ NODE-1 تلقائيًا بعد اكتمال NODE-0.

## NODE-0 — Foundation + DB architecture (هذه المرحلة)

Audit + Feature Parity Matrix + تصميم قاعدة البيانات + platform
skeleton + initial migration + CI/tests foundation + التوثيق. **مكتمل**
— راجع تقرير الإغلاق المُرسَل للمستخدم.

## NODE-1 — Authentication + sessions + roles + reference data — **مكتمل**

نُقل `Auth.gs` فعليًا (`login`/`logout`/`changePassword`/`requestPasswordReset`/
`resetPasswordWithCode`/`resetAssociationPassword`) إلى `AuthModule` حقيقي:
تجزئة Argon2id، جلسات opaque server-side (SHA-256 hash فقط، لا JWT)،
rate limiting DB-backed، فرض الأدوار الثلاثة عبر `SessionAuthGuard`
عالمي، ونقل `ReferenceData.gs::getReferenceData` إلى `ReferenceDataModule`
فعلي مع توسيع `ReferenceValueType` لكل الـ10 أنواع القديمة. 54 اختبار
تكامل/أمان حقيقي أخضر، بما فيها إثبات أن `associationId` لا يمكن تزويره
من الطلب. راجع `AUTHENTICATION.md` للتفصيل الكامل و`FEATURE_PARITY.md`
للحالة النهائية. `getBootstrapData` القديم **لم يُنقَل عمدًا** — قرار
مؤجَّل، endpoints مستقلة بديلة بدل نمط bootstrap ضخم واحد. لا استيراد
لكلمات مرور Production، لا مزوّد بريد إنتاجي حقيقي، لا Deploy — كل ذلك
خارج نطاق هذه المرحلة صراحة.

## NODE-2 — Association applications + association management — **مكتمل**

`Applications.gs` كامل (`submitAssociationApplication`,
`getApplicationStatus`, `reviewAssociationApplication`,
`getApplicationLicenseFile`, `listApplications`) +
`saveAssociation`/`updateAssociationSettings`/`listAssociations` من
`DevicesAssociations.gs`. أول استخدام حقيقي لـ`FilesModule` (رفع ترخيص +
signed URL) ولـ`public_code_counters` و`idempotency_keys`.

**ما نُفِّذ فعليًا**:

- 6 endpoints للطلبات + 5 للجمعيات (راجع ASSOCIATION_APPLICATIONS.md §11
  وASSOCIATIONS.md §6).
- 5 شاشات: `/apply`, `/apply/status`, `/admin/applications`,
  `/admin/associations`, `/association/settings` — بهوية الزاد وRTL،
  ومُجرَّبة يدويًا في متصفح حقيقي على المسار الذهبي كاملًا
  (تقديم → متابعة → مراجعة → قبول/رفض).
- migration واحدة (`20260809072054_node2_association_applications`):
  `sector`، `category` nullable، `public_code_counters`، قيود فرادة،
  وأربعة فهارس فريدة **جزئية** تحلّ محلّ `LockService`.
- `StorageService` (S3-متوافق: s3rver محليًا، MinIO في CI) مع حذف
  تعويضي best-effort — لا كائن يتيم.
- 97 اختبار NODE-2 جديد (وحدة/تكامل/تزامن/أمان/تخزين) + 69 اختبار NODE-1
  بقيت خضراء بلا أي تعديل عليها = **166 اختبارًا خضراء**.
- `.github/workflows/platform-ci.yml`: PostgreSQL 18 + MinIO حقيقيان،
  من قاعدة بيانات فارغة إلى بناء الواجهة، بلا أي خطوة نشر.

**ما استُبعد عمدًا (خارج parity)**: أي حالة طلب غير الثلاث المعتمدة،
محرّك تقييم، بوابة أهلية، اتفاقيات، مشتريات/RFQ، قوائم رئيسية/احتياطية،
لوحة تحكم فعلية، أو أي شاشة مستفيدين — كلها غير موجودة في النظام القديم.

**الحالة**: `MIGRATED` لا `PARITY_VERIFIED` — التطابق مُثبَت على مستوى
الكود والاختبار الآلي، ولم تُجرَ مقارنة تشغيلية حيّة مع نظام Apps Script
(راجع FEATURE_PARITY.md).

## NODE-3 — Beneficiaries + beneficiary needs + bulk review

**مُنفَّذة.** كل ما يلي منقول ومُختبَر: `listBeneficiaries`،
`saveBeneficiary`/`saveBeneficiaryWithNeeds` (مسار إنشاء/تعديل ذرّي
موحَّد)، `setBeneficiaryNeeds` (مزامنة الاحتياجات ضمن مسار التعديل)،
`removePendingBeneficiaryNeed`، `reviewBeneficiaryNeeds`،
`bulkReviewBeneficiaries` — مع تجميع بذرة التخصيص لكل جمعية فريدة
(Patch 3.2A.1) محفوظًا حرفيًا. التفاصيل الكاملة في BENEFICIARIES.md.

**AutoAllocation لم يُنقَل** (نطاق NODE-5): نُقل **توقيت** النداء وتجميعه
فقط عبر بذرة `AllocationTriggerPort` بتنفيذ NO-OP، فيستطيع NODE-5 استبدال
التنفيذ وحده بلا لمس كود المراجعة.

الحالة `MIGRATED` لا `PARITY_VERIFIED`: التطابق مُثبَت على مستوى الكود
والاختبار الآلي (56 اختبار NODE-3 جديد، منها الأقسام 18–26 من
`tools/beneficiary-needs-test.js` مُترجَمة إلى اختبارات HTTP حقيقية)،
ولم تُجرَ مقارنة تشغيلية حيّة مع Apps Script.

خارج النطاق عمدًا في NODE-3: الاستيراد الجماعي من Excel/CSV،
و`assignDelegate`/`updateBeneficiaryLocation`.

### NODE-3.1 — رقعة سدّ فجوات ما بعد NODE-3

بلا أي migration جديدة وبلا أي تبعية جديدة. تغطّي: `address`/`landmark`
كحقول قراءة تاريخية فقط (انحراف مقصود بقرار المستخدم)؛ إعادة دعم
`lat`/`lng`/`locationSource` بالأعمدة الموجودة أصلًا منذ NODE-0 مع مُصفّي
«بانتظار تحديد الموقع»؛ تنبيه «مطابق محتمل» غير الحاجب؛ وجعل رفض تكرار
الجوال آمنًا ضد السباق عبر أقفال Postgres الاستشارية. التفاصيل الكاملة في
BENEFICIARIES.md §12-§17.

مؤجَّل من هذه الرقعة: اختيار مزوّد خرائط لعرض الموقع بصريًا (النظام القديم
استخدم Leaflet + OpenStreetMap؛ القرار متروك للمستخدم ولم يُتَّخذ)،
ومُصفّي «جاهز للإحالة» لاعتماده على بيانات تخصيص/تسليم تصل مع NODE-4/6.

السياق الأصلي لهذه المرحلة:

الأهم لهذا المستند لأنه أحدث Phase مكتملة في النظام القديم
(Phase 3.2A + Patch 3.2A.1): `saveBeneficiary`، `reviewBeneficiaryNeeds`
بكل قواعده (راجع STATE_MAPPING.md §4)، و`bulkReviewBeneficiaries` بنفس
منطق تجميع AutoAllocation لكل جمعية بدل تشغيله لكل مستفيد على حدة —
**يجب اختبار التوازي (parity test) صراحة مقابل نتائج الاختبارات
القديمة في `tools/beneficiary-needs-test.js`** (الأقسام 18-26 خصوصًا)
قبل وسم `PARITY_VERIFIED`.

## NODE-4 — Receipt batches + files + device inventory ✅ منجزة

`ReceiptBatches.gs` كاملًا (إنشاء/إرسال/تأكيد محضر، معادلة الكميات،
الفروقات، صور التلف بقواعد العدد/الربط الحرفية)، إنشاء `device_units`
من `good_qty` داخل نفس معاملة التأكيد بعد `SELECT...FOR UPDATE`،
ونقل جزء **القراءة** من `saveDevice`/`getDeviceDetail`
(`DevicesAssociations.gs`) عبر `InventoryModule` — الكتابة اليدوية
(ربط/فكّ ربط/اكتمال جماعي) تبقى NOT_STARTED (نطاق لاحق مرتبط
بـNODE-5/6). بذرة `AllocationTriggerPort` (NODE-3) تُستدعى بعد تأكيد
ناجح أنتج ≥1 وحدة سليمة، NO-OP حتى NODE-5. راجع `NODE-4_CONTRACT.md`
للتفاصيل الكاملة والانحرافات المتعمَّدة عن Legacy. الأنموذج (schema)
كان جاهزًا بالكامل منذ NODE-0/NODE-0.1 — لا migration جديدة.

### NODE-4.1 — رقعة تصليب ما بعد الإطلاق ✅ منجزة

تصليب أمني/أداء بلا توسيع نطاق: تنظيف كائنات replay اليتيمة، تحقق
زمن تشغيل صارم لشكل multipart، MIME صارم (المُعلَن يجب أن يطابق
المكتشَف فعليًا)، ربط المواصفة بنوع الجهاز فعليًا (`validateDeviceSpec_`
حرفيًا)، بحث خادمي حقيقي لاختيار الجمعية في الواجهة (لا `pageSize=200`)،
ترقيم/خفة حقيقيان لقائمة المحاضر (تفاصيل كاملة عند الطلب فقط)، ونطاق
أكواد عامة ذرّي (`nextPublicCodes`) بدل استعلام منفصل لكل سجل عند
إنشاء بنود/أجهزة/روابط صور تلف بالجملة. لا migration جديدة، لا
dependency جديدة. راجع `NODE-4_CONTRACT.md`.

## NODE-5 — AutoAllocation parity migration

نقل خوارزمية `AutoAllocation.gs` **دون أي تغيير في القواعد المعتمدة**
(راجع ARCHITECTURE.md §4). يتطلب اختبار تعظيم عالمي مطابق لاختبار
`phase31-test.js`/`phase31.2-test` القديم (تعظيم عدد المستفيدين
المكتملين globally، لا لكل جمعية). إضافة قفل تزامن لكل جمعية
(`pg_advisory_xact_lock`).

## NODE-6 — Delegates + assignments + delivery attempts

`saveDelegate`/`setDelegateStatus`/`regenerateDelegateCode`،
`assignDelegate` (مرحلة "التعيين" فقط — راجع STATE_MAPPING.md §9)،
`confirmDelivery`/`retryDelivery`/`updateDeliveryStatus`،
`listBeneficiaryDeliveryAttempts`/`getDeliveryProofImage`.

## NODE-7 — Activities + dashboard + audit

`getActivitiesBundle`/`saveActivity`، `listDelegateAuditLog`،
`getPortalBundle` (يُعاد تصميمه كمجموعة endpoints تجميعية بدل bundle
ضخم واحد — قرار نهائي عند التنفيذ، راجع NEEDS_DECISION أدناه).

## NODE-8 — Legacy data importer + reconciliation

تنفيذ فعلي لتصميم `LEGACY_DATA_MIGRATION.md` — أول اتصال (staging
فقط، ليس Production مباشرة) ببيانات حقيقية مُصدَّرة، تحت إشراف كامل
ومراجعة يدوية لكل تقرير dry-run.

## NODE-9 — Full parity testing + UAT staging

اختبار توازي شامل (parity testing) لكل الـ32 endpoint في
FEATURE_PARITY.md — كل سطر يجب أن يصل `PARITY_VERIFIED` قبل الانتقال
لـNODE-10. بيئة UAT staging منفصلة تمامًا عن Production القديمة
والجديدة.

## NODE-10 — Cutover planning

خطة تبديل فعلية (لا تنفيذ في هذا المستند) — **لا يُحذَف Apps Script
حتى بعد نجاح NODE-9 واعتماد Cutover صراحة** من صاحب القرار البشري.

---

## NEEDS_DECISION — قرارات معلَّقة تحتاج توجيهًا بشريًا صريحًا

هذه ليست عيوبًا في NODE-0 — هي قرارات لم يطلبها نطاق NODE-0 صراحة
ولا يصح افتراض إجابة لها من تلقاء نفسي:

1. **نمط `getBootstrapData` الضخم**: **مؤجَّل صراحة في NODE-1** (لم
   يُحسم نهائيًا بعد) — endpoints المصادقة و`GET /reference-values`
   بقيت مستقلة تمامًا بلا أي bootstrap ضخم واحد، لكن هذا لا يمثّل بعد
   قرارًا نهائيًا لبقية النطاقات (مستفيدون/أجهزة/محاضر...)، يُحسم عند
   الحاجة الفعلية في NODE اللاحقة.
2. **آلية المصادقة الفعلية**: **محسوم في NODE-1** — جلسة opaque
   server-side كاملة (لا JWT)، `auth_sessions.token_hash = SHA-256(raw
   token)`، الرمز الخام لا يُخزَّن أبدًا. راجع `AUTHENTICATION.md` §3
   للتفصيل الكامل.
3. **استراتيجية cleanup لملفات `staging/` غير المكتملة** (ARCHITECTURE.md
   §3): مهمة دورية (cron) أم تنظيف عند الطلب (lazy، عند أول قراءة
   لاحقة)؟ لم يُحسم في NODE-0.
4. **نقل ملفات Google Drive الفعلية** (لا metadata فقط) في NODE-8:
   يحتاج قرار أداة/استراتيجية دفعات منفصلة (لم يُصمَّم بعد — خارج نطاق
   NODE-0 صراحة).
5. **الجدول الزمني/المسؤول عن قرار Cutover** (NODE-10) — قرار بشري بحت،
   خارج نطاق أي مرحلة تقنية.

6. **مزوّد تخزين الكائنات في Production** (NODE-2): العقد
   (`StorageService`) محايد وS3-متوافق، وMinIO مستخدَم محليًا/في CI فقط.
   اختيار المزوّد الفعلي وسياسة الاحتفاظ/النسخ الاحتياطي لملفات التراخيص
   قرار تشغيلي لم يُطلب في NODE-2 ولم يُتَّخذ (ولم تُستخدم أي مفاتيح أو
   بيانات حقيقية في أي مرحلة).
7. **مدة الاحتفاظ بملفات تراخيص الطلبات المرفوضة**: القديم لا يحذفها.
   NODE-2 حافظ على ذلك حرفيًا (لا حذف تلقائي). هل يُضاف تنظيف دوري بعد
   مدة محدَّدة؟ قرار سياسة بيانات، لا قرار تقني.
8. **دين أمان التبعيات (`npm audit`)**: العدد ارتفع من 24 إلى 28 بعد
   إضافة `@aws-sdk/client-s3` و`multer` و`s3rver`. لم يُشغَّل
   `npm audit fix --force` لا محليًا ولا في CI (يكسر إصدارات رئيسية بلا
   قرار بشري). المعالجة تحتاج قرارًا صريحًا بترقية/استبدال تبعيات.
