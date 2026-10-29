-- Additive only: historical beneficiaries retain their data and null priority.
ALTER TABLE "beneficiaries" ADD COLUMN "need_priority" INTEGER,
  ADD COLUMN "three_device_reason" TEXT;
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_need_priority_range"
  CHECK ("need_priority" IS NULL OR "need_priority" BETWEEN 1 AND 50);
CREATE UNIQUE INDEX "beneficiaries_active_need_priority_key"
  ON "beneficiaries" ("association_id", "need_priority")
  WHERE "archived_at" IS NULL AND "need_priority" IS NOT NULL;
