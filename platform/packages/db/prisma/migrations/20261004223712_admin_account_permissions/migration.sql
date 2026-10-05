-- Existing roles and workflow records remain unchanged. Staff start without grants.
ALTER TABLE "accounts"
  ADD COLUMN "admin_full_access" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "admin_permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "accounts" SET "admin_full_access" = true
WHERE "role" = 'ADMIN' AND "public_code" = 'ADM-000001';

-- next_value stores the last issued value, not the next unused value.
INSERT INTO "public_code_counters" ("prefix", "next_value", "updated_at")
SELECT 'ADM', COALESCE(MAX(substring("public_code" from '^ADM-([0-9]+)$')::integer), 0), now()
FROM "accounts" WHERE "public_code" ~ '^ADM-[0-9]+$'
ON CONFLICT ("prefix") DO UPDATE SET
  "next_value" = GREATEST("public_code_counters"."next_value", EXCLUDED."next_value"),
  "updated_at" = now();
