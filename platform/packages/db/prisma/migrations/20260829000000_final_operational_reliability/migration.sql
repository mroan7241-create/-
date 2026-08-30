-- Additive reliability support for independently claimed outbox jobs.
ALTER TYPE "OutboxEventType" ADD VALUE IF NOT EXISTS 'ALLOCATION_RETRY_DUE';
ALTER TYPE "OutboxEventStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

ALTER TABLE "outbox_events"
  ADD COLUMN "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "locked_at" TIMESTAMP(3),
  ADD COLUMN "failed_at" TIMESTAMP(3);

DROP INDEX IF EXISTS "outbox_events_status_created_at_idx";
CREATE INDEX "outbox_events_status_next_attempt_at_created_at_idx"
  ON "outbox_events"("status", "next_attempt_at", "created_at");
