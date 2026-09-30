# One-time launch cleanup — trial data only

This tool is **not** a routine reset. It defaults to a read-only preview and
never runs automatically on Hostinger or Production. It is intentionally
limited to the known Alzad project and current Prisma tables. Unknown tables,
an unexpected ADMIN, changed data, a new application, FK cycles, a missing test
canary, or a failed preservation check stop execution before commit.

## Before any Production apply

1. Announce a maintenance window so no real applicant starts a draft. Do not
   modify intake settings merely to run this tool.
2. Verify the latest **encrypted** database-and-object backup actually arrived
   and can be decrypted and restored in an isolated database. A green GitHub
   Action alone is insufficient. Preserve its identifier and checksum.
3. Review this tool and its isolated CI integration run, including the FK order.
4. Run a preview with the approved Production `DATABASE_URL` supplied by a
   secret manager in the process environment (never as a command argument),
   `NODE_ENV=production`, `ALZAD_CLEANUP_EXPECTED_PROJECT_REF` set to the exact
   approved project ref and `ALZAD_CLEANUP_EXPECTED_DB_NAME` set to the exact
   database name. Use `--manifest=/absolute/protected/path.json` **outside the
   repository**. The path must not already exist. Example command:

   `node operations/cleanup/cleanup-trial-data.cjs --dry-run --manifest=/absolute/protected/cleanup-preview.json`

5. Inspect counts and public codes in the preview against the explicit trial
   inventory. The protected manifest contains object keys and must never be
   committed, emailed in plaintext, or placed in a public location.
6. Only after a separate human approval of that exact preview, set
   `ALZAD_CLEANUP_APPROVED_SHA256` to its printed SHA-256 and
   `ALZAD_CLEANUP_PRODUCTION_CONFIRM` to the tool's explicit production phrase,
   then run with `--apply` and the **same manifest path**. The tool rechecks
   every row fingerprint under table locks and aborts if anything changed since
   preview (including a newly submitted application). A failed transaction
   rolls back; do not retry by force.
7. Verify zero operational rows and the original ADMIN login/credentials,
   settings, reference data, geography, public-code counters, migrations,
   activities, and audit events. Audit actor/association foreign keys for deleted
   records become `NULL` under the existing database constraints; audit event
   content and count remain unchanged.
8. Database cleanup alone does **not** delete private object-storage content.
   Review the manifest's exact `(bucket, objectKey)` list and separately remove
   only those objects after verifying no surviving DB record references them.
   Never delete an entire bucket. Retained encrypted backups necessarily still
   contain the historical trial snapshot until retention expires.

For CI, `NODE_ENV=test`, explicit database-name allowlist, loopback DB URL,
`ALLOW_DESTRUCTIVE_E2E=true`, and a database-resident test canary are all
mandatory. The integration rehearsal runs after all other CI database tests;
it is not a Production rehearsal or authorization to apply there.
