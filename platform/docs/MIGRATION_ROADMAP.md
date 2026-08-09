# MIGRATION_ROADMAP.md

**كل مرحلة أدناه توثيق تخطيطي فقط** — لا تنفيذ لأي منها إلا NODE-0 (هذا
المستند نفسه نتاج NODE-0). لا يبدأ NODE-1 تلقائيًا بعد اكتمال NODE-0.

## NODE-0 — Foundation + DB architecture (هذه المرحلة)

Audit + Feature Parity Matrix + تصميم قاعدة البيانات + platform
skeleton + initial migration + CI/tests foundation + التوثيق. **مكتمل**
— راجع تقرير الإغلاق المُرسَل للمستخدم.

## NODE-1 — Authentication + sessions + roles + reference data

نقل `Auth.gs` فعليًا (`login`/`logout`/`changePassword`/password reset
flows) إلى `AuthModule` حقيقي: تجزئة كلمات المرور (scrypt/argon2،
انتقال من hash القديم)، إصدار/إبطال `auth_sessions`، فرض الأدوار
الثلاثة (`ADMIN`/`ASSOCIATION`/`DELEGATE`) على مستوى الـService (guard
عام)، ونقل `ReferenceData.gs` (`getReferenceData`) إلى
`ReferenceDataModule` فعلي. تأسيس authorization/tenant isolation tests
حقيقية (association_id server-side دائمًا).

## NODE-2 — Association applications + association management

`Applications.gs` كامل (`submitAssociationApplication`,
`getApplicationStatus`, `reviewAssociationApplication`,
`getApplicationLicenseFile`) + `saveAssociation`/
`updateAssociationSettings` من `DevicesAssociations.gs`. أول استخدام
حقيقي لـ`FilesModule` (رفع ترخيص + signed URL).

## NODE-3 — Beneficiaries + beneficiary needs + bulk review

الأهم لهذا المستند لأنه أحدث Phase مكتملة في النظام القديم
(Phase 3.2A + Patch 3.2A.1): `saveBeneficiary`، `reviewBeneficiaryNeeds`
بكل قواعده (راجع STATE_MAPPING.md §4)، و`bulkReviewBeneficiaries` بنفس
منطق تجميع AutoAllocation لكل جمعية بدل تشغيله لكل مستفيد على حدة —
**يجب اختبار التوازي (parity test) صراحة مقابل نتائج الاختبارات
القديمة في `tools/beneficiary-needs-test.js`** (الأقسام 18-26 خصوصًا)
قبل وسم `PARITY_VERIFIED`.

## NODE-4 — Receipt batches + files + device inventory

`ReceiptBatches.gs` كاملًا (إنشاء/إرسال/تأكيد محضر، الفروقات، صور
التلف)، إنشاء `device_units` من `good_qty` داخل transaction، ونقل
منطق `saveDevice`/`getDeviceDetail` من `DevicesAssociations.gs`.

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

## NEEDS_DECISION — قرارات معلَّقة تحتاج توجيهًا بشريًا صريحًا قبل NODE-1

هذه ليست عيوبًا في NODE-0 — هي قرارات لم يطلبها نطاق NODE-0 صراحة
ولا يصح افتراض إجابة لها من تلقاء نفسي:

1. **نمط `getBootstrapData` الضخم**: هل يُستبدَل بـREST endpoints
   مستقلة لكل نطاق (الأقرب لمبادئ REST المطلوبة)، أم يبقى endpoint
   تجميعي واحد لتحميل أولي سريع (كما في النظام القديم لتقليل عدد
   استدعاءات `google.script.run`)؟ القرار الحالي في FEATURE_PARITY.md
   يفترض الأول (REST مستقل) لكنه غير محسوم.
2. **آلية المصادقة الفعلية (JWT مقابل جلسة server-side مخزَّنة)**:
   `auth_sessions.token_hash` مصمَّم بشكل يدعم كلا النمطين (تخزين هاش
   رمز الجلسة)، لكن القرار النهائي (JWT موقَّع + `auth_sessions` كقائمة
   إبطال فقط، أم جلسة كاملة مخزَّنة) يحتاج توجيهًا صريحًا في NODE-1.
3. **استراتيجية cleanup لملفات `staging/` غير المكتملة** (ARCHITECTURE.md
   §3): مهمة دورية (cron) أم تنظيف عند الطلب (lazy، عند أول قراءة
   لاحقة)؟ لم يُحسم في NODE-0.
4. **نقل ملفات Google Drive الفعلية** (لا metadata فقط) في NODE-8:
   يحتاج قرار أداة/استراتيجية دفعات منفصلة (لم يُصمَّم بعد — خارج نطاق
   NODE-0 صراحة).
5. **الجدول الزمني/المسؤول عن قرار Cutover** (NODE-10) — قرار بشري بحت،
   خارج نطاق أي مرحلة تقنية.
