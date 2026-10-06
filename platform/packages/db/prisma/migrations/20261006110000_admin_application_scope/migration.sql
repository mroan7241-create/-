-- Additive only: existing accounts retain their existing (unscoped) access.
ALTER TABLE "accounts" ADD COLUMN "admin_application_scope" JSONB;
