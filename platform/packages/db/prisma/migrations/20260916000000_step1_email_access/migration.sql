CREATE TYPE "ApplicationAccessTokenPurpose" AS ENUM ('DRAFT_RESUME', 'SUBMITTED_STATUS', 'NEEDS_INFO');

CREATE TABLE "application_access_tokens" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "draft_id" UUID NOT NULL,
  "purpose" "ApplicationAccessTokenPurpose" NOT NULL,
  "token_hash" TEXT NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "application_access_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "application_applicant_sessions" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "draft_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "application_applicant_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "application_access_tokens_token_hash_key" ON "application_access_tokens"("token_hash");
CREATE INDEX "application_access_tokens_draft_id_purpose_consumed_at_idx" ON "application_access_tokens"("draft_id", "purpose", "consumed_at");
CREATE INDEX "application_access_tokens_expires_at_idx" ON "application_access_tokens"("expires_at");
CREATE UNIQUE INDEX "application_applicant_sessions_token_hash_key" ON "application_applicant_sessions"("token_hash");
CREATE INDEX "application_applicant_sessions_draft_id_expires_at_idx" ON "application_applicant_sessions"("draft_id", "expires_at");
CREATE INDEX "application_applicant_sessions_expires_at_idx" ON "application_applicant_sessions"("expires_at");

ALTER TABLE "application_access_tokens" ADD CONSTRAINT "application_access_tokens_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "association_application_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "application_applicant_sessions" ADD CONSTRAINT "application_applicant_sessions_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "association_application_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
