# مصفوفة توازي الميزات (Feature Parity Matrix)

**القاعدة الحاكمة**: المرجع الوحيد للميزات المعتمدة هو النظام الفعلي في
commit `daa5e6d5d98b3b724bd867ce1d9117ded14db3f9` على الفرع
`claude/code-index-review-kz5k4u`. أي متطلب مستقبلي غير منفَّذ حاليًا
**ليس** ميزة معتمدة تلقائيًا (Procurement/RFQ، Main/Reserve، Basket،
Custody الجديد، Scoring lifecycle الجديد... كلها خارج النطاق الآن).

**مصدر القائمة**: كل الـ32 دالة العامة المستدعاة فعليًا من `Index.html`
عبر `api(...)` (أي `google.script.run[...].functionName`) — هذه هي
سطح الـPublic API الحقيقي الكامل للنظام القديم. تم استخراجها آليًا:

```
grep -oE "api\('[a-zA-Z_][a-zA-Z0-9_]*'" Index.html | sort -u
```

**حالات Parity Status**:
- `NOT_STARTED` — لم يبدأ نقلها بعد.
- `FOUNDATION_READY` — الوحدة/الجدول موجودان في NODE-0 لكن بلا منطق فعلي.
- `MIGRATED` — تم نقل المنطق للمنصة الجديدة (لم يحدث بعد).
- `PARITY_VERIFIED` — اختُبر بالتوازي مع النظام القديم وتحقّق التطابق (لم يحدث بعد).

