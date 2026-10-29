ALTER TABLE "associations" ADD COLUMN "beneficiary_limit" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "associations" ADD CONSTRAINT "associations_beneficiary_limit_range"
  CHECK ("beneficiary_limit" BETWEEN 1 AND 1000);
-- The association's approved quota, rather than a fixed rank ceiling, controls intake.
ALTER TABLE "beneficiaries" DROP CONSTRAINT "beneficiaries_need_priority_range";
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_need_priority_range"
  CHECK ("need_priority" IS NULL OR "need_priority" BETWEEN 1 AND 1000);
