-- ============================================================
-- NODE-3 — حقول المستفيد الثلاثة الناقصة (append-only بحت)
-- ============================================================
-- مصدر الحقول: `HEADERS['المستفيدون']` في `Config.gs` و
-- `buildBeneficiaryFieldValues_` في `Beneficiaries.gs` على الـbaseline
-- القديم daa5e6d5d98b3b724bd867ce1d9117ded14db3f9:
--
--   'العنوان'      → address   — إلزامي في Legacy (requiredText_ حد 250)
--   'علامة مميزة'  → landmark  — اختياري (cleanText_ حد 200)
--   'الملاحظات'    → notes     — اختياري (cleanText_ حد 1000)
--
-- كانت الثلاثة غائبة عن مخطط NODE-0، فتعذّر تحقيق parity كامل لنموذج
-- إنشاء/تعديل المستفيد بدونها.
--
-- لماذا DEFAULT '' على address رغم أنه إلزامي منطقيًا:
-- هذه migration إضافية على جدول قد يحمل صفوفًا في أي بيئة مطبَّقة سابقًا،
-- وإضافة عمود NOT NULL بلا DEFAULT تفشل فورًا على جدول غير فارغ. الإلزام
-- الفعلي مفروض في طبقة الخدمة (`requiredText(input.address, ...)` في
-- BeneficiariesService) مطابقةً لِLegacy تمامًا — القاعدة تضمن عدم NULL
-- فقط، والخدمة تضمن عدم الفراغ لأي سجل جديد أو معدَّل.
--
-- لا تُعدَّل أي migration سابقة (NODE-0/NODE-1/NODE-2) بأي حرف — هذا
-- الملف إضافة صرفة، ويطبَّق نظيفًا على قاعدة فارغة تمامًا.
--
-- ملاحظة مقصودة: أي فرق آخر يرصده `prisma migrate diff` بين المخطط
-- والقاعدة (تحديدًا DEFAULT على auth_sessions.absolute_expires_at الذي
-- أضافته NODE-1 عمدًا كحزام أمان للـbackfill ولم يُعلَن في schema.prisma)
-- **مستثنى صراحة** من هذه الـmigration — إسقاطه تغيير سلوكي في نطاق
-- NODE-1 لا في نطاق NODE-3، ولا يجوز تمريره كأثر جانبي صامت.

-- AlterTable
ALTER TABLE "beneficiaries" ADD COLUMN     "address" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "landmark" TEXT,
ADD COLUMN     "notes" TEXT;
