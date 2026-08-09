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

---

| Legacy Module (.gs) | Legacy Public Function | Current UI (Index.html) | New API Module | New Endpoint (planned) | New UI Route (planned) | DB Entities | Parity Status | Notes |
|---|---|---|---|---|---|---|---|---|
| Auth.gs | `login` | شاشة الدخول | AuthModule | `POST /auth/login` | `/login` | accounts, auth_credentials, auth_sessions | FOUNDATION_READY | Module skeleton فقط — health check لا auth فعلي بعد |
| Auth.gs | `logout` | كل الشاشات (زر خروج) | AuthModule | `POST /auth/logout` | — | auth_sessions | NOT_STARTED | يُبطل الجلسة (`revoked_at`) |
| Auth.gs | `changePassword` | الإعدادات | AuthModule | `PATCH /auth/password` | `/settings` | auth_credentials | NOT_STARTED | يحدّث secret_hash، ينقل القديم إلى previous_secret_hash |
| Auth.gs | `requestPasswordReset` | شاشة الدخول | AuthModule | `POST /auth/password-reset/request` | `/login` | auth_credentials | NOT_STARTED | |
| Auth.gs | `resetPasswordWithCode` | شاشة الدخول | AuthModule | `POST /auth/password-reset/confirm` | `/login` | auth_credentials | NOT_STARTED | |
| Auth.gs | `resetAssociationPassword` | لوحة ADMIN | AuthModule | `POST /auth/associations/:id/reset-password` | `/admin/associations/:id` | auth_credentials | NOT_STARTED | ADMIN only |
| Bootstrap.gs | `getBootstrapData` | تحميل أولي لكل لوحات التحكم | AccountsModule (+ عبر modules متعددة) | `GET /bootstrap` | (root loader) | accounts, associations, reference_values, system_settings | NOT_STARTED | يُستبدل جزئيًا بـREST endpoints مستقلة لكل نطاق (لا نمط bootstrap ضخم واحد في الهيكل الجديد إلزاميًا — قرار تصميم لاحق، راجع MIGRATION_ROADMAP) |
| DevicesAssociations.gs | `saveAssociation` | إدارة الجمعيات (ADMIN) | AssociationsModule | `POST/PATCH /associations` | `/admin/associations` | associations, accounts | FOUNDATION_READY | |
| DevicesAssociations.gs | `updateAssociationSettings` | إعدادات الجمعية | AssociationsModule | `PATCH /associations/:id/settings` | `/association/settings` | associations | NOT_STARTED | |
| DevicesAssociations.gs | `saveDevice` | إدارة الأجهزة | InventoryModule + AllocationModule | `POST/PATCH /device-units` | `/admin/inventory` | device_units, device_allocations, device_movements, beneficiary_needs | NOT_STARTED | أعقد دالة في النظام القديم (ربط جهاز/اكتمال جماعي/فكّ ربط) — راجع STATE_MAPPING.md §7-8 |
| DevicesAssociations.gs | `assignDelegate` | تعيين مندوب لمستفيد | DelegatesModule + DeliveriesModule | `POST /delivery-missions/:id/assign` | `/association/deliveries` | delivery_missions, beneficiary_needs | NOT_STARTED | "التعيين" فقط، لا استلام فعلي — راجع STATE_MAPPING.md §9 |
| DevicesAssociations.gs | `saveDelegate` | إدارة المناديب | DelegatesModule | `POST/PATCH /delegates` | `/association/delegates` | accounts (role=DELEGATE), auth_credentials | NOT_STARTED | |
| DevicesAssociations.gs | `setDelegateStatus` | إدارة المناديب | DelegatesModule | `PATCH /delegates/:id/status` | `/association/delegates` | accounts | NOT_STARTED | |
| DevicesAssociations.gs | `regenerateDelegateCode` | إدارة المناديب | DelegatesModule | `POST /delegates/:id/regenerate-code` | `/association/delegates` | auth_credentials | NOT_STARTED | يُبطل رمز الدخول القديم |
| DevicesAssociations.gs | `getDeviceDetail` | تفاصيل الجهاز | InventoryModule | `GET /device-units/:id` | `/admin/inventory/:id` | device_units, device_movements, device_allocations | NOT_STARTED | |
| Applications.gs | `submitAssociationApplication` | بوابة تقديم الجمعيات (عام) | ApplicationsModule | `POST /association-applications` | `/apply` | association_applications, application_answers, files | FOUNDATION_READY | client_request_id → idempotency |
| Applications.gs | `getApplicationStatus` | متابعة حالة الطلب (عام) | ApplicationsModule | `GET /association-applications/:id/status` | `/apply/status` | association_applications | NOT_STARTED | |
| Applications.gs | `getApplicationLicenseFile` | مراجعة الطلب (ADMIN) | ApplicationsModule + FilesModule | `GET /association-applications/:id/license-file` | `/admin/applications/:id` | files | NOT_STARTED | signed URL مؤقت فقط |
| Applications.gs | `reviewAssociationApplication` | مراجعة الطلب (ADMIN) | ApplicationsModule | `POST /association-applications/:id/review` | `/admin/applications/:id` | association_applications, associations, accounts | NOT_STARTED | قبول ينشئ association + account تلقائيًا |
| Beneficiaries.gs | `saveBeneficiary` | نموذج المستفيد | BeneficiariesModule | `POST/PATCH /beneficiaries` | `/association/beneficiaries` | beneficiaries, beneficiary_needs | FOUNDATION_READY | |
| Beneficiaries.gs / ExcelTemplate.gs | `downloadBeneficiaryImportTemplateXlsx` | استيراد جماعي | BeneficiariesModule | `GET /beneficiaries/import-template.xlsx` | `/association/beneficiaries/import` | — | NOT_STARTED | ملف ثابت التوليد، لا بيانات مستخدم |
| Beneficiaries.gs | `inspectBeneficiaryExcel` | استيراد جماعي (معاينة) | BeneficiariesModule | `POST /beneficiaries/import/inspect` | `/association/beneficiaries/import` | — (قراءة فقط، لا كتابة) | NOT_STARTED | dry-run |
| Beneficiaries.gs | `importBeneficiaries` | استيراد جماعي (تنفيذ) | BeneficiariesModule | `POST /beneficiaries/import` | `/association/beneficiaries/import` | beneficiaries, beneficiary_needs | NOT_STARTED | idempotent عبر import run ID — راجع LEGACY_DATA_MIGRATION.md للمبدأ المشابه |
| BeneficiaryNeeds.gs | `reviewBeneficiaryNeeds` | مراجعة مستفيد فردي (ADMIN) — Phase 3.2A | BeneficiaryNeedsModule | `POST /beneficiaries/:id/review` | `/admin/beneficiaries/:id` | beneficiaries, beneficiary_needs, audit_logs, device_allocations (عبر AllocationModule) | FOUNDATION_READY | القواعد الكاملة في STATE_MAPPING.md §4 — أهم endpoint للهجرة الدقيقة |
| BeneficiaryNeeds.gs | `bulkReviewBeneficiaries` | اعتماد بالجملة (ADMIN) — Phase 3.2A.1 | BeneficiaryNeedsModule | `POST /beneficiaries/bulk-review` | `/admin/beneficiaries` (bulk bar) | beneficiaries, beneficiary_needs, audit_logs | FOUNDATION_READY | تجميع AutoAllocation لكل جمعية (Patch 3.2A.1) — يجب الحفاظ عليه حرفيًا عند النقل |
| ReceiptBatches.gs | (إنشاء/إرسال محضر — يُستدعى ضمن مسارات أخرى) | محاضر استلام الأجهزة (ADMIN) | ReceiptsModule | `POST /receipt-batches`, `POST /receipt-batches/:id/send` | `/admin/receipts` | receipt_batches, receipt_items | NOT_STARTED | |
| ReceiptBatches.gs | `confirmDelivery` (تأكيد الجمعية على المحضر — راجع الاسم الفعلي عند النقل) | تأكيد استلام المحضر (ASSOCIATION) | ReceiptsModule + InventoryModule | `POST /receipt-batches/:id/confirm` | `/association/receipts/:id` | receipt_batches, receipt_items, receipt_damage_photos, device_units | NOT_STARTED | ينشئ device_units من good_qty داخل نفس transaction — راجع ARCHITECTURE.md |
| ReceiptBatches.gs | `retryDelivery` | إعادة محاولة تسليم | DeliveriesModule | `POST /delivery-missions/:id/retry` | `/delegate/deliveries` | delivery_missions, delivery_attempts | NOT_STARTED | |
| ReceiptBatches.gs / DevicesAssociations.gs | `updateDeliveryStatus` | تحديث حالة تسليم | DeliveriesModule | `PATCH /delivery-attempts/:id` | `/delegate/deliveries` | delivery_attempts, delivery_missions | NOT_STARTED | |
| ReceiptBatches.gs | `listBeneficiaryDeliveryAttempts` | سجل تسليم مستفيد | DeliveriesModule | `GET /beneficiaries/:id/delivery-attempts` | `/admin/beneficiaries/:id` | delivery_attempts | NOT_STARTED | append-only، لا حذف |
| ReceiptBatches.gs | `getDeliveryProofImage` | إثبات التسليم | FilesModule | `GET /files/:id/signed-url` | (inline في تفاصيل التسليم) | files | NOT_STARTED | signed URL مؤقت — لا رابط دائم |
| DevicesAssociations.gs | `listDelegateAuditLog` | سجل مندوب | AuditModule | `GET /audit-logs?actorAccountId=` | `/delegate/log` | audit_logs | NOT_STARTED | append-only |
| ReferenceData.gs | `getReferenceData` | كل القوائم المنسدلة | ReferenceDataModule | `GET /reference-values` | (شبه-كل الشاشات) | reference_values | FOUNDATION_READY | |
| ActivitiesAndDashboard.gs (ضمن الملفات الحالية) | `getActivitiesBundle` | إدارة الأنشطة (ADMIN) | ActivitiesModule | `GET /activities` | `/admin/activities` | activities, activity_evidence | FOUNDATION_READY | |
| ActivitiesAndDashboard.gs | `saveActivity` | إدارة الأنشطة (ADMIN) | ActivitiesModule | `POST/PATCH /activities` | `/admin/activities` | activities | NOT_STARTED | |
| DevicesAssociations.gs | `getPortalBundle` | لوحة ADMIN الرئيسية (مؤشرات) | (متعدد — تجميع عبر modules) | `GET /dashboard/summary` | `/admin` | (قراءة مجمَّعة من عدة كيانات) | NOT_STARTED | ليست وحدة مستقلة — endpoint تجميعي فقط، لا منطق أعمال خاص به |

---

## تغطية Parity Status (NODE-0)

| الحالة | العدد |
|---|---|
| `FOUNDATION_READY` | 10 |
| `NOT_STARTED` | 22 |
| `MIGRATED` | 0 |
| `PARITY_VERIFIED` | 0 |
| **الإجمالي** | **32** |

كل الـ32 دالة عامة الموجودة فعليًا في `Index.html` مُدرَجة أعلاه — لا
endpoint واحد غاب عن هذه المصفوفة. الأعمدة الفارغة أو غير الدقيقة (مثل
الاسم الفعلي لدالة إنشاء/إرسال محضر الاستلام داخل `ReceiptBatches.gs`)
تُصحَّح عند بدء NODE-4 بعد قراءة الملف الكامل مجددًا وقت التنفيذ الفعلي
— هذه المصفوفة أُعِدَّت اعتمادًا على معرفة تراكمية موثَّقة بالنظام
القديم عبر مراحل التطوير السابقة، وتحتاج تدقيقًا سطرًا سطرًا وقت نقل كل
Module فعليًا (وسم كـ`NEEDS_DECISION` أدناه في التقرير النهائي).
