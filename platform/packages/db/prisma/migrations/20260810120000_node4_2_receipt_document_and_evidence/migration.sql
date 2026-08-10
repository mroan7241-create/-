-- ============================================================
-- NODE-4.2 — إغلاق محضر الاستلام: رقم مستند + إثبات إداري + محضر/ختم
-- الجمعية (append-only بحت)
-- ============================================================
-- إضافات اختيارية بحتة فوق receipt_batches الجاهز منذ NODE-0/NODE-0.1:
--
--   document_number            — رقم مستند مرجعي نصي اختياري (لا نظام
--                                 مشتريات/RFQ/PO — نص حر فقط).
--   admin_proof_file_id        — إثبات/مستند شراء من طرف الإدارة يُرفَق
--                                 عند إنشاء المحضر (PDF أو صورة، اختياري
--                                 دومًا).
--   association_report_file_id — محضر/ختم الجمعية يُرفَق عند التأكيد
--                                 (PDF أو صورة، اختياري افتراضيًا —
--                                 إلزامه يُضبَط عبر system_settings،
--                                 المفتاح receipt.associationReportRequired،
--                                 لا عبر أي قيد بنيوي هنا).
--
-- قيمتا FileCategory الجديدتان (RECEIPT_ADMIN_PROOF/RECEIPT_ASSOCIATION_REPORT)
-- تُضافان أولًا لأن receipt_batches.admin_proof_file_id/association_report_file_id
-- تشير إلى صفوف files التي ستحمل هاتين الفئتين.
--
-- لا تُعدَّل أي migration سابقة (init/NODE-1/NODE-2/NODE-3) بأي حرف —
-- هذا الملف إضافة صرفة، ويطبَّق نظيفًا فوق قاعدة تحمل بيانات NODE-4/4.1
-- بلا أي فقد أو تعديل على صفوف موجودة (الأعمدة الجديدة NULL افتراضيًا).

-- AlterEnum
ALTER TYPE "FileCategory" ADD VALUE 'RECEIPT_ADMIN_PROOF';
ALTER TYPE "FileCategory" ADD VALUE 'RECEIPT_ASSOCIATION_REPORT';

-- AlterTable
ALTER TABLE "receipt_batches" ADD COLUMN     "document_number" TEXT,
ADD COLUMN     "admin_proof_file_id" UUID,
ADD COLUMN     "association_report_file_id" UUID;

-- AddForeignKey
ALTER TABLE "receipt_batches" ADD CONSTRAINT "receipt_batches_admin_proof_file_id_fkey" FOREIGN KEY ("admin_proof_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_batches" ADD CONSTRAINT "receipt_batches_association_report_file_id_fkey" FOREIGN KEY ("association_report_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
