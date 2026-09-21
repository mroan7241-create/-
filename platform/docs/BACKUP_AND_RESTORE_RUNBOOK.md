# Backup and restore — Alzad platform

This is an operational procedure, not evidence that backups have been enabled at Hostinger, Supabase, or any object-storage provider. The account owner must configure and monitor the provider-side schedules. Never commit a dump, object-storage copy, credential, or real environment file.

## Ownership and targets

The hosting/account owner is responsible for checking the backup job result every day and responding to a failed job the same day. Designate a named deputy before launch. Take one PostgreSQL backup daily and retain daily copies for the full project operating period (approximately five months), subject to available encrypted storage; alert before storage runs out. Back up the private object-storage bucket daily or enable provider versioning with protected retention. Keep both copies off the application server and in a different failure domain. Encrypt in transit (TLS) and at rest. Do not place production backups in a public bucket.

Provisional recovery targets, to be approved against provider capabilities: RPO up to 24 hours with daily backups; RTO up to 8 hours for database and object restoration. These are targets, not guarantees, until a timed rehearsal demonstrates them. Consider more frequent backups if 24-hour data loss is unacceptable.

Record the environment variable **names**, not values, in a restricted inventory: `DATABASE_URL` / `DIRECT_URL`, `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_FORCE_PATH_STYLE`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `SESSION_SECRET`, `RATE_LIMIT_HMAC_KEY`, `EMAIL_PROVIDER`, SMTP variables, `PUBLIC_WEB_URL`, and any deployment-specific signing keys. Keep secret values in a separate secure vault with tested account recovery. Never put a password in a script, shell history, command argument, log, or repository.

## PostgreSQL backup

Use PostgreSQL client tools matching the server major version. Run from a restricted workstation with a secure connection and `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, and `PGPASSWORD` supplied from a secret manager in the process environment. Confirm the target database name and host before connecting. Do not print the password or database URL. Choose a new explicit output path; never overwrite an older backup silently. PowerShell example (change only the destination to a protected backup directory):

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dump = Join-Path 'C:\protected-alzad-backups' "alzad-$stamp.dump"
if (Test-Path -LiteralPath $dump) { throw 'Backup destination already exists' }
pg_dump --format=custom --no-owner --no-acl --file "$dump"
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
Get-FileHash -Algorithm SHA256 -LiteralPath $dump
```

Store the SHA-256, timestamp, server/database identity (non-secret), dump size, and job result in an access-controlled log. Transfer the backup over TLS to encrypted off-host storage. A successful command and nonzero file size are necessary but not sufficient: compare the checksum after transfer and perform periodic isolated restores. Check that the backup includes the `prisma_migrations` table and expected application records.

## Private object storage

Enable bucket versioning where supported, or copy all objects and metadata to a separate private bucket/account daily. Preserve object keys, content type, encryption metadata, and version IDs when applicable. Use TLS and credentials restricted to the backup operation. Verify object count, sample or full object checksums, and a representative private file download. Do not publish or expose signed URLs in logs. Record the source bucket, backup destination, snapshot timestamp, counts, checksum method, and retention policy without recording secrets.

## Isolated restore rehearsal

Never restore over Production or into an unverified database. Create a **new, empty, explicitly named test database** in an isolated environment; verify host, port, database name and `NODE_ENV=test` before restore. Supply the restore database connection through `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, and `PGPASSWORD` from a test secret manager. The database must not share production credentials or endpoints. Restore without `--clean` or `--create`:

```powershell
pg_restore --exit-on-error --no-owner --no-acl --dbname "$env:PGDATABASE" 'C:\protected-alzad-backups\alzad-YYYYMMDD-HHMMSS.dump'
if ($LASTEXITCODE -ne 0) { throw 'pg_restore failed' }
```

Restore backed-up objects to a **different, private test bucket**. Point only the isolated test application at the restored database and bucket. Check migration history, key record counts, test-account login, private file retrieval, and association tenant isolation; never authenticate to Production during this rehearsal. If synthetic or appropriately authorized test accounts are not available, mark the login and tenant-isolation checks unverified rather than claiming success. Compare object count/checksum to the backup manifest. Measure elapsed restore time and record every error. Do not run destructive E2E cleanup against a restored production-data copy.

## Rehearsal record

| Date (UTC) | Isolated environment | PostgreSQL dump + checksum | DB duration/result | Objects duration/result | Migrations/counts | Login/private-file/tenant checks | Issues and owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-21 | Local PostgreSQL 16 on `127.0.0.1:55433`; source `alzad_platform_e2e`, new empty target `alzad_restore_test`; local S3rver test buckets | `alzad-backup-drill-20260921.dump`, 263737 bytes, SHA-256 `6691ae15553dee7da23d1732e930e9575641eff9c87ed6f7a71209318a142d99` | `pg_dump` 1.61 s; `pg_restore` 2.12 s, exit 0 | Synthetic private object copied to a separate test bucket and downloaded; 1/1 objects, SHA-256 `96910d2f6740d11ab9caf564849e0cf659894e04d6e638db7bc07b3ba99dcf0f` | 17/17 migrations; associations 25/25, accounts 13/13, beneficiaries 10/10, applications 0/0 at restore | Isolated login and cross-association beneficiary checks passed: 78/78 E2E after test reference-data seed | First beneficiary test run failed because the snapshot predated test reference-data seed (7 values vs. 151 after seed); added only synthetic test reference data to the restored DB and reran successfully. No real provider backup tested; provider schedule, off-host retention, and restore remain owner work. |

Operational completion requires the owner to configure real provider backups and perform and record a restore from those provider backups. A local synthetic rehearsal alone does not prove provider backup readiness. If access to the provider is unavailable, status is **يتطلب تنفيذًا تشغيليًا من مالك حساب الاستضافة**.
