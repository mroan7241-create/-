-- NODE-2: Association Applications + Association Management
-- Append-only migration — لا تعديل على أي migration سابقة (20260809043546_init، 20260809050238_node1_auth_reference_data).
--
-- يضيف:
--   1) association_applications.sector (nullable — راجع تعليق schema.prisma)
--   2) قيود فرادة (UNIQUE) على license_file_id وresulting_association_id
--   3) فهارس بحث ADMIN (email/phone/license_number) على association_applications
--   4) جدول public_code_counters (مولّد publicCode ذرّي متزامن)
--   5) partial unique indexes حقيقية (raw SQL — Prisma @@unique العادي لا يدعم WHERE):
--      - حساب ASSOCIATION تشغيلي واحد فقط لكل association (غير مؤرشَف)
--      - طلب UNDER_REVIEW واحد فقط لكل بريد/هاتف/رقم ترخيص مطبَّع (لا يشمل السجلات التاريخية المبتوتة)

-- AlterTable
ALTER TABLE "association_applications" ADD COLUMN     "sector" TEXT;

-- AlterTable: category اختياري فعليًا في Legacy (submitAssociationApplication_ لا يفرضه) — كان NOT NULL خطأً منذ NODE-0.
ALTER TABLE "association_applications" ALTER COLUMN "category" DROP NOT NULL;

-- CreateTable
CREATE TABLE "public_code_counters" (
    "prefix" TEXT NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_code_counters_pkey" PRIMARY KEY ("prefix")
);

-- CreateIndex
CREATE UNIQUE INDEX "association_applications_license_file_id_key" ON "association_applications"("license_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "association_applications_resulting_association_id_key" ON "association_applications"("resulting_association_id");

-- CreateIndex
CREATE INDEX "association_applications_email_idx" ON "association_applications"("email");

-- CreateIndex
CREATE INDEX "association_applications_phone_idx" ON "association_applications"("phone");

-- CreateIndex
CREATE INDEX "association_applications_license_number_idx" ON "association_applications"("license_number");

-- NODE-2: حساب ASSOCIATION تشغيلي واحد فقط لكل جمعية (غير مؤرشَف) — يطابق
-- نموذج الأدوار الثلاثة الحالي (حساب دخول واحد لكل جمعية)، ويجعل
-- resetAssociationPassword/AuthService::findFirst({associationId, role})
-- محدَّد النتيجة دائمًا بلا غموض.
CREATE UNIQUE INDEX "ux_accounts_one_association_role"
  ON "accounts" ("association_id")
  WHERE "role" = 'ASSOCIATION' AND "archived_at" IS NULL;

-- NODE-2: لا يوجد أكثر من طلب UNDER_REVIEW واحد بنفس البريد/الهاتف/رقم
-- الترخيص (بعد التطبيع الموحَّد في AuthService) — خط الدفاع الأخير ضد
-- سباقات إرسال متزامنة، بالإضافة إلى الفحص على مستوى Service. سجلات
-- ACCEPTED/REJECTED التاريخية مستثناة عمدًا (لا تمنع طلبًا لاحقًا مشروعًا).
CREATE UNIQUE INDEX "ux_pending_application_email"
  ON "association_applications" ("email")
  WHERE "status" = 'UNDER_REVIEW' AND "email" IS NOT NULL;

CREATE UNIQUE INDEX "ux_pending_application_phone"
  ON "association_applications" ("phone")
  WHERE "status" = 'UNDER_REVIEW';

CREATE UNIQUE INDEX "ux_pending_application_license"
  ON "association_applications" ("license_number")
  WHERE "status" = 'UNDER_REVIEW' AND "license_number" IS NOT NULL;
