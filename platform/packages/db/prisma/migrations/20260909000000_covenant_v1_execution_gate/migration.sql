-- Covenant V1 execution evidence extends the existing participation agreement.
-- All columns are additive and nullable so historical agreements remain readable.
ALTER TABLE "participation_agreements"
  ADD COLUMN "template_sha256" TEXT,
  ADD COLUMN "org_signer_title" TEXT,
  ADD COLUMN "association_account_id" UUID,
  ADD COLUMN "org_signature_file_id" UUID,
  ADD COLUMN "party_one_signature_file_id" UUID,
  ADD COLUMN "party_one_signing_token_hash" TEXT,
  ADD COLUMN "party_one_signing_expires_at" TIMESTAMP(3),
  ADD COLUMN "party_one_signing_consumed_at" TIMESTAMP(3),
  ADD COLUMN "party_one_signing_issued_by" UUID,
  ADD COLUMN "fully_executed_at" TIMESTAMP(3),
  ADD COLUMN "final_file_id" UUID,
  ADD COLUMN "final_sha256" TEXT;

CREATE UNIQUE INDEX "participation_agreements_party_one_signing_token_hash_key"
  ON "participation_agreements"("party_one_signing_token_hash");

CREATE INDEX "participation_agreements_association_account_id_idx"
  ON "participation_agreements"("association_account_id");

ALTER TABLE "participation_agreements"
  ADD CONSTRAINT "participation_agreements_association_account_id_fkey"
  FOREIGN KEY ("association_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "participation_agreements_org_signature_file_id_fkey"
  FOREIGN KEY ("org_signature_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "participation_agreements_party_one_signature_file_id_fkey"
  FOREIGN KEY ("party_one_signature_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "participation_agreements_party_one_signing_issued_by_fkey"
  FOREIGN KEY ("party_one_signing_issued_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "participation_agreements_final_file_id_fkey"
  FOREIGN KEY ("final_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
