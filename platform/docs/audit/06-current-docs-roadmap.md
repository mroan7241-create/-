# Audit 06 — Current Docs & Roadmap State (platform/docs)

Repo root: `C:\Users\mroan\OneDrive\Documents\الاجهزة الكهربائية\alzad-platform`
Docs dir: `platform\docs\` (path from Glob defaults to `platform/` as cwd)
Branch at audit time: `platform/node-migration` (clean, HEAD = `6fca768`)

Files found in `platform/docs/` (Glob `**/*`, 17 entries total):

1. AI_EXECUTION_PROTOCOL.md
2. ARCHITECTURE.md
3. ASSOCIATIONS.md
4. ASSOCIATION_APPLICATIONS.md
5. AUTHENTICATION.md
6. BENEFICIARIES.md
7. DATA_MODEL.md
8. ERD.mmd (Mermaid diagram, not markdown prose — referenced from DATA_MODEL.md, not read as text doc)
9. LEGACY_DATA_MIGRATION.md
10. LOCAL_DEVELOPMENT.md
11. SECURITY_MODEL.md
12. STATE_MAPPING.md
13. NODE-4_CONTRACT.md
14. CODEMAP.md
15. MIGRATION_ROADMAP.md
16. FEATURE_PARITY.md
17. HOSTINGER_TEST_DEPLOYMENT.md

**16 markdown files were read in full.** No files named exactly "FEATURE_PARITY.md"/"MIGRATION_ROADMAP.md" etc. were missing — all requested docs exist, plus AI_EXECUTION_PROTOCOL.md, DATA_MODEL.md, LOCAL_DEVELOPMENT.md, SECURITY_MODEL.md, CODEMAP.md, HOSTINGER_TEST_DEPLOYMENT.md which were not explicitly named in the task but discovered via Glob.

---

## Section 1 — Docs Inventory

| Doc | Domain | Status Claims | Key Decisions |
|---|---|---|---|
| **AI_EXECUTION_PROTOCOL.md** | Cross-cutting execution rules for every NODE-N/patch phase (not a feature doc) | N/A (meta-protocol, "reference — not overridden without explicit documented decision") | GitHub is sole source of truth; strict baseline SHA verification before each task; strict TypeScript; tenant isolation via AuthContext only (404 not 403 on cross-tenant); real DTO/Pipe runtime validation; all composite writes in `prisma.$transaction`; TOCTOU review mandatory; canonical (non-time-varying) idempotency payloads; files always private; compensating cleanup on upload-then-DB-fail; pagination bounds enforced; no N+1; no giant bootstrap; performance is an acceptance criterion; targeted tests during dev + full suite before commit; CI has final say on full regression; **no auto-start of next NODE phase**; honest/measured closing reports. |
| **ARCHITECTURE.md** | Overall platform architecture, governing rules, ACID operation catalogue, AutoAllocation design (not yet built), module boundaries | §4.1 "NODE-0.1 (تمّت/done)" — DB integrity hardening done. §4.2 "NODE-2" section done. Module table: `AuthModule`✅NODE-1, `ReferenceDataModule`✅NODE-1, `AuditModule`✅NODE-1; all others (`AccountsModule`, `AssociationsModule`, `ApplicationsModule`, `BeneficiariesModule`, `BeneficiaryNeedsModule`, `ReceiptsModule`, `InventoryModule`, `AllocationModule`, `DelegatesModule`, `DeliveriesModule`, `ActivitiesModule`, `FilesModule`, `SettingsModule`) listed as still FOUNDATION_READY/NOT_STARTED as of NODE-0 baseline text (superseded in later docs by NODE-2/3/4 progress — see MIGRATION_ROADMAP/FEATURE_PARITY for current truth). | "FEATURE PARITY FIRST" — legacy branch `claude/code-index-review-kz5k4u` @ `daa5e6d5d...` is the *only* reference for approved features; no future need (Procurement/RFQ, Main/Reserve, Basket, new Custody, new Scoring lifecycle, full Notification Engine, Closure workflow) counts as approved unless it exists in legacy. Real relational PostgreSQL model replaces flat Sheets. UUIDv7 PK (not v4) + separate `publicCode` for display. Real Postgres transactions replace legacy snapshot+manual-rollback. Durable `idempotency_keys` replace legacy 5-min `CacheService`. AutoAllocation NOT moved until NODE-5 — explicit per-association `pg_advisory_xact_lock` planned for when it does move. No Redis "for now" — DB-backed rate limiting/outbox suffice; re-evaluate at NODE-5/NODE-6 if an async queue is actually needed. |
| **ASSOCIATIONS.md** | Association management (NODE-2): list/create/update/self-settings/password reset | Fully implemented as of NODE-2/NODE-2.1/NODE-2.2 (phone search, query validation, page cap, sort whitelist) | Legacy free-text partial phone search narrowed to normalized full-match (documented deviation). `progress` sort field deliberately deferred (would be a fake always-zero metric — depends on unmigrated device data). Grandfathering rule tightened vs legacy (can't swap one invalid value for another invalid combo — deviation, documented). Association contact email ≠ login email (deliberate, documented in code+tests). Temporary password fingerprinted via HMAC in idempotency payload (security correction, NODE-2.1). |
| **ASSOCIATION_APPLICATIONS.md** | Public association-application intake + admin review (NODE-2) | Fully implemented; state machine `UNDER_REVIEW → ACCEPTED\|REJECTED` only — explicitly states no DRAFT/SUBMITTED/ELIGIBLE/SCORED/MAIN_LIST etc. "does not exist and will not be added" because legacy has none. | Strict calendar-date validation (rejects JS's silent date rollover, e.g. `2026-02-31`) — new hardening, NODE-2.1. Temp password NOT re-showable on idempotent replay (deliberate deviation from legacy's CacheService-retrievable password — documented). `sortBy`/`sortDir` explicitly NOT implemented for applications list because legacy source doesn't call `applySort_` for this list (verified against source) — contrasts with Associations list which does sort. |
| **AUTHENTICATION.md** | Auth/sessions/roles/tenant context (NODE-1, patched NODE-1.1/1.2) | Fully implemented, "مكتمل" per roadmap | Opaque server-side sessions (no JWT) — architecturally mandated. Argon2id only (no SHA-256/bcrypt for new credentials). O(1) delegate login via HMAC lookup hash (NODE-1.1 fix, was O(n) full scan in NODE-1). Session cookie lifetime fixed to bind to absolute 12h cap not sliding 6h (NODE-1.1 bug fix). Reset-token hashing upgraded to HMAC (NODE-1.1, low-entropy 8-digit code needed keyed hash). Production secret validation hardened to 4 conditions incl. min 32-byte length and mutual distinctness (NODE-1.2). **No legacy password import in NODE-1** — deferred explicitly to NODE-8. **No production email provider** — deferred, dev/fake only. |
| **BENEFICIARIES.md** | Beneficiaries + needs + individual/bulk review (NODE-3, patched NODE-3.1/3.2/3.3) | Fully implemented; AutoAllocation explicitly NOT migrated (NO-OP trigger only, real engine = NODE-5) | Composite-FK tenant isolation enforced at DB level. `address`/`landmark` intentionally demoted to read-only legacy fields (deliberate user-directed deviation from legacy which accepted them as live input). Location `both-or-neither` coordinate rule; "absence ≠ clear" semantics fixed via canonicalized idempotency intent (NODE-3.2, bug fix). Phone-duplicate-check race condition closed via Postgres advisory locks (NODE-3.1). "جاهز للإحالة" (ready-for-referral) filter explicitly deferred — would require NODE-4/6 allocation+delivery data, refused to build a fake version. Bulk review: NO-OP `AllocationTriggerPort`, one call per unique association after batch commit (Patch 3.2A.1 semantics preserved). |
| **DATA_MODEL.md** | Full relational schema description (Prisma schema is canonical source) | 24 entities total; describes NODE-0/0.1/1/2 additions | UUID PK always, `publicCode` never used as FK. Composite FKs `(id, associationId)` prevent cross-tenant record linkage at DB level. Partial unique indexes for `device_allocations` (one ACTIVE allocation per device/need), `reference_values` root/child dedup, pending-application email/phone/license. `DeviceType` unified enum across 3 tables with `legacyDeviceTypeText` archival fallback. `outbox_events` has 3 illustrative event types only, **no consumer implemented yet** — explicitly "لا Notification Engine كامل الآن". |
| **LEGACY_DATA_MIGRATION.md** | Design-only doc for future legacy Google Sheets → Postgres import | **Explicitly "تصميم فقط، لا استيراد بيانات حقيقية الآن"** — design only, no real import has happened or will happen before NODE-8 | Direct production Google Sheets access is explicitly forbidden through NODE-8. Legacy passwords/delegate codes will NOT be imported (raw or old-hash) — default plan is forced `mustChangePassword=true` for all imported accounts; a rehash-on-first-login fallback is a documented alternative, decision deferred to NODE-8. `public_code_counters` reconciliation (MAX-based) is called a **blocking** requirement for NODE-8, not optional. |
| **STATE_MAPPING.md** | Legacy Arabic status strings → internal enums, for every state machine in the system | Documents 12 state machines; marks which are actually implemented ("منفَّذ فعليًا في NODE-2/NODE-3/NODE-4") vs which remain designed-only pending later NODE phases | Application/Association/Beneficiary-Review/Need-Decision transitions are simple; Need-Fulfillment has 10 states/most complex transition table — **only `APPROVED_ENTITLEMENT` is actually written today (NODE-3)**; the other 9 states require inventory/custody/delivery data not migrated until NODE-4/NODE-5/NODE-6. Device status (5 states) and Delivery status (5 states) tables are fully specified but their write-paths are NOT_STARTED (custody/delivery = NODE-6). Receipt Batch transitions ✅ NODE-4 implemented literally. |
| **NODE-4_CONTRACT.md** | Receipt batches + files + device inventory (read) — full contract for NODE-4/4.1/4.2 | Marked "منجزة" (done) for NODE-4, NODE-4.1, NODE-4.2 in the roadmap; this doc itself is the detailed contract | Explicit "خارج النطاق" (out of scope) list: no real AutoAllocation (NODE-5), no delegates/delivery (NODE-6), no DamageCase downstream workflow, no procurement/RFQ/PO, no Excel/CSV import for receipts, no general system_settings UI. `saveDevice` write path (link/unlink/bulk-complete device to need) explicitly deferred — inventory module is READ-ONLY in NODE-4; full device lifecycle enrichment (movements, allocation, custody) intentionally NOT built as a "fake" partial version — waits for real NODE-5/NODE-6 data. |
| **CODEMAP.md** | Quick reference map of code locations per domain, "محدَّث حتى NODE-4.2" | Explicitly lists `DelegatesModule`/`DeliveriesModule`/`ActivitiesModule` as **"لم تُنقَل بعد (NODE-6/لاحقًا)" — only `_module-status` placeholder exists** | Confirms backend module-to-path mapping and that NODE-4 required zero new Prisma migrations except NODE-4.2's one append-only migration. |
| **MIGRATION_ROADMAP.md** | The master phase roadmap: NODE-0 through NODE-10 + NEEDS_DECISION log | NODE-0 through NODE-4.2: all marked complete ("مكتمل"/"✅ منجزة"). **NODE-5 through NODE-10: descriptions only, zero implementation status — these are pure forward-looking planning paragraphs with no "مكتمل" marker.** | This is the authoritative phase-by-phase plan (see Section 3 below for full text of NODE-5/6/7 descriptions). 8 unresolved `NEEDS_DECISION` items logged (bootstrap-data pattern, staging cleanup cron vs lazy, Drive file migration strategy, cutover timeline/owner, object storage provider choice, license-file retention policy, npm audit debt). |
| **FEATURE_PARITY.md** | The master 32-endpoint parity matrix vs legacy `Index.html` | Explicit legend: `NOT_STARTED` / `FOUNDATION_READY` / `MIGRATED` / `PARITY_VERIFIED` (last one **used zero times anywhere in the codebase**). As of "بعد NODE-4": FOUNDATION_READY=1, NOT_STARTED=16, MIGRATED=24, PARITY_VERIFIED=0, total=41 rows. | Deliberately never claims `PARITY_VERIFIED` — team draws a hard line between "code-level behavior match + automated tests" (MIGRATED) and "live side-by-side run against the actual Apps Script system" (PARITY_VERIFIED), stating the latter comparison has literally never been performed because there's no access to a live Apps Script environment from these sessions. `getBootstrapData` deliberately kept `NOT_STARTED` — independent REST endpoints chosen over monolithic bootstrap. `saveDevice` remains counted `NOT_STARTED` overall even though its read-half migrated, because link/unlink/bulk-complete (its majority) has not. |
| **HOSTINGER_TEST_DEPLOYMENT.md** | TEST-only deployment recipe for Hostinger shared/managed Node hosting (commits HOSTINGER-TEST-0 through 0.5) | Explicitly: **"لم يُنفَّذ أي نشر Production ولن يُنفَّذ من هذه الجلسة" / "هذا لبيئة TEST حصرًا"** — no production deploy has occurred | Root-level `package.json` + `hostinger-app.js` dispatcher added purely as a Hostinger-compatibility shim; real app stays under `/platform`. API runs in-process via `require()` of built `dist/main.js` (no child_process spawn) — a documented fix after `EADDRINUSE` problems with spawning children. Web serves via Next.js `output: 'standalone'` (switched from an earlier hand-rolled custom server after that approach returned persistent 503s live on Hostinger despite working locally). Supabase Postgres via **Session Pooler port 5432 only** (not Transaction Pooler 6543) because Prisma needs stable sessions for transactions/advisory locks used throughout the app. No secrets, hostnames, or credentials are real anywhere in this doc. |
| **LOCAL_DEVELOPMENT.md** | Dev environment setup, Docker Compose, seed data | Operational doc, not a feature-status doc | Node 24 LTS required (`engines.node >=24.0.0`); notes that the authoring session itself only had Node 22 available and typecheck/lint/test/build still passed (EBADENGINE warning only, not a failure) — flagged as a deviation from official requirement, not silently ignored. Seed script creates 1 ADMIN, 2 test associations w/ delegates, 1 beneficiary each — explicitly "لا بيانات شخصية حقيقية إطلاقًا" (no real PII). |
| **SECURITY_MODEL.md** | Security model: roles, tenant isolation, auth, files, idempotency-as-security, audit, validation, secrets | Documents NODE-1/NODE-2 security posture; explicit "ما لم يُنفَّذ بعد" section | States plainly: tenant isolation on business domains (beneficiaries/devices/receipts...) is **not yet implemented** for modules that are themselves still NOT_STARTED/FOUNDATION_READY — the isolation *principle* is established/tested for what exists (NODE-1/2), but is a target to be met per-domain as each NODE phase lands, not a blanket completed guarantee. Production email provider and legacy password import both explicitly deferred. Production object-storage bucket policy explicitly untested with real credentials. |

---

## Section 2 — Full Commit Timeline

Full `git log --oneline --all` (99 commits total), newest → oldest. Legacy Google Apps Script phase names (Phase N / Patch N) run through `daa5e6d` before the Node.js migration begins at `fd47dbd` (NODE-0).

| Commit | Message | Inferred Domain/Phase |
|---|---|---|
| `6fca768` | HOSTINGER-TEST-0.5: serve Web via Next.js standalone output, not a hand-rolled custom server | Deploy tooling — Hostinger TEST fix |
| `1d2c470` | HOSTINGER-TEST-0.4: run Web in Hostinger-managed process | Deploy tooling — Hostinger TEST fix |
| `c1fbec6` | HOSTINGER-TEST-0.3: run API in-process instead of spawning a child | Deploy tooling — Hostinger TEST fix |
| `ae7ec0d` | HOSTINGER-TEST-0.2: honor Hostinger-managed PORT for API and Web | Deploy tooling — Hostinger TEST fix |
| `70211e8` | HOSTINGER-TEST-0.1: install devDependencies during Hostinger postinstall | Deploy tooling — Hostinger TEST fix |
| `c459cd3` | HOSTINGER-TEST-0: minimal root deployment adapter for Hostinger TEST | Deploy tooling — Hostinger TEST bootstrap |
| `e9001c6` | NODE-4.2.1: تصحيح fixtures NODE-4/4.2 — filename/contentType يطابقان محتوى buffer فعليًا | NODE-4.2 — test fixture correction |
| `9c11f45` | NODE-4.2: إغلاق محاضر الاستلام (رقم مستند، إثبات شراء إداري، محضر/ختم الجمعية، صور تلف متعددة حقيقية) | NODE-4.2 — receipt batch closure |
| `9871558` | NODE-4.1: تصليب محاضر الاستلام + المخزون (replay/multipart/MIME/spec/أداء/واجهة) | NODE-4.1 — hardening patch |
| `3717638` | NODE-4: محاضر استلام دفعات الأجهزة + مخزون الأجهزة (قراءة) | NODE-4 — receipt batches + inventory (read) |
| `cdc19ce` | NODE-3.3: reject partial lat/lng pairs with a single shared classifier | NODE-3.3 — beneficiary location patch |
| `63b0776` | NODE-3.2: تصحيح بصمة idempotency لنيّة الموقع (PRESERVE/CLEAR/SET) | NODE-3.2 — idempotency fix |
| `865fde3` | NODE-3.1: سدّ فجوات المستفيدين بعد NODE-3 (موقع، تنبيه تكرار محتمل، أمان تزامن الجوال) | NODE-3.1 — beneficiary gap-closing patch |
| `34a791c` | NODE-3: المستفيدون واحتياجاتهم والمراجعة الفردية والجماعية | NODE-3 — beneficiaries + needs + review |
| `d196632` | NODE-2.2: تحصين حدّ page الأعلى ضد skip غير محدود | NODE-2.2 — pagination hardening |
| `6d09f7f` | NODE-2.1: تكافؤ الجمعيات + تحصين مدخلات الـAPI | NODE-2.1 — associations parity + input hardening |
| `aabb021` | NODE-2: طلبات انضمام الجمعيات + إدارة الجمعيات | NODE-2 — applications + association mgmt |
| `0af7613` | NODE-1.2: Production Secret Validation Hardening | NODE-1.2 — secret validation patch |
| `39b033c` | NODE-1.1: Auth Security & Session Correctness Patch | NODE-1.1 — auth/session bugfix |
| `e3f5875` | NODE-1: Authentication + Sessions + Roles + Reference Data | NODE-1 — auth foundation |
| `c694665` | NODE-0.1: Database Integrity Hardening | NODE-0.1 — DB integrity |
| `fd47dbd` | NODE-0: تأسيس منصة Node.js/NestJS/Next.js/PostgreSQL المستقلة | **NODE-0 — Node.js migration platform bootstrap (start of Node migration)** |
| `daa5e6d` | Patch 3.2A.1: تجميع تشغيل AutoAllocation لكل جمعية في bulkReviewBeneficiaries | **Legacy Apps Script — last legacy commit, cited as the parity baseline SHA throughout all NODE docs** |
| `719dcdb` | Phase 3.2A: واجهة مراجعة واعتماد المستفيدين (فردي + بالجملة) | Legacy — beneficiary review UI |
| `e81db33` | Phase 3.1.2a: Allocation Tie-Break Closure | Legacy — allocation tie-break |
| `0a3574a` | Phase 3.1.2: Global Allocation Objective Closure | Legacy — allocation objective |
| `d1bcdbe` | Phase 3.1.1: Allocation and Receipt Integrity Closure | Legacy — allocation/receipt integrity |
| `5ac0f32` | Phase 3.1: Receipt Batches and Automatic Allocation Core | Legacy — receipt batches + AutoAllocation core |
| `212d263` | Phase 2.3.4: Legacy Beneficiary Edit Closure | Legacy — beneficiary edit closure |
| `c5b8e87` | Phase 2.3.3: Final Lifecycle Invariants and Success-Response Closure | Legacy — lifecycle invariants |
| `6524a04` | Phase 2.3.2: True Commit Boundary and Unified Device-Need Transaction | Legacy — transaction boundary |
| `fd0bff5` | Phase 2.3.1: Transaction Safety and Lifecycle State Closure | Legacy — transaction safety |
| `f21f735` | Phase 2.3 (تصحيح): assignDelegate يعيّن فقط | Legacy — delegate assignment correction |
| `6f220f0` | Phase 2.3: إغلاق كل منافذ الدخول القديمة وفرض دورة الاعتماد المعتمدة | Legacy — close old entry points, enforce approval cycle |
| `28a3b8a` | Phase 2.2: إدخال ذرّي للمستفيد، تكامل الاستحقاق | Legacy — atomic beneficiary entry |
| `f9b39eb` | Phase 2.1: تصليب وتكامل — قفل متداخل، سباق تزامن | Legacy — concurrency hardening |
| `a4c2dad` | Phase 2: منطق خادم اعتماد المستفيد والاحتياج | Legacy — beneficiary/need approval server logic |
| `b4b2222` | Phase 1: مصدر حقيقة مركزي لحالات مراجعة المستفيد | Legacy — central state source of truth |
| `dfbd6c7`…`d5953e3` (61 commits) | Various — login screen redesigns, RTL/branding, security audits, Excel import, activities dashboard, geolocation, performance passes, etc. | **Pre-"Phase" legacy Apps Script development** (unnumbered iterative commits, earliest = `d5953e3` "بداية المستودع" / repo start) |

**Summary of naming convention**: The repo has two eras. (1) Legacy Google Apps Script era — unnumbered commits, then formalized into `Phase N[.M]` / `Patch N.M` labels starting at `b4b2222` (Phase 1) through `daa5e6d` (Patch 3.2A.1), which is the frozen baseline all NODE docs cite as "الفرع القديم" reference commit. (2) Node.js migration era — `NODE-N[.M]` labels starting at `fd47dbd` (NODE-0) through `e9001c6` (NODE-4.2.1), followed by a separate `HOSTINGER-TEST-0[.M]` sub-track for deployment tooling only (not a feature-parity phase).

---

## Section 3 — NODE-5/6/7 Status

**Explicit finding: NODE-5, NODE-6, and NODE-7 have ZERO implementation in this repository as of HEAD (`6fca768`). No commit, branch, tag, or code path with these labels exists anywhere in git history (`git log --oneline --all` searched, 99 commits total, none named NODE-5/6/7).**

Evidence:

- `git log --oneline --all | grep -i "NODE-5\|NODE-6\|NODE-7"` → no matches. The highest implemented Node-migration commit is `e9001c6` (NODE-4.2.1), followed only by the `HOSTINGER-TEST-0.x` deployment-tooling track (unrelated to feature phases).
- **MIGRATION_ROADMAP.md** describes NODE-5, NODE-6, NODE-7 (and NODE-8/9/10) purely as forward-looking planning paragraphs, with **no "مكتمل"/"✅ منجزة" completion marker** — contrast this with every phase NODE-0 through NODE-4.2 which is explicitly marked complete in the same file:
  - **NODE-5 — "AutoAllocation parity migration"**: planned scope is migrating `AutoAllocation.gs`'s algorithm unchanged, requiring a global-maximization test matching the old `phase31-test.js`/`phase31.2-test`, plus adding a per-association `pg_advisory_xact_lock`. Zero code exists; only a NO-OP `AllocationTriggerPort` stub (built in NODE-3) is wired to call into it later.
  - **NODE-6 — "Delegates + assignments + delivery attempts"**: planned scope is `saveDelegate`/`setDelegateStatus`/`regenerateDelegateCode`, `assignDelegate` (assignment stage only), `confirmDelivery`/`retryDelivery`/`updateDeliveryStatus`, `listBeneficiaryDeliveryAttempts`/`getDeliveryProofImage`. CODEMAP.md confirms: `DelegatesModule`/`DeliveriesModule`/`ActivitiesModule` "لم تُنقَل بعد (NODE-6/لاحقًا) — `_module-status` فقط" (not migrated yet, status-placeholder endpoint only).
  - **NODE-7 — "Activities + dashboard + audit"**: planned scope is `getActivitiesBundle`/`saveActivity`, `listDelegateAuditLog`, `getPortalBundle` (redesigned as independent endpoints rather than a giant bundle — noted as a still-open NEEDS_DECISION). FEATURE_PARITY.md marks `getActivitiesBundle` as `FOUNDATION_READY` (module/table skeleton exists, no real logic) and `saveActivity`/`listDelegateAuditLog`/`getPortalBundle` as `NOT_STARTED`.
- **FEATURE_PARITY.md** totals table (41 rows) shows only 1 `FOUNDATION_READY` row and 16 `NOT_STARTED` rows — every row belonging to delegate/delivery/activity/dashboard functionality (i.e., NODE-6/7 scope) is in one of these two non-implemented buckets, never `MIGRATED`.
- **STATE_MAPPING.md** §7 (Need Fulfillment) and §8 (Device)/§9 (Delivery) explicitly say the 9 non-`APPROVED_ENTITLEMENT` fulfillment states, and the device/delivery status write-paths, are not yet written — "تُكتب في NODE-4/NODE-5" and custody/delegate transitions belong to NODE-6.
- **NODE-4_CONTRACT.md** explicitly excludes NODE-5/6 scope: "لا AutoAllocation حقيقي (NODE-5)"، "لا مندوبين/تسليم (NODE-6)".
- **ARCHITECTURE.md** §4 and §7 both state the AutoAllocation engine move and any Redis/queue re-evaluation are pushed to "NODE-5/NODE-6" without commitment to timing.
- **LEGACY_DATA_MIGRATION.md** references NODE-8 (legacy data import), and MIGRATION_ROADMAP.md defines NODE-8 (importer/reconciliation), NODE-9 (full parity testing/UAT), NODE-10 (cutover planning) — these too are pure planning prose with no implementation, consistent with NODE-5/6/7 being unstarted (the roadmap is sequential and nothing past NODE-4.2 has begun).

**Conclusion**: NODE-5, NODE-6, and NODE-7 are fully unstarted — planning/spec text only in MIGRATION_ROADMAP.md (plus scattered forward-references in other docs describing what they will *eventually* cover), zero commits, zero modules with real logic, zero endpoints beyond placeholder `_module-status`. The furthest-progressed phase in the entire repository is **NODE-4.2 / NODE-4.2.1** (receipt batches, files, device inventory read-path), immediately followed only by the unrelated `HOSTINGER-TEST-0.x` deployment-tooling commits.

---

## Section 4 — All TODO/NOT_STARTED/FOUNDATION_READY markers found across docs

- **FEATURE_PARITY.md**, table rows (line refs approximate to table row order in file):
  - `Bootstrap.gs::getBootstrapData` → `NOT_STARTED` (deliberate, deferred design decision)
  - `DevicesAssociations.gs::saveDevice` → `NOT_STARTED` (only its read-half is MIGRATED under NODE-4)
  - `DevicesAssociations.gs::assignDelegate` → `NOT_STARTED` (NODE-6 scope)
  - `DevicesAssociations.gs::saveDelegate` → `NOT_STARTED` (NODE-6 scope)
  - `DevicesAssociations.gs::setDelegateStatus` → `NOT_STARTED` (NODE-6 scope)
  - `DevicesAssociations.gs::regenerateDelegateCode` → `NOT_STARTED` (NODE-6 scope)
  - `Beneficiaries.gs::downloadBeneficiaryImportTemplateXlsx` → `NOT_STARTED`
  - `Beneficiaries.gs::inspectBeneficiaryExcel` → `NOT_STARTED`
  - `Beneficiaries.gs::importBeneficiaries` → `NOT_STARTED`
  - `ReceiptBatches.gs::retryDelivery` → `NOT_STARTED` (NODE-6 scope)
  - `ReceiptBatches.gs/DevicesAssociations.gs::updateDeliveryStatus` → `NOT_STARTED` (NODE-6 scope)
  - `ReceiptBatches.gs::listBeneficiaryDeliveryAttempts` → `NOT_STARTED` (NODE-6 scope)
  - `ReceiptBatches.gs::getDeliveryProofImage` → `NOT_STARTED` (NODE-6 scope)
  - `DevicesAssociations.gs::listDelegateAuditLog` → `NOT_STARTED` (NODE-7 scope)
  - `ActivitiesAndDashboard.gs::getActivitiesBundle` → `FOUNDATION_READY` (the one and only FOUNDATION_READY row in the whole matrix; NODE-7 scope)
  - `ActivitiesAndDashboard.gs::saveActivity` → `NOT_STARTED` (NODE-7 scope)
  - `DevicesAssociations.gs::getPortalBundle` → `NOT_STARTED` (NODE-7 scope, dashboard aggregation)
  - Global note: **`PARITY_VERIFIED` used 0 times anywhere in the matrix** — every "done" row tops out at `MIGRATED`.
- **ARCHITECTURE.md** §6 (module boundary table): originally listed most modules as FOUNDATION_READY/NOT_STARTED as of the NODE-0 baseline text of the doc (`AccountsModule`, `AssociationsModule`, `ApplicationsModule`, `BeneficiariesModule`, `BeneficiaryNeedsModule`, `ReceiptsModule`, `InventoryModule`, `AllocationModule`, `DelegatesModule`, `DeliveriesModule`, `ActivitiesModule`, `FilesModule`, `SettingsModule`) — this section of the doc was not rewritten as later NODE phases landed real logic into several of these modules; MIGRATION_ROADMAP.md/FEATURE_PARITY.md are the more current source of truth for per-module status.
- **CODEMAP.md**: `DelegatesModule`/`DeliveriesModule`/`ActivitiesModule` explicitly "لم تُنقَل بعد (NODE-6/لاحقًا) — `_module-status` فقط".
- **NODE-4_CONTRACT.md**, "استثناءات صريحة (خارج النطاق)" section: no real AutoAllocation (NODE-5), no delegates/delivery (NODE-6), no DamageCase downstream workflow, no procurement/RFQ/PO, no Excel/CSV import for receipts, no general `system_settings` UI.
- **NODE-4_CONTRACT.md**, "تصحيح نطاق saveDevice/getDeviceDetail": device link/unlink/bulk-complete custody writer explicitly deferred to NODE-5/NODE-6; full device lifecycle enrichment (movements/allocation/custody) "معلَّق صراحةً" pending NODE-5/6 data.
- **BENEFICIARIES.md** §11 "خارج نطاق NODE-3 صراحة": bulk Excel/CSV import, `assignDelegate`, `updateBeneficiaryLocation`, device inventory/custody/delivery (NODE-4), real AutoAllocation engine (NODE-5).
- **BENEFICIARIES.md** §13 "جاهز للإحالة" filter: explicitly deferred, "لم تُبنَ نسخة وهمية منه" (refused to build a fake version) — waits on NODE-4/6 allocation+delivery data.
- **STATE_MAPPING.md** §7 (Need Fulfillment): 9 of 10 states ("AWAITING_DEVICE" through "DELIVERED" minus `APPROVED_ENTITLEMENT`) not yet written — depend on NODE-4/NODE-5 inventory/allocation data.
- **STATE_MAPPING.md** §8 (Device status) / §9 (Delivery status): full transition tables specified but write-paths belong to NODE-6 (custody/delegate/delivery).
- **DATA_MODEL.md** §10: `outbox_events` — "لا Notification Engine كامل الآن" (no consumer implemented), 3 event types are illustrative placeholders only.
- **AUTHENTICATION.md** §4/§10: "لا استيراد لكلمات مرور Production القديمة في NODE-1" (deferred to NODE-8); "لا مزوّد بريد إنتاجي حقيقي متصل في NODE-1" (production email provider deferred, unscheduled).
- **LEGACY_DATA_MIGRATION.md**: entire document is prospective design, explicitly "لا استيراد بيانات حقيقية الآن", real import work belongs to NODE-8 which itself has not started.
- **SECURITY_MODEL.md**, "ما لم يُنفَّذ بعد" section: tenant isolation on business domains not yet implemented for modules that are themselves NOT_STARTED/FOUNDATION_READY; production email provider and legacy password import deferred; production object-storage bucket policy untested with real credentials.
- **MIGRATION_ROADMAP.md**, NEEDS_DECISION log (8 open items, none resolved): (1) `getBootstrapData` monolithic-bootstrap-vs-REST pattern for remaining domains — undecided; (3) staging-file cleanup strategy (cron vs lazy) — undecided; (4) Google Drive real file migration tooling for NODE-8 — undecided/undesigned; (5) Cutover (NODE-10) timeline/owner — pure human decision, unscheduled; (6) production object-storage provider choice — undecided; (7) rejected-application license file retention policy — undecided; (8) `npm audit` dependency debt (24→28 findings after S3/multer/s3rver additions) — unaddressed, no `npm audit fix --force` run.

---

## Summary for final report

- **16 markdown docs found and read in full** in `platform/docs/` (plus 1 non-markdown `ERD.mmd` diagram file referenced but not required reading), matching/exceeding every doc named in the task plus 6 extra discovered ones (AI_EXECUTION_PROTOCOL, DATA_MODEL, LOCAL_DEVELOPMENT, SECURITY_MODEL, CODEMAP, HOSTINGER_TEST_DEPLOYMENT).
- **Furthest-progressed phase in git history**: `NODE-4.2.1` (commit `e9001c6`, "تصحيح fixtures NODE-4/4.2"), i.e., the receipt-batches/files/device-inventory-read domain, immediately followed by the unrelated `HOSTINGER-TEST-0` through `HOSTINGER-TEST-0.5` deployment-tooling commits (current HEAD `6fca768`). No feature-phase work exists past NODE-4.2 series.
- **NODE-5/6/7**: confirmed **fully unstarted** — zero commits, zero implemented modules, zero real endpoints anywhere in git history or the docs. They exist only as planning prose in `MIGRATION_ROADMAP.md` (with explicit forward-references from `ARCHITECTURE.md`, `NODE-4_CONTRACT.md`, `STATE_MAPPING.md`, `BENEFICIARIES.md`, `FEATURE_PARITY.md`, `CODEMAP.md`) describing scope not yet begun. NODE-8/9/10 (legacy import, full parity/UAT, cutover) are likewise pure roadmap text with no implementation, consistent with the strictly sequential nature of this migration.
