-- ============================================================
-- NODE-1 — Authentication + Sessions + Roles + Reference Data
-- ============================================================
-- append-only migration فوق 20260809043546_init (لا تعديل عليها).
-- لا بيانات Production متأثرة — كل الجداول المعنية فارغة في أي بيئة
-- تطوير/اختبار حاليًا. DEFAULT على absolute_expires_at أدناه احترازي
-- بحت (الطبقة التطبيقية ترسل قيمة صريحة دومًا عبر Prisma؛ لا @default
-- في schema.prisma نفسه) تحسّبًا لأي إدراج يدوي مستقبلي فقط.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReferenceValueType" ADD VALUE 'ASSOCIATION_SECTOR';
ALTER TYPE "ReferenceValueType" ADD VALUE 'DEVICE_SPEC';
ALTER TYPE "ReferenceValueType" ADD VALUE 'SUPPLIER';
ALTER TYPE "ReferenceValueType" ADD VALUE 'DIFFERENCE_REASON';
ALTER TYPE "ReferenceValueType" ADD VALUE 'RECEIVER_TITLE';

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "last_login_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN     "absolute_expires_at" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '12 hours');

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "account_id" UUID NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_rate_limits" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "scope" TEXT NOT NULL,
    "subject_hash" TEXT NOT NULL,
    "window_started_at" TIMESTAMP(3) NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "password_reset_tokens_account_id_idx" ON "password_reset_tokens"("account_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "auth_rate_limits_expires_at_idx" ON "auth_rate_limits"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_rate_limits_scope_subject_hash_key" ON "auth_rate_limits"("scope", "subject_hash");

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

