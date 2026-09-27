# Encrypted daily backup — operational activation required

Scheduled backups are disabled unless `BACKUP_ENABLED=true`. A manual dispatch with `initial_verification=true` permits the approved first backup/restore/delivery check while the schedule remains disabled. Code/tests are not evidence of a successful Production backup. Do not enable the schedule until secrets, PostgreSQL client availability, first delivery and isolated restore have been verified. No application code, schema, migration or Hostinger configuration is changed by these files.

## Schedule and cost

Daily cron `0 3 * * *` means approximately 06:00 Asia/Riyadh. GitHub may delay or drop schedules (particularly at the top of the hour), and disables scheduled workflows in inactive public repositories after 60 days. The owner must monitor Actions and daily mailbox receipt; this is not an exact-time or 100% availability guarantee. The repository currently is public: standard Ubuntu GitHub-hosted runners are free, no paid runner/storage/service is enabled, and no artifacts or backup caches are uploaded. If repository visibility changes, reassess billing before continuing.

## Approved destinations and access

Only recipient: `marwanalsawi@alzaad.org.sa`, through the already configured SMTP provider. No redirectable recipient or public download URL. Create GitHub environment `production-backup`, restrict its deployment branch to `platform/node-migration`, and add environment secrets `ALZAD_BACKUP_CONFIG` (JSON) and `BACKUP_PUBLIC_KEY` (RSA public PEM). Never add a private recovery key to GitHub. Keep secrets unavailable to pull-request/test/install steps; do not enable debug logging.

Configuration JSON fields (names only): `DATABASE_URL` (direct or session pooler, not transaction pooler), `EXPECTED_DB_HOST`, `EXPECTED_DB_NAME`, `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_FORCE_PATH_STYLE`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`. Copy actual approved values through secure settings, never commit or print them. Prefer dedicated read-only DB/object credentials; do not weaken network restrictions or automatically create privileged access.

## Scope and safety

Custom pg_dump of public schema, including application data and Prisma migration history; read-only session, TLS, bounded command, no seed/migration/SQL delete. Every dump must actually restore successfully in its own disposable PostgreSQL 18 container with **no network**, no Production credentials, and a read-only dump mount before email is sent. Technical policy roles are created only inside that container. Restored table counts and migration presence are recorded inside the encrypted manifest; this is not a full application/portal acceptance test. Only that uniquely named container and its volumes are removed afterwards. The official PostgreSQL image and Actions are pinned to verified digests/commits.

Private bucket objects, keys and content metadata are collected separately, ETag/size/checksum verified. Fails if listing changes mid-copy. DB and object storage have **no shared atomic snapshot**; validate references during recovery. No PostgreSQL role passwords, Supabase internal schemas, service secrets or deployment settings included: preserve those separately in an approved secure vault. The manifest and clear data are inside RSA-OAEP + AES-256-GCM encrypted archive. Encrypted archive is split into exact 8 MiB numbered email attachments; save all parts and full-file SHA256. A 64 MiB total limit rejects oversized backups before the first email, preventing hundreds of messages or silent mail/storage purchases. Larger backups require an owner-approved retention/delivery solution. SMTP acceptance is not Inbox delivery proof. Partial email delivery is failure; do not mix parts from different identifiers.

## Owner key custody

Create an owner-only external directory, run `node operations/backup/recovery.mjs generate-keys DIRECTORY`. Preserve `recovery-private.pem` offline in at least two owner-controlled protected locations. Do not email it alongside backups, commit it, or put it in GitHub Secrets. Losing it makes backups unreadable. Only `encryption-public.pem` is uploaded to GitHub. Retain all daily email parts for five months and monitor mailbox capacity. No automatic mailbox deletion or paid storage expansion.

## Verification and restore — never over Production

1. Run `node --test operations/backup/backup.test.mjs` (synthetic fixtures, no DB/SMTP connection).
2. Confirm client version is not older than server and environment branch restrictions/secrets, then manual dispatch only from Production branch with `initial_verification=true`; leave `BACKUP_ENABLED` unset until this check succeeds.
3. Verify actual recipient receipt of every part, timestamp/identifier, and encrypted full-file checksum. Action result `SMTP_ACCEPTED` alone is insufficient.
4. Download parts locally. `node operations/backup/recovery.mjs decrypt PRIVATE_KEY OUTPUT.tar.gz PART1 PART2 ...` authenticates all bytes before writing; never overwrites output, never restores automatically. For archives too large for workstation memory use a reviewed streaming recovery tool instead.
5. Extract archive into a new protected directory. Validate database dump and all object hashes from manifest. Use an isolated empty PostgreSQL database on loopback with a test-only name, **not any production URL/credential**. `pg_restore --exit-on-error --no-owner --no-acl --dbname TEST_DATABASE database.dump`; no `--clean`, no Production target.
6. Restore objects into a separate private isolated test bucket preserving keys/content type. Verify migration/table counts, file references, private file access, login and tenant isolation without triggering email or operational schedulers. Never run destructive E2E cleanup on restored real data.
7. Record UTC date, source backup identifier/checksum, isolated environment, duration, record/object counts, validation results, limitations and responsible owner. Activation is not complete until this evidence exists.

## Current status

Nine synthetic crypto/config/mail-boundary/isolation/cleanup tests passed locally. Environment `production-backup` restricts access to `platform/node-migration`; the existing Hostinger settings were copied into its encrypted configuration secret without changing Hostinger. The public encryption key is stored there; the private key remains in an owner-restricted external local directory, not in GitHub. Local Docker is unavailable; the real synthetic dump/restore gate will run on the existing free GitHub runner. No Production export, actual email-backup receipt, restored Production snapshot or schedule activation yet. Existing 06:00 digest is an operational report, not this backup. No paid service was purchased.
