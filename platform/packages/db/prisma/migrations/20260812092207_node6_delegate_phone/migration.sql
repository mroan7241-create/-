-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "auth_sessions" ALTER COLUMN "absolute_expires_at" DROP DEFAULT;
