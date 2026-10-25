-- Apply once, after approval, against the verified production project only.
-- No token rotation, account change, signature, business-state change or mail.
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
LOCK TABLE participation_agreements IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE covenant_before ON COMMIT DROP AS SELECT id, to_jsonb(g) AS row FROM participation_agreements g;
CREATE TEMP TABLE mail_before ON COMMIT DROP AS SELECT id FROM outbox_events;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM system_settings WHERE key='COVENANT_LINK_WEEK_EXTENSION_20261025') THEN RAISE EXCEPTION 'This extension was already applied; inspect its recorded result'; END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgrelid='participation_agreements'::regclass) THEN RAISE EXCEPTION 'Unexpected trigger; review before proceeding'; END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE public_code='ADM-000001' AND role='ADMIN' AND status='ACTIVE' AND archived_at IS NULL AND admin_full_access) THEN RAISE EXCEPTION 'Verified owner unavailable'; END IF;
END $$;
UPDATE participation_agreements g SET party_one_signing_expires_at = GREATEST(g.party_one_signing_expires_at, timezone('UTC', now()) + interval '7 days')
FROM project_participations p
WHERE p.id=g.participation_id AND p.status='APPROVED_AWAITING_SETUP'
  AND g.status='SIGNED_BY_ORG' AND signed_by_org_at IS NOT NULL AND org_signature_file_id IS NOT NULL
  AND signed_by_zaad_at IS NULL AND fully_executed_at IS NULL AND final_file_id IS NULL
  AND party_one_signing_token_hash IS NOT NULL AND party_one_signing_consumed_at IS NULL
  AND party_one_signing_expires_at IS NOT NULL;
INSERT INTO audit_logs(actor_account_id,actor_role,association_id,action,entity_type,entity_id,metadata)
SELECT owner.id,'ADMIN',p.association_id,'COVENANT_PARTY_ONE_LINK_EXTENDED','participation_agreements',g.id,
  jsonb_build_object('previousExpiresAt',b.row->'party_one_signing_expires_at','expiresAt',g.party_one_signing_expires_at,'durationDays',7,'tokenUnchanged',true,'mailQueued',false)
FROM participation_agreements g JOIN covenant_before b ON b.id=g.id JOIN project_participations p ON p.id=g.participation_id
JOIN accounts owner ON owner.public_code='ADM-000001'
WHERE b.row->'party_one_signing_expires_at' IS DISTINCT FROM to_jsonb(g)->'party_one_signing_expires_at';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM covenant_before b LEFT JOIN participation_agreements g ON g.id=b.id WHERE (to_jsonb(g)-'party_one_signing_expires_at') IS DISTINCT FROM (b.row-'party_one_signing_expires_at')) THEN RAISE EXCEPTION 'Unexpected agreement field change'; END IF;
  IF EXISTS (SELECT 1 FROM covenant_before b JOIN participation_agreements g ON g.id=b.id WHERE b.row->'party_one_signing_expires_at' IS DISTINCT FROM to_jsonb(g)->'party_one_signing_expires_at' AND (b.row->>'status'<>'SIGNED_BY_ORG' OR b.row->>'party_one_signing_consumed_at' IS NOT NULL)) THEN RAISE EXCEPTION 'Protected covenant changed'; END IF;
  IF EXISTS (SELECT id FROM outbox_events EXCEPT SELECT id FROM mail_before) THEN RAISE EXCEPTION 'Unexpected mail queued'; END IF;
END $$;
SELECT jsonb_build_object('changedCount',(SELECT count(*) FROM covenant_before b JOIN participation_agreements g ON g.id=b.id WHERE b.row->'party_one_signing_expires_at' IS DISTINCT FROM to_jsonb(g)->'party_one_signing_expires_at'),'verifiedAt',now(),'tokenUnchanged',true,'noMailQueued',true);
INSERT INTO system_settings(key,value,updated_at) SELECT 'COVENANT_LINK_WEEK_EXTENSION_20261025', jsonb_build_object('appliedAt',now(),'durationDays',7,'changedCount',(SELECT count(*) FROM covenant_before b JOIN participation_agreements g ON g.id=b.id WHERE b.row->'party_one_signing_expires_at' IS DISTINCT FROM to_jsonb(g)->'party_one_signing_expires_at'),'noMailQueued',true), timezone('UTC', now());
COMMIT;
