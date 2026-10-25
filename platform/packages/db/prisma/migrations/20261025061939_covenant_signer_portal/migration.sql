-- Additive only. Provisioning/assignment and old-link extension are separate,
-- audited operations after release approval; this migration sends no mail.
ALTER TYPE "AccountRole" ADD VALUE IF NOT EXISTS 'COVENANT_SIGNER';
ALTER TABLE participation_agreements ADD COLUMN IF NOT EXISTS assigned_signer_id uuid;
ALTER TABLE participation_agreements ADD CONSTRAINT participation_agreements_assigned_signer_id_fkey
  FOREIGN KEY (assigned_signer_id) REFERENCES accounts(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS participation_agreements_assigned_signer_id_status_idx
  ON participation_agreements(assigned_signer_id, status);
