-- PHASE-5: close the Supabase Data API exposure without changing business data.
--
-- The API uses Prisma's privileged database connection; public Data API roles
-- must never receive direct privileges over application tables.  RLS remains
-- enabled as a second barrier so accidental future grants fail closed until a
-- deliberately reviewed policy is added.

-- The compatibility UUID function is not SECURITY DEFINER.  Pin its lookup
-- path to prevent objects in a caller-controlled schema taking precedence.
ALTER FUNCTION public.uuidv7() SET search_path = pg_catalog, public;

-- Remove the existing broad Data API grants and prevent the same grants from
-- returning automatically for objects subsequently created by the owner.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- No policies are created here: application access goes through NestJS/Prisma,
-- not the Supabase Data API.  The table owner and a BYPASSRLS connection keep
-- normal server-side access, while public roles fail closed.
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_answers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "association_applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "associations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_rate_limits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "beneficiaries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "beneficiary_needs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delivery_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delivery_missions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "device_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "device_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "device_units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "password_reset_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public_code_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "receipt_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "receipt_damage_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "receipt_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reference_values" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "system_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
