# خريطة الكود (CODEMAP)

مرجع سريع لموقع كل نطاق وظيفي في `platform/`، محدَّث حتى NODE-4.

## Backend — `apps/api/src`

| النطاق | Module | مسار |
|---|---|---|
| مشترك (public code / idempotency) | `CommonModule` (`@Global`) | `common/common.module.ts`, `common/public-code.service.ts`, `common/idempotency.service.ts` |
| ترقيم/تحقق زمن تشغيل | — | `common/pagination.util.ts`, `common/validation/pagination-query.dto.ts` |
| المصادقة/الجلسات | `AuthModule` | `modules/auth/*` |
| الحسابات | `AccountsModule` | `modules/accounts/*` |
| الجمعيات | `AssociationsModule` | `modules/associations/*` |
| طلبات الانضمام | `ApplicationsModule` | `modules/applications/*` |
| المستفيدون + احتياجاتهم + المراجعة | `BeneficiariesModule` | `modules/beneficiaries/*` |
| بذرة التخصيص (NO-OP حتى NODE-5) | `AllocationModule` | `modules/allocation/allocation-trigger.port.ts`, `noop-allocation-trigger.service.ts` |
| **محاضر استلام دفعات الأجهزة (NODE-4)** | `ReceiptsModule` | `modules/receipts/*` |
| **مخزون الأجهزة — قراءة (NODE-4)** | `InventoryModule` | `modules/inventory/*` |
| التخزين الخاص (S3-compatible) | `FilesModule` | `modules/files/storage.service.ts`, `file-validation.util.ts` |
| المراجع (مناطق/مدن/تصنيفات/إلخ) | `ReferenceDataModule` | `modules/reference-data/*` |
| التدقيق | `AuditModule` | `modules/audit/*` |
| المندوبون/التسليم/الأنشطة | `DelegatesModule`/`DeliveriesModule`/`ActivitiesModule` | لم تُنقَل بعد (NODE-6/لاحقًا) — `_module-status` فقط |

## Frontend — `apps/web/app`

| الصفحة | الدور | ملاحظة |
|---|---|---|
| `/apply`, `/apply/status` | عام | طلب انضمام جمعية |
| `/admin/applications` | ADMIN | مراجعة طلبات الانضمام |
| `/admin/associations` | ADMIN | إدارة الجمعيات |
| `/admin/beneficiaries` | ADMIN | مراجعة المستفيدين (فردية/جماعية) |
| `/association/beneficiaries` | ASSOCIATION | مستفيدو الجمعية |
| **`/admin/receipts`** | ADMIN | **NODE-4** — إنشاء/إرسال محاضر الاستلام |
| **`/association/receipts`** | ASSOCIATION | **NODE-4** — تأكيد استلام المحاضر الواردة |
| **`/admin/inventory`** | ADMIN | **NODE-4** — قراءة مخزون الأجهزة |
| `/association/settings` | ASSOCIATION | إعدادات ذاتية (هاتف/بريد) |

## Schema — `packages/db/prisma/schema.prisma`

النماذج الخاصة بـNODE-4 (`ReceiptBatch`/`ReceiptItem`/`ReceiptDamagePhoto`/`DeviceUnit`) كانت موجودة بالكامل منذ NODE-0/NODE-0.1 — لم تحتَج أي migration جديدة؛ NODE-4 هو طبقة تطبيق (service/controller) فوق مخطط جاهز مسبقًا.

## اختبارات

اختبارات كل مرحلة معزولة بملف/أدوات fixtures مستقلة (`test/utils/node{2,3,4}-fixtures.ts`) — لا تُعدَّل ملفات اختبار مرحلة سابقة عند إضافة مرحلة جديدة.