في NODE-0: **كل الأسطر `FOUNDATION_READY` أو `NOT_STARTED` فقط** — لا
شيء `MIGRATED` أو `PARITY_VERIFIED` بعد، كما يقتضي النطاق ("لا تحاول
نقل كل Business Logic الآن").

**تحديث NODE-1**: دوال `Auth.gs` الست و`ReferenceData.gs::getReferenceData`
انتقلت إلى `MIGRATED` — تنفيذ حقيقي (سلوك مطابق للقديم، أُعيد قراءة
`Auth.gs`/`ReferenceData.gs`/`Validation.gs`/`ExecutionTracking.gs`/
`DevicesAssociations.gs` بالكامل قبل التنفيذ) + 54 اختبار تكامل/أمان
حقيقي أخضر (`apps/api/test/*.e2e-spec.ts`) يغطي كل مسار. لم تُستخدم
`PARITY_VERIFIED` لأن المقارنة لم تكن تشغيلًا فعليًا بالتوازي مع نظام
Apps Script الحي (تعذّر الوصول لبيئة Apps Script من هذه الجلسة) — إنما
قراءة الكود القديم سطرًا بسطر ومطابقة السلوك يدويًا واختبار كل حالة.
`getBootstrapData` **يبقى `NOT_STARTED` عمدًا** — قرار مؤجَّل، راجع
MIGRATION_ROADMAP.md.

**تحديث NODE-2**: دوال `Applications.gs` الأربع المستدعاة من الواجهة
(`submitAssociationApplication`, `getApplicationStatus`,
`getApplicationLicenseFile`, `reviewAssociationApplication`) ودالتا
القوائم الداخليتان (`listApplications`, `listAssociations`) ودالتا
`DevicesAssociations.gs` (`saveAssociation`, `updateAssociationSettings`)
انتقلت إلى `MIGRATED` — تنفيذ حقيقي بعد قراءة `Applications.gs`
و`DevicesAssociations.gs` و`Validation.gs` و`Normalize.gs` و`Pagination.gs`
سطرًا بسطر، مع 97 اختبار تكامل/أمان/تزامن جديد أخضر
(`apps/api/test/association-applications-*.e2e-spec.ts`,
`associations-management.e2e-spec.ts`, `storage-integration.e2e-spec.ts`)
إضافة إلى 69 اختبار NODE-1 بقيت خضراء بلا تعديل.

**تحديث NODE-3**: `Beneficiaries.gs::listBeneficiaries` و`saveBeneficiary`،
و`BeneficiaryNeeds.gs::saveBeneficiaryWithNeeds`/`setBeneficiaryNeeds`/
`removePendingBeneficiaryNeed`/`reviewBeneficiaryNeeds`/
`bulkReviewBeneficiaries` انتقلت إلى `MIGRATED` — تنفيذ حقيقي بعد قراءة
`Beneficiaries.gs` و`BeneficiaryNeeds.gs` و`StateRules.gs` و`Config.gs`
و`Validation.gs` و`Pagination.gs` وقسم المستفيدين في `Index.html` سطرًا
سطرًا، مع 56 اختبار تكامل/تزامن/عزل جديد أخضر
(`apps/api/test/beneficiaries-crud.e2e-spec.ts`،
`beneficiaries-review.e2e-spec.ts`) — منها الأقسام 18–26 من
`tools/beneficiary-needs-test.js` مُترجَمة إلى اختبارات HTTP حقيقية
(الدفعة، وتجميع AutoAllocation لكل جمعية). و230 اختبار من NODE-1/NODE-2
بقيت خضراء بلا إضعاف أي تأكيد.

**AutoAllocation لم يُنقَل في NODE-3** (نطاق NODE-5): نُقل توقيت النداء
وتجميعه فقط عبر بذرة `AllocationTriggerPort` بتنفيذ NO-OP — راجع
BENEFICIARIES.md §5.

**لم تُستخدم `PARITY_VERIFIED` عمدًا**: التطابق المُثبَت هنا هو تطابق
**على مستوى الكود** (قراءة المصدر القديم ومطابقة السلوك حالةً بحالة
واختبارها)، وليس تشغيلًا فعليًا بالتوازي مع نظام Apps Script الحي على
نفس المدخلات — تلك المقارنة التشغيلية لم تُجرَ، ولا يجوز ادّعاؤها.
`resetAssociationPassword` تبقى `MIGRATED` من NODE-1 (لم يُعَد تنفيذها
في NODE-2؛ شاشة إدارة الجمعيات الجديدة تستدعي نفس الـendpoint القائم).

الحالة `MIGRATED` في هذا الملف تعني إذن: **مُنفَّذ ومُختبَر آليًا، غير
مُقارَن تشغيليًا بالنظام الحي**.

---

| Legacy Module (.gs) | Legacy Public Function | Current UI (Index.html) | New API Module | New Endpoint (planned) | New UI Route (planned) | DB Entities | Parity Status | Notes |
|---|---|---|---|---|---|---|---|---|
| Auth.gs | `login` | شاشة الدخول | AuthModule | `POST /auth/login` | `/login` | accounts, auth_credentials, auth_sessions | MIGRATED | جلسات opaque (SHA-256 hash)، Argon2id، rate limit DB-backed 8/15m — راجع AUTHENTICATION.md |
| Auth.gs | `logout` | كل الشاشات (زر خروج) | AuthModule | `POST /auth/logout` | `/dashboard` | auth_sessions | MIGRATED | يُبطل الجلسة (`revoked_at`)، idempotent |
| Auth.gs | `changePassword` | الإعدادات | AuthModule | `PATCH /auth/password` | `/change-password` | auth_credentials, auth_sessions | MIGRATED | يحدّث secret_hash، ينقل القديم إلى previous_secret_hash، يُبطل كل الجلسات (بما فيها الحالية) |
| Auth.gs | `requestPasswordReset` | شاشة الدخول | AuthModule | `POST /auth/password-reset/request` | `/login/forgot-password` | password_reset_tokens | MIGRATED | رد عام موحَّد دائمًا؛ 5/15m rate limit لكل بريد |
| Auth.gs | `resetPasswordWithCode` | شاشة الدخول | AuthModule | `POST /auth/password-reset/confirm` | `/login/forgot-password` | password_reset_tokens, auth_credentials, auth_sessions | MIGRATED | TTL=15د، 6 محاولات كحد أقصى، استخدام واحد، 10/15m rate limit |
| Auth.gs | `resetAssociationPassword` | لوحة ADMIN | AuthModule | `POST /auth/associations/:id/reset-password` | `/admin/associations/:id` (لاحقًا) | auth_credentials, auth_sessions | MIGRATED | ADMIN only؛ كلمة مرور مؤقتة تُعاد مرة واحدة فقط، mustChangePassword=true |
| Bootstrap.gs | `getBootstrapData` | تحميل أولي لكل لوحات التحكم | AccountsModule (+ عبر modules متعددة) | `GET /bootstrap` | (root loader) | accounts, associations, reference_values, system_settings | NOT_STARTED | يُستبدل جزئيًا بـREST endpoints مستقلة لكل نطاق (لا نمط bootstrap ضخم واحد في الهيكل الجديد إلزاميًا — قرار تصميم لاحق، راجع MIGRATION_ROADMAP) |
| DevicesAssociations.gs | `saveAssociation` | إدارة الجمعيات (ADMIN) | AssociationsModule | `POST /associations` (إنشاء)، `PATCH /associations/:id` (تعديل) | `/admin/associations` | associations, accounts, auth_credentials, public_code_counters, idempotency_keys | MIGRATED | مقسَّمة إلى مسارين صريحين بدل `payload.id` الضمني؛ الإنشاء يبني Association+Account+AuthCredential في معاملة واحدة (idempotent عبر `opId`)؛ ACTIVE→INACTIVE يُبطل جلسات كل حسابات الجمعية **داخل نفس المعاملة** (NODE-2.1). تعديل ADMIN لبريد التواصل **لا** يُزامن بريد الدخول. NODE-2.1: الإنشاء يتحقق من region/city/category مقابل `reference_values` بنفس مُتحقِّقات طلب الانضمام، والتعديل يطبّق grandfathering مطابقًا لـ`isGrandfatheredValue_` (نفس القيمة المخزَّنة تُقبَل، وقيمة غير صالحة أخرى تُرفض)، و`:id` عبر `ParseUUIDPipe`، وبصمة HMAC لكلمة المرور في حمولة الـidempotency — راجع ASSOCIATIONS.md |
| DevicesAssociations.gs | `updateAssociationSettings` | إعدادات الجمعية | AssociationsModule | `PATCH /associations/me/settings` | `/association/settings` | associations, accounts | MIGRATED | جوال/بريد فقط؛ `associationId` من AuthContext حصرًا (لا يوجد حقل كهذا في الـDTO أصلًا، وValidationPipe يرفض أي حقل غير معرَّف)؛ يُزامن `accounts.email` كالقديم — راجع ASSOCIATIONS.md |
| DevicesAssociations.gs | `saveDevice` | إدارة الأجهزة | InventoryModule + AllocationModule | `GET /inventory/devices`, `GET /inventory/devices/:id` (قراءة فقط) | `/admin/inventory` | device_units, device_allocations, device_movements, beneficiary_needs | NOT_STARTED (قراءة فقط MIGRATED) | **NODE-4**: جزء القراءة فقط (قائمة+تفاصيل، ترقيم خادمي، لا N+1) مُهاجَر. الإنشاء حصرًا عبر تأكيد محضر استلام ناجح (`ReceiptsModule`) — لا `POST/PATCH` يدوي على `device_units` بعد. ربط جهاز/اكتمال جماعي/فكّ ربط (custody) يبقى NOT_STARTED — راجع STATE_MAPPING.md §7-8 |
| DevicesAssociations.gs | `assignDelegate` | تعيين مندوب لمستفيد | DelegatesModule + DeliveriesModule | `POST /delivery-missions/:id/assign` | `/association/deliveries` | delivery_missions, beneficiary_needs | NOT_STARTED | "التعيين" فقط، لا استلام فعلي — راجع STATE_MAPPING.md §9 |
| DevicesAssociations.gs | `saveDelegate` | إدارة المناديب | DelegatesModule | `POST/PATCH /delegates` | `/association/delegates` | accounts (role=DELEGATE), auth_credentials | NOT_STARTED | |
| DevicesAssociations.gs | `setDelegateStatus` | إدارة المناديب | DelegatesModule | `PATCH /delegates/:id/status` | `/association/delegates` | accounts | NOT_STARTED | |
| DevicesAssociations.gs | `regenerateDelegateCode` | إدارة المناديب | DelegatesModule | `POST /delegates/:id/regenerate-code` | `/association/delegates` | auth_credentials | NOT_STARTED | يُبطل رمز الدخول القديم — **يجب** استخدام `normalizeDelegateCode`/`computeCredentialLookupHash` من `@alzad/shared` (نفس helper الذي يستخدمه login الحالي وseed)، لا implementation منفصل. راجع AUTHENTICATION.md §2.1 |
| DevicesAssociations.gs | `getDeviceDetail` | تفاصيل الجهاز | InventoryModule | `GET /inventory/devices/:id` | `/admin/inventory` | device_units, device_movements, device_allocations | MIGRATED | **NODE-4**: تكافؤ قراءة (بلا سجل الحركات/التخصيص التاريخي بعد — تلك نطاق NODE-5/6)، عزل tenant لـASSOCIATION، `:id` عبر `ParseUUIDPipe` |
| Applications.gs | `submitAssociationApplication` | بوابة تقديم الجمعيات (عام) | ApplicationsModule | `POST /association-applications` | `/apply` | association_applications, application_answers, files, public_code_counters | MIGRATED | نفس ترتيب Legacy حرفيًا (honeypot → clientRequestId → تحقق رخيص → فحص تكرار → rate limit → ملف → معاملة)؛ NODE-2.1: `licenseExpiryDate` بتحقق تقويمي صارم يرفض التدحرج الصامت (`2026-02-31`/`2026-13-01`)؛ الفهارس الجزئية `ux_pending_application_*` تحلّ محلّ LockService؛ الملف يُرفع قبل المعاملة مع حذف تعويضي عند الفشل — راجع ASSOCIATION_APPLICATIONS.md |
| Applications.gs | `getApplicationStatus` | متابعة حالة الطلب (عام) | ApplicationsModule | `GET /association-applications/status/:clientRequestId` | `/apply/status` | association_applications | MIGRATED | عام بلا جلسة؛ لا أي PII في الرد (رمز/حالة/تاريخ/سبب رفض فقط)؛ 20 محاولة/ساعة لكل معرّف طلب |
| Applications.gs | `getApplicationLicenseFile` | مراجعة الطلب (ADMIN) | ApplicationsModule + FilesModule | `GET /association-applications/:id/license-file` | `/admin/applications` | files, audit_logs | MIGRATED | ADMIN فقط؛ `:id` عبر `ParseUUIDPipe` (NODE-2.1)؛ signed URL عمره 300 ثانية؛ مفتاح المسار هو معرّف الطلب لا معرّف ملف حر؛ كل عرض يُسجَّل `APPLICATION_LICENSE_VIEWED` |
| Applications.gs | `reviewAssociationApplication` | مراجعة الطلب (ADMIN) | ApplicationsModule | `POST /association-applications/:id/review` | `/admin/applications` | association_applications, associations, accounts, auth_credentials, idempotency_keys, public_code_counters, audit_logs | MIGRATED | UNDER_REVIEW→ACCEPTED\|REJECTED فقط، نهائي؛ `:id` عبر `ParseUUIDPipe` (NODE-2.1)؛ `SELECT ... FOR UPDATE` + idempotency عبر `opId`؛ كلمة المرور المؤقتة تُعرض مرة واحدة ولا تُخزَّن ولا تُعاد عند التكرار (انحراف أمني متعمَّد — راجع SECURITY_MODEL.md) |
| Applications.gs | `listApplications` | قائمة طلبات الانضمام (ADMIN) | ApplicationsModule | `GET /association-applications` | `/admin/applications` | association_applications, application_answers, files | MIGRATED | ليست ضمن الـ32 المستخرَجة من `Index.html` (تُستدعى داخليًا في القديم ضمن حزم اللوحة)؛ ترقيم/بحث/تصفية بالحالة؛ `scoreLabel` («7/8») مؤشّر عرض فقط لا يدخل في أي قرار. NODE-2.1: `page`/`pageSize`/`status` بتحقق زمن تشغيل (400 لا 500)، و`:id` عبر `ParseUUIDPipe`. **لا `sortBy`/`sortDir`**: `listApplications_` القديمة لا تستدعي `applySort_` و`renderApplications` لا تمرّر `sortFields` — الترتيب ثابت `submittedAt DESC` (راجع ASSOCIATION_APPLICATIONS.md §13) |
| DevicesAssociations.gs | `listAssociations` | قائمة الجمعيات (ADMIN) | AssociationsModule | `GET /associations` | `/admin/associations` | associations, accounts, beneficiaries, device_units | MIGRATED | ليست ضمن الـ32 المستخرَجة من `Index.html` (تُستدعى داخليًا في القديم)؛ عدّادات مجمَّعة عبر `groupBy` واحد لكل نوع (لا N+1). NODE-2.1: بحث برقم الجوال (مطبَّع، مطابقة رقم كامل على `phones text[]`)، و`page`/`pageSize`/`status` بتحقق زمن تشغيل (400 لا 500)، و`sortBy`/`sortDir` بقائمة بيضاء `name`/`city` مطابقةً لـ`applySort_` في `listAssociations_` القديمة (`progress` مؤجَّل لاعتماده على نطاق الأجهزة غير المهاجَر) — راجع ASSOCIATIONS.md |
| Beneficiaries.gs | `listBeneficiaries` | قائمة المستفيدين | BeneficiariesModule | `GET /beneficiaries` | `/admin/beneficiaries`، `/association/beneficiaries` | beneficiaries, beneficiary_needs | MIGRATED | ADMIN+ASSOCIATION؛ العزل من AuthContext حصرًا (جمعية لا تستطيع طلب صفحة جمعية أخرى مهما أرسلت)؛ ترقيم/بحث خادمي، وترتيب بقائمة بيضاء `name`/`city`/`createdAt` مطابقةً لـ`applySort_` + `sortFields` في `renderBeneficiaries`؛ عدّادات الاحتياجات عبر `groupBy` واحد لكل الصفحة (لا N+1). **NODE-3.1**: أُضيف مُصفّي `locationStatus=PENDING|CONFIRMED` المطابق لِ«بانتظار تحديد الموقع» (`listBeneficiaries_` 37-38 عبر `beneficiaryLocationConfirmed_`)، وحقل مشتق `locationConfirmed` في كل صف. مُصفّي «جاهز للإحالة» **مؤجَّل صراحةً** لاعتماده على بيانات تخصيص/تسليم غير مهاجَرة (NODE-4/6) — لم تُبنَ نسخة وهمية منه |
| Beneficiaries.gs / BeneficiaryNeeds.gs | `saveBeneficiary` + `saveBeneficiaryWithNeeds` | نموذج المستفيد | BeneficiariesModule | `POST /beneficiaries` (إنشاء)، `PATCH /beneficiaries/:id` (تعديل) | `/association/beneficiaries` | beneficiaries, beneficiary_needs, public_code_counters, idempotency_keys | MIGRATED | مساران صريحان بدل `payload.id` الضمني (نفس نهج NODE-2 في `saveAssociation`)؛ الإنشاء ذرّي (مستفيد + احتياجاته معًا) ويشترط احتياجًا صالحًا واحدًا على الأقل؛ لا نقل بين الجمعيات من نموذج التعديل العام؛ فحص تكرار الجوال داخل الجمعية وحدها — راجع BENEFICIARIES.md. **NODE-3.1**: (أ) `address`/`landmark` لم يعودا حقلَي إدخال — حُذفا من الـDTOs ولا يُكتَب إليهما من أي مسار REST، ويبقيان للقراءة التاريخية فقط (**انحراف مقصود** عن Legacy الذي كان يقبلهما حيَّين)؛ (ب) دعم `lat`/`lng`/`locationSource` بالأعمدة الموجودة أصلًا، مطابقًا لِ`optionalCoordinate_`/`validateLocationSource_`/`buildBeneficiaryFieldValues_` (both-or-neither، المدى العالمي، تحديث المصدر/التاريخ عند تغيّر الإحداثيات فعليًا فقط، ومسح صريح بـ`null` لكليهما)؛ (ج) تنبيه «مطابق محتمل» **غير حاجب** (`findPossibleDuplicateBeneficiary_`) يحمل `publicCode` فقط ومحصور بنفس الجمعية؛ (د) رفض تكرار الجوال صار آمنًا ضد السباق عبر `pg_advisory_xact_lock` بمفتاح لكل (جمعية، جوال) وترتيب اكتساب حتمي — القاعدة نفسها بلا تغيير |
| BeneficiaryNeeds.gs | `setBeneficiaryNeeds` | نموذج المستفيد (الاحتياجات) | BeneficiariesModule | `PATCH /beneficiaries/:id` (حقل `deviceTypes`) | `/association/beneficiaries` | beneficiary_needs | MIGRATED | مدمَجة في مسار التعديل الموحَّد كما في القديم (`updateBeneficiaryWithNeeds_`): غياب `deviceTypes` لا يمسّ الاحتياجات، وإرسالها يُعامَل كقائمة نهائية (إضافة الناقص وحذف المعلَّق الغائب فقط، ولا حذف لمحسوم أبدًا) |
| BeneficiaryNeeds.gs | `removePendingBeneficiaryNeed` | نموذج المستفيد | BeneficiariesModule | `DELETE /beneficiaries/needs/:needId` | `/association/beneficiaries` | beneficiary_needs, idempotency_keys | MIGRATED | معلَّق فقط وقبل القرار النهائي، ولا يُترك المستفيد بلا احتياج؛ idempotent عبر `opId` بنفس نطاق العملية القديم |
| Beneficiaries.gs / ExcelTemplate.gs | `downloadBeneficiaryImportTemplateXlsx` | استيراد جماعي | BeneficiariesModule | `GET /beneficiaries/import-template.xlsx` | `/association/beneficiaries/import` | — | NOT_STARTED | ملف ثابت التوليد، لا بيانات مستخدم |
| Beneficiaries.gs | `inspectBeneficiaryExcel` | استيراد جماعي (معاينة) | BeneficiariesModule | `POST /beneficiaries/import/inspect` | `/association/beneficiaries/import` | — (قراءة فقط، لا كتابة) | NOT_STARTED | dry-run |
| Beneficiaries.gs | `importBeneficiaries` | استيراد جماعي (تنفيذ) | BeneficiariesModule | `POST /beneficiaries/import` | `/association/beneficiaries/import` | beneficiaries, beneficiary_needs | NOT_STARTED | idempotent عبر import run ID — راجع LEGACY_DATA_MIGRATION.md للمبدأ المشابه |
| BeneficiaryNeeds.gs | `reviewBeneficiaryNeeds` | مراجعة مستفيد فردي (ADMIN) — Phase 3.2A | BeneficiariesModule | `POST /beneficiaries/:id/review` | `/admin/beneficiaries` | beneficiaries, beneficiary_needs, audit_logs, idempotency_keys | MIGRATED | **ADMIN فقط**؛ `SELECT … FOR UPDATE` + idempotency عبر `opId`؛ قرار نهائي غير قابل لإعادة الفتح (`BENEFICIARY_ALREADY_REVIEWED`)؛ سبب رفض المستفيد إلزامي (≤500) وسبب الاحتياج الفردي اختياري؛ الاعتماد يوجب البتّ في كل معلَّق و≥1 معتمد؛ الرفض يغلق كل المعلَّق بالسبب الموحَّد؛ الاعتماد يضبط `APPROVED_ENTITLEMENT` بلا أي فحص مخزون — راجع BENEFICIARIES.md |
| BeneficiaryNeeds.gs | `bulkReviewBeneficiaries` | اعتماد بالجملة (ADMIN) — Phase 3.2A.1 | BeneficiariesModule | `POST /beneficiaries/bulk-review` | `/admin/beneficiaries` (bulk bar) | beneficiaries, beneficiary_needs, audit_logs, idempotency_keys | MIGRATED | **ADMIN فقط**؛ كل عنصر معاملة ذرّية مستقلة (فشل عنصر لا يُرجِع الناجح)، والرد `success[]`/`failed[]`؛ تجميع بذرة التخصيص **مرة واحدة لكل جمعية فريدة** بعد انتهاء الدفعة (Patch 3.2A.1) محفوظ حرفيًا ومُختبَر بتنفيذ تجسّس؛ البذرة NO-OP في NODE-3 (المحرّك الفعلي في NODE-5) |
| ReceiptBatches.gs | `createReceiptBatch` + `sendReceiptBatch` | محاضر استلام الأجهزة (ADMIN) | ReceiptsModule | `POST /receipts`, `POST /receipts/:id/send` | `/admin/receipts` | receipt_batches, receipt_items, public_code_counters, idempotency_keys | MIGRATED | **NODE-4**: إنشاء ذرّي (محضر+بنوده)، `DRAFT→AWAITING_ASSOCIATION_CONFIRMATION` فقط عند الإرسال، إعادة تحقق نشاط الجمعية داخل القفل عند كل خطوة، idempotent عبر `opId` — راجع NODE-4_CONTRACT.md |
| ReceiptBatches.gs | `confirmReceiptBatch` | تأكيد استلام المحضر (ASSOCIATION) | ReceiptsModule + FilesModule | `POST /receipts/:id/confirm` | `/association/receipts` | receipt_batches, receipt_items, receipt_damage_photos, device_units, files, idempotency_keys | MIGRATED | **NODE-4**: بند غائب=استلام كامل، معادلة الكميات إلزامية، صورة كمية+توقيع إلزاميان (magic bytes حقيقية، 6 MiB)، قواعد عدد/ربط صور التلف حرفية، `device_units` تُنشأ بعدد `goodQty` بالضبط داخل نفس المعاملة بعد `SELECT...FOR UPDATE`، بذرة التخصيص تُستدعى بعد commit فقط — راجع NODE-4_CONTRACT.md |
| ReceiptBatches.gs | `retryDelivery` | إعادة محاولة تسليم | DeliveriesModule | `POST /delivery-missions/:id/retry` | `/delegate/deliveries` | delivery_missions, delivery_attempts | NOT_STARTED | |
| ReceiptBatches.gs / DevicesAssociations.gs | `updateDeliveryStatus` | تحديث حالة تسليم | DeliveriesModule | `PATCH /delivery-attempts/:id` | `/delegate/deliveries` | delivery_attempts, delivery_missions | NOT_STARTED | |
| ReceiptBatches.gs | `listBeneficiaryDeliveryAttempts` | سجل تسليم مستفيد | DeliveriesModule | `GET /beneficiaries/:id/delivery-attempts` | `/admin/beneficiaries/:id` | delivery_attempts | NOT_STARTED | append-only، لا حذف |
| ReceiptBatches.gs | `getDeliveryProofImage` | إثبات التسليم | FilesModule | `GET /files/:id/signed-url` | (inline في تفاصيل التسليم) | files | NOT_STARTED | signed URL مؤقت — لا رابط دائم |
| DevicesAssociations.gs | `listDelegateAuditLog` | سجل مندوب | AuditModule | `GET /audit-logs?actorAccountId=` | `/delegate/log` | audit_logs | NOT_STARTED | append-only |
| ReferenceData.gs | `getReferenceData` | كل القوائم المنسدلة | ReferenceDataModule | `GET /reference-values` | (شبه-كل الشاشات) | reference_values | MIGRATED | عام بلا جلسة كالقديم؛ لا "builtin fallback" صامت — انحراف متعمَّد، راجع AUTHENTICATION.md/ARCHITECTURE.md |
| ActivitiesAndDashboard.gs (ضمن الملفات الحالية) | `getActivitiesBundle` | إدارة الأنشطة (ADMIN) | ActivitiesModule | `GET /activities` | `/admin/activities` | activities, activity_evidence | FOUNDATION_READY | |
| ActivitiesAndDashboard.gs | `saveActivity` | إدارة الأنشطة (ADMIN) | ActivitiesModule | `POST/PATCH /activities` | `/admin/activities` | activities | NOT_STARTED | |
| DevicesAssociations.gs | `getPortalBundle` | لوحة ADMIN الرئيسية (مؤشرات) | (متعدد — تجميع عبر modules) | `GET /dashboard/summary` | `/admin` | (قراءة مجمَّعة من عدة كيانات) | NOT_STARTED | ليست وحدة مستقلة — endpoint تجميعي فقط، لا منطق أعمال خاص به |

---

## تغطية Parity Status (بعد NODE-4)

الجدول أعلاه صار يضم أسطرًا لدوال داخلية ليست ضمن الـ32 المستخرَجة من
`Index.html` (`listApplications`، `listAssociations`، `listBeneficiaries`،
`setBeneficiaryNeeds`) — أُضيفت لأنها سطح API حقيقي في المنصة الجديدة.
الأرقام أدناه تعدّ **أسطر الجدول** كما هي الآن.

**NODE-4**: `createReceiptBatch`+`sendReceiptBatch` و`confirmReceiptBatch` و`getDeviceDetail` انتقلت NOT_STARTED→MIGRATED (3 أسطر). `saveDevice` بقيت NOT_STARTED إجمالًا (جزء القراءة فقط مُهاجَر، موثَّق في الملاحظة — لا تغيير في عدّاد الحالة لسطرها لأن معظم دالتها القديمة — الربط/الاكتمال الجماعي/فكّ الربط — لم يُهاجَر بعد).

| الحالة | العدد |
|---|---|
| `FOUNDATION_READY` | 1 |
| `NOT_STARTED` | 16 |
| `MIGRATED` | 24 |
| `PARITY_VERIFIED` | 0 |
| **الإجمالي** | **41** |

الأسطر السبعة `MIGRATED`: `login`، `logout`، `changePassword`،
`requestPasswordReset`، `resetPasswordWithCode`،
`resetAssociationPassword` (كل Auth.gs)، و`getReferenceData`
(ReferenceData.gs). `getBootstrapData` لا يزال `NOT_STARTED` عمدًا —
قرار NODE-1 المعتمد هو عدم نقله الآن (endpoints مستقلة بديلة).

كل الـ32 دالة عامة الموجودة فعليًا في `Index.html` مُدرَجة أعلاه — لا
endpoint واحد غاب عن هذه المصفوفة. الأعمدة الفارغة أو غير الدقيقة (مثل
الاسم الفعلي لدالة إنشاء/إرسال محضر الاستلام داخل `ReceiptBatches.gs`)
تُصحَّح عند بدء NODE-4 بعد قراءة الملف الكامل مجددًا وقت التنفيذ الفعلي
— هذه المصفوفة أُعِدَّت اعتمادًا على معرفة تراكمية موثَّقة بالنظام
القديم عبر مراحل التطوير السابقة، وتحتاج تدقيقًا سطرًا سطرًا وقت نقل كل
Module فعليًا (وسم كـ`NEEDS_DECISION` أدناه في التقرير النهائي).
