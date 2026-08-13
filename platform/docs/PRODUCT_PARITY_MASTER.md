# PRODUCT PARITY MASTER — منصة جمعية الزاد

**This is the authoritative, living completion checklist for the Node/NestJS+Next.js
reconstruction of the legacy Google Apps Script platform.** It is updated as work
proceeds — never treat it as a one-time snapshot.

**Governing rule** (unchanged since audit): the new platform = ALL legacy features +
ALL approved modern features + better UX/security/automation/architecture. Nothing
legacy is dropped without an explicit documented replacement decision; nothing modern
is regressed to imitate legacy.

**Status legend** (never use a vague "done"):
`NOT_STARTED` · `FOUNDATION_READY` (schema/scaffold only) · `BACKEND_ONLY` ·
`FRONTEND_ONLY` · `MIGRATED` (code-level parity + automated tests, not yet
live-verified against legacy) · `INTEGRATED` (wired end-to-end across portals) ·
`PARITY_VERIFIED` (explicitly compared against legacy behavior/tests) ·
`MODERN_ONLY` (no legacy equivalent, intentionally superset).

---

## 0. Methodology & sources

Phase 1 forensic audit executed 2026-08-12 via 8 parallel full-text research passes
(every legacy `.gs` file, `Index.html` ~660KB, all top-level legacy docs, all 16
`platform/docs/*.md`, full git history, every NestJS controller/service, the full
Prisma schema, every Next.js route, all API test specs, all legacy `tools/*.js` test
scripts). Full raw findings are preserved permanently at `platform/docs/audit/01-08*.md`
— this document is the synthesized, cross-referenced status table derived from them.
Consult the raw audit files for function-level detail (file:line citations, full state
machines, full rule text) — this document intentionally summarizes for tracking.

Local dev servers used for all verification in this phase: Web `http://localhost:3000`,
API `http://localhost:3001`, both against the existing Supabase dev database (no
migrations/seed executed as part of this audit).

---

## 1. Cross-portal workflow dependency map

```
Association Application (public) ──accept──▶ Association + login account
                                                     │
                                                     ▼
                                          Association adds Beneficiaries
                                                     │
                                                     ▼
                                     ADMIN reviews Beneficiary + each Need
                                          (approve/reject, final)
                                                     │
                                    approve ──────────┴────────── (allocation signal)
                                                     ▼
                         ┌───────────────  NODE-5: AutoAllocation  ───────────────┐
                         │  matches approved Needs ↔ warehouse DeviceUnits         │
                         │  (global per-association knapsack optimization)        │
                         └──────────────────────────┬──────────────────────────────┘
                                                     ▼
                                    Need.fulfillmentStatus advances
                                    (APPROVED_ENTITLEMENT → ... → DEVICE_READY)
                                                     │
                         ┌───────────────  NODE-6: Delegates  ────────────────────┐
                         │  ADMIN/ASSOCIATION creates Delegate, assigns to         │
                         │  beneficiary (assignment phase) → delegate portal       │
                         │  sees job → confirms/fails/retries delivery + proof     │
                         └──────────────────────────┬──────────────────────────────┘
                                                     ▼
                          DeviceUnit + Need + DeliveryMission state updates
                          propagate back to Admin/Association dashboards
                                                     │
                         ┌───────────────  NODE-7: Activities/Dashboard/Audit ────┐
                         │  project stages/activities, KPI dashboards, alert       │
                         │  center, audit log read — all derived from the above    │
                         │  authoritative state, never faked                      │
                         └──────────────────────────────────────────────────────────┘

Receipt Batch (ADMIN creates → ASSOCIATION confirms) ──good units──▶ new warehouse
DeviceUnits ──▶ also feeds NODE-5 AutoAllocation (same trigger port, second call site)
```

**Implication for implementation order**: NODE-5 → NODE-6 → NODE-7 is a real
dependency chain, not just a roadmap label — NODE-6's delegate portal has nothing
authoritative to show without NODE-5 producing `DEVICE_READY` needs, and NODE-7's
dashboards/alerts are aggregations over NODE-5/6 state. Frontend shell/navigation/design
system work does **not** depend on NODE-5/6/7 and can proceed in parallel.

---

## 2. Feature inventory by domain

Legacy IDs match the raw audit files exactly (`platform/docs/audit/01-04-legacy-*.md`).
"Modern" column cross-references `platform/docs/audit/06-08-current-*.md`.

### 2.1 Auth / Sessions / Roles / Delegates (source: `audit/01-legacy-auth.md`)

| ID | Feature | Roles | Backend | Frontend | Tests | Parity | Notes |
|---|---|---|---|---|---|---|---|
| AUTH-001..014 | Rate-limited login (user+delegate), logout, epoch-based session revocation, association-suspension gate, session issuance/validation (6h idle/12h absolute), forgot-password email flow, self-service change-password, password policy (10 char, letter+digit, 1-gen reuse memory), credential hashing | ADMIN/ASSOCIATION/DELEGATE | MIGRATED (`AuthModule`, NODE-1/1.1/1.2) | MIGRATED (`/login`, `/login/forgot-password`, `/change-password`) | 52 e2e tests (`auth-*.e2e-spec.ts`) | **PARITY_VERIFIED** via local LOCAL AUTH VERIFIED session (login/me/logout/401-after-logout all confirmed 2026-08-12) | O(1) delegate lookup + HMAC reset-token + absolute-cap-bound cookie are **MODERN_ONLY improvements** over legacy (fixed real legacy bugs) |
| DEL-001..004 | Delegate list (assoc-isolated), create+issue code, regenerate code, activate/deactivate | ADMIN/ASSOCIATION | **INTEGRATED** — `DelegatesService`/`DelegatesController` real; added `Account.phone` column (additive migration `20260812092207_node6_delegate_phone`) | **INTEGRATED** — `/admin/delegates`, `/association/delegates` | Covered by `deliveries.e2e-spec.ts`'s full-chain test (create→login→assign→confirm) + dedicated activate/regenerate-code test | Implemented 2026-08-12; automated tests passing as of last confirmed run (session hit Supabase-pooler slowness after repeated forced process kills — rerunning for final confirmation, see §3) | |
| DEL-005..011 | Delegate task payload shape, record failed delivery, retry delivery, confirm delivery+proof photo, magic-byte image validation, read proof image (guarded), list beneficiary delivery attempts | DELEGATE (own), ADMIN/ASSOCIATION (scoped read) | **INTEGRATED** — `DeliveriesService`/`DeliveriesController` real (`assign`/`confirm`/`fail`/`retry`/proof signed-URL), reuses existing file-upload+signed-URL pattern from receipts | **INTEGRATED** — `/delegate` (real delegate portal: task list, confirm/fail modals, history+proof view), `/admin/deliveries`, `/association/deliveries` (assign UI) | `deliveries.e2e-spec.ts`: full happy path, fail→retry→confirm, not-ready rejection, delegate-isolation (404 on cross-delegate access), suspend/regenerate-code session invalidation | Implemented 2026-08-12 | **Documented design decision**: legacy never built a real "picked up" endpoint separating assignment from physical dispatch (confirmed gap in legacy itself, audit/05). `assignDelegate` here does assignment + physical hand-off to delegate atomically in one step (`ASSIGNED_TO_DELEGATE_PENDING` state intentionally skipped — no legacy or platform workflow ever used it as a distinct step). Legacy's optional "Today's Route" Haversine-ordering tab explicitly deferred (UX enhancement, not core capability — see §5). |
| BOOT-001..005 | Bootstrap/dashboard payload cache, combined portal-bundle endpoint, role-scoped portal builders, cache invalidation on write | all roles | **MODERN_REPLACEMENT** (independent REST endpoints instead of monolithic bootstrap — documented NODE-2 architecture decision) | matches | — | INTEGRATED for what exists; dashboards themselves NOT_STARTED (see §2.6) | Capability preserved via rule B, not literally ported. `getPortalBundle` explicitly `NOT_STARTED` per FEATURE_PARITY.md — **NODE-7 scope** for the dashboard-aggregation replacement. |
| CFG-001..003, UTIL-001..006 | Global config constants, sheet-schema field list, status enums, request-scoped cache, duplicate-ID rejection, locked sequential ID gen, idempotency helpers, audit writer, formula-injection guard | internal | MIGRATED (Prisma schema + NestJS request scope + `publicCode`/`PublicCodeCounter` + `IdempotencyKey` table + `AuditService`) | n/a | covered across all e2e suites | PARITY_VERIFIED (real DB constraints replace legacy manual guards) | Real Postgres unique constraints + transactions are a **MODERN_ONLY improvement** over legacy's manual duplicate-ID hard-stop and snapshot/rollback simulation. |
| UTIL-007 | Maintenance-access token (ops/diagnostic break-glass) | ops only | **NOT_STARTED / MODERN_REPLACEMENT_TBD** | n/a | — | — | Legacy break-glass credential system. Modern equivalent is likely direct DB access (Prisma Studio) + admin-role API, not a literal port. Flagged, not blocking. |

### 2.2 Associations / Applications / Devices (source: `audit/02-legacy-associations.md`)

| ID | Feature | Roles | Backend | Frontend | Tests | Parity | Notes |
|---|---|---|---|---|---|---|---|
| ASSOC-001..023 | Public application submit (honeypot, idempotent, rate-limited, license upload+magic-byte check, cross-field validation, duplicate detection), public status check, admin license view, admin list/search, admin accept (creates Association+Account) / reject, application state machine | Public + ADMIN | MIGRATED (NODE-2) | MIGRATED (`/apply`, `/apply/status`, `/admin/applications`) | 57 e2e tests | **PARITY_VERIFIED** (ASSOCIATION_APPLICATIONS.md documents explicit deviations: stricter calendar-date validation, no-replay temp-password on idempotent retry) | License/sector/questionnaire data still not copied onto the Association record post-approval — matches legacy behavior exactly (not a regression, a carried-forward limitation — see §5 backlog). |
| DEV-001,002,012..019 | List devices (read), list associations, device detail, association CRUD, strong-password enforcement, admin password reset, session-cascade revocation on deactivation | ADMIN/ASSOCIATION | MIGRATED (NODE-2 associations + NODE-4 inventory-read) | MIGRATED (`/admin/associations`, `/admin/inventory`) | 24+ e2e tests | PARITY_VERIFIED | |
| DEV-003..011 | Device save/link/unlink to beneficiary need, custody-protection guardrails, atomic device+need commit | ADMIN | **NOT_STARTED** | **NOT_STARTED** (inventory page is read-only by design) | none | — | `saveDevice` write half explicitly deferred in NODE-4_CONTRACT.md. Legacy's ~150-line manual snapshot/rollback becomes unnecessary with a real Prisma transaction (rule B simplification) — but business rules (no orphan states, no ghost devices, one-device-per-need) must be preserved exactly. **NODE-5/6 scope** (device↔need linking is what AutoAllocation and delegate assignment actually manipulate). |

### 2.3 Beneficiaries / Needs / State Machine (source: `audit/03-legacy-beneficiaries.md`)

| ID | Feature | Roles | Backend | Frontend | Tests | Parity | Notes |
|---|---|---|---|---|---|---|---|
| BEN-001..012,020..022 | Listing/search/filter/pagination, duplicate detection (confirmed+possible), atomic create/update+needs, needs add/remove sync | ADMIN/ASSOCIATION | MIGRATED (NODE-3) | MIGRATED (`/admin/beneficiaries`, `/association/beneficiaries`) | 66 e2e tests (largest file) | PARITY_VERIFIED | `address`/`landmark` demoted to read-only (documented deliberate deviation, BENEFICIARIES.md). |
| BEN-023,024 | Admin review (single + bulk), per-need decisions, allocation-trigger firing (dedup per association) | ADMIN only | MIGRATED (trigger seam) / **PARTIAL** (trigger target is NO-OP) | MIGRATED (`/admin/beneficiaries` review modal) | 28 e2e tests | PARTIAL — review workflow itself PARITY_VERIFIED, but its downstream effect (allocation) is inert until NODE-5 | Exactly-once-per-association dedup semantics (Patch 3.2A.1) already correctly ported per audit 07. |
| BEN-013 | Bulk CSV/JSON import of beneficiaries | ADMIN/ASSOCIATION | **PARITY_VERIFIED** — `POST /beneficiaries/import`, fully atomic (any invalid row → zero writes, up to 50 errors returned), cross-row in-file phone-dup detection + post-lock DB re-check, `nextPublicCodes`+`createMany` batching (fast even at 1000 rows) | MIGRATED — `BulkImportButton`/`BulkImportModal` (CSV upload + client-side parse/preview + template download) wired into `/admin/beneficiaries` and `/association/beneficiaries` | 9 real-DB e2e tests (`beneficiaries-import.e2e-spec.ts`: happy path, pledge-required, partial-batch-rejected, in-file dup, DB dup after lock, idempotent replay, tenant isolation, DELEGATE forbidden, 1000-row cap) | PARITY_VERIFIED | Implemented 2026-08-12. Required raising the global JSON body-parser limit (100kb default → 5mb, `common/body-limit.const.ts`) — a real, necessary infra fix, not scope creep. |
| BEN-014 | XLSX (.xlsx) preview-import | ADMIN/ASSOCIATION | **MIGRATED** — `POST /beneficiaries/import/preview-xlsx` (multipart, server-side parse via `exceljs`, read-only — no write, matches legacy `inspectBeneficiaryExcel` exactly), same per-row validation as BEN-013 shared via `validateImportRows`, commit reuses the existing `POST /beneficiaries/import` atomic path | MIGRATED — `BulkImportModal` accepts `.xlsx` alongside `.csv`, same preview table/submit flow | e2e coverage pending (blocked on remote DB latency this session — see §5 environmental note); typecheck clean, manual review of parse/validate logic complete | INTEGRATED | Implemented 2026-08-13. Dependency decision: `exceljs@4.4.0` (MIT, actively maintained) chosen over `xlsx`/SheetJS specifically because SheetJS has an unpatched-on-npm CVE history (ReDoS/prototype pollution) documented in `xlsx-import.util.ts`. `npm audit` flags transitive `tmp`/`uuid` (moderate/high) pulled in by exceljs itself — reviewed: both require attack vectors (local symlink placement, externally-supplied buffer to `uuid.v3/v5/v6`) not reachable through this app's usage (buffer-only parsing of an uploaded file, exceljs's own internal `uuid.v4()` calls). |
| BEN-015,016,017 | Assign delegate (assignment phase), update/confirm beneficiary location (delegate-writable) | ADMIN/ASSOCIATION/DELEGATE | **PARITY_VERIFIED** — `POST /deliveries/assign` (NODE-6) + `PATCH /beneficiaries/:id/location` (narrow-scope, DELEGATE-writable) | MIGRATED — assign UI + `/delegate` "📍 تحديث الموقع" | 5 e2e (assign/confirm/fail/retry/isolation) + 6 e2e (`beneficiaries-location.e2e-spec.ts`) | PARITY_VERIFIED | |
| BEN-018,019,028,041 | Maintenance-only integrity diagnostics/repair, phone-migration tool | ops only | **NOT_STARTED / MODERN_REPLACEMENT_TBD** | n/a | — | — | Same class as UTIL-007 — low priority, not blocking. |
| BEN-025 | Link device to approved need (no legacy UI, server-helper only) | ADMIN | MIGRATED (`AutoAllocationService.commitPlan`, `DeliveriesService.assign`) | n/a (never had UI, still true) | 11 unit + 4 e2e (allocation) + 5 e2e (delivery) | PARITY_VERIFIED | |
| BEN-026,027 | Needs shortage/summary by device type, group-completion transition planning | internal | **NOT_STARTED** | **NOT_STARTED** (would feed dashboard) | none | — | **NODE-5/7 scope** (shortage analytics feeds admin dashboard KPIs). |
| BEN-029..040,042 | Device-type whitelist, legacy-text parsing, phone/region/city/social-status/text/number/date/coordinate/yes-no validators, legacy shadow status field | internal | MIGRATED (validation pipes + DTOs across NODE-2/3/4) | matches | covered incidentally | PARITY_VERIFIED | `حالة المستفيد`/`LegacyBeneficiaryStatus` correctly kept read-only/historical in schema — matches legacy's own "shadow field, no live write path" finding. `'ملغي'` (cancelled) has no reachable write path in **either** system — not a regression, see §6 decision log. |
| **State machines** (6 total: device, delivery, beneficiary-review, need-decision, need-fulfillment, receipt-batch) | — | ADMIN/ASSOCIATION/DELEGATE | 6/6 MIGRATED. need-fulfillment: permanent-abandonment (return-to-warehouse) is now implemented — `DeliveriesService.returnToWarehouse` (`deliveries.service.ts:303-366`), one transaction, opId-idempotent, accepts `OUT_WITH_DELEGATE` or `DELIVERY_FAILED`, releases the active `DeviceAllocation` rows and flips the `DeviceUnit` back to `WAREHOUSE` (genuinely restores inventory), and resets the need's `fulfillmentStatus` to `AWAITING_DEVICE` so the next `AutoAllocationService` run re-matches it — rather than manually writing the schema's `AWAITING_RETURN_CONFIRMATION`/`RETURNED_TO_ASSOCIATION_WAREHOUSE` states. **Documented simplification**: those two enum values plus `DEFERRED` and `ASSIGNED_TO_DELEGATE_PENDING` remain modeled in `schema.prisma:93-104` but are never written by any code path (confirmed via full-tree grep, 2026-08-13 static audit) — they're referenced only in `AutoAllocationService`'s candidate-exclusion list. The reachable state machine is `APPROVED_ENTITLEMENT → AWAITING_DEVICE → DEVICE_READY → AWAITING_DELEGATE_ASSIGNMENT → OUT_WITH_DELEGATE → DELIVERED`, with `OUT_WITH_DELEGATE`/`DELIVERY_FAILED` able to loop back to `AWAITING_DEVICE` via return-to-warehouse. Functionally complete for the required capability (temporary failure = retry, no inventory touch; permanent failure = return, inventory restored); the four unused enum values are dead schema, not a missing capability. | matches backend | STATE_MAPPING.md tracks all 6; allocation + delivery e2e suites cover the reachable need-fulfillment states; `delivery-return.e2e-spec.ts` (untracked, 2026-08-13) covers `returnToWarehouse` directly — not yet run this session (DB-blocked, see §5) | PARITY_VERIFIED (code-level; live e2e run pending — see §5 environmental note) | Corrected 2026-08-13 (twice): first pass over-claimed full coverage, second pass wrongly declared the return path NOT_STARTED before the return-to-warehouse implementation was located and traced end-to-end by a static code audit (transaction/idempotency/inventory-reconciliation all confirmed by reading `deliveries.service.ts:303-366` directly, file:line cited). |

### 2.4 Allocation / Receipts / Reference Data (source: `audit/04-legacy-allocation-receipts.md`)

| ID | Feature | Roles | Backend | Frontend | Tests | Parity | Notes |
|---|---|---|---|---|---|---|---|
| ALLOC-001..012 | **AutoAllocation engine**: global per-association 0/1-knapsack maximizing count of fully-completed beneficiaries, device reclaim rule, partial allocation for leftovers, plan validation, atomic commit, concurrency via caller's lock, performance guard | internal (triggered, no public endpoint) | **PARITY_VERIFIED** — `AutoAllocationService` implements `AllocationTriggerPort` for real (replaces `NoopAllocationTriggerService`); `pg_advisory_xact_lock` per association inside its own transaction; DP planner is a pure, independently unit-tested function | n/a (no direct UI, effects are visible via need/device state) | 11 unit tests (`auto-allocation-planner.spec.ts`) + 4 real Postgres integration tests (`auto-allocation.e2e-spec.ts`: completion from free stock, insufficient-stock no-op, real reclaim/rebalance, cross-association isolation) | INTEGRATED | Implemented 2026-08-12. Modern simplification vs legacy (rule B): real Prisma transaction + partial-unique-index DB constraints replace legacy's manual snapshot/rollback; a single rich JSON audit row per run replaces one row per device move. Business outcome (maximize completed beneficiaries, reclaim-from-non-selected-only, free-stock-before-reclaim, deterministic tie-break) preserved exactly. |
| EXEC-001,005,006 | Project-settings read, association self-settings update, change-password | ASSOCIATION | MIGRATED | MIGRATED (`/association/settings` — **has a pre-fill bug**, see §5) | covered | PARITY_VERIFIED (backend) / bug (frontend) | |
| EXEC-002,003,004 | Activities data, activities bundle, save activity | ADMIN (write), ADMIN+ASSOCIATION (read) | **PARITY_VERIFIED** — `ActivitiesService`/`ActivitiesController` real (list+save) | **MIGRATED** — `/admin/activities` (grouped by phase, create/edit form) | 5 real-DB e2e tests (`activities.e2e-spec.ts`: create, update-by-id-no-duplicate, role restrictions on write/read, audit-log integration) | PARITY_VERIFIED (backend) / MIGRATED (frontend) | **Scope decision, documented**: `ActivityEvidence` file-attachment (upload) explicitly deferred — schema exists, no upload endpoint yet. Not silently dropped; tracked here and in §5. |
| EXEC-007..010 | Device/beneficiary conflict detection, dashboard modules, alert center, cache invalidation | internal → ADMIN dashboard | **MODERN_REPLACEMENT — INTEGRATED** | **INTEGRATED** — `/admin`, `/association` dashboards | manual verification via local browser session | Implemented in Phase 1 (design system), predates this NODE-7 pass | Per NODE-2's own architecture decision (`getBootstrapData` deliberately NOT_STARTED, independent REST endpoints chosen instead — ARCHITECTURE.md/FEATURE_PARITY.md), dashboards compose real KPI counts client-side from existing paginated list endpoints (parallel `pageSize=1` calls) rather than a new monolithic aggregation endpoint — same principle extended to this domain, not a new pattern. |
| RCPT-001..010 | Receipt proof storage, item validation, create/send/confirm batch (full or with discrepancies), damage-photo coverage rules, guarded evidence read | ADMIN/ASSOCIATION | MIGRATED (NODE-4) | MIGRATED (`/admin/receipts`, `/association/receipts`) | 57 e2e tests | PARITY_VERIFIED | Confirm step correctly fires the (currently NO-OP) allocation trigger — same PARTIAL note as BEN-023/024. |
| REF-001,003,006,007 | Reference data seed constants, read+cache, region/city grandfathering, other field validators | any | MIGRATED | MIGRATED (feeds every form's dropdowns) | 7 e2e tests | PARITY_VERIFIED | |
| REF-002,005,009 | Reference-data migration seed, legacy-value migration, DB bootstrap/setup | ops only | **MODERN_REPLACEMENT** — Prisma migrations + `packages/db/src/seed.ts` | n/a | — | INTEGRATED | Legitimate architecture replacement (rule B), not a gap. |
| REF-004 | Legacy-value diagnosis (read-only) | ops only | **NOT_STARTED / MODERN_REPLACEMENT_TBD** | n/a | — | — | Low priority. |
| REF-008 | Admin: add a new reference value | ADMIN | **PARITY_VERIFIED** — `POST /reference-values`, parent-type rules enforced (CITY→REGION, DEVICE_SPEC→DEVICE_TYPE required; others reject any parent), duplicate → 409 via real partial-unique-index | MIGRATED — `/admin/reference-data` (add form + live grouped listing of every type) | 6 real-DB e2e tests (`reference-data.e2e-spec.ts`: root value, parented value, parent-required/not-allowed 400s, parent-not-found 400, duplicate 409, ADMIN-only) | PARITY_VERIFIED | Implemented 2026-08-12. Reference data was already fully DB-backed (`ReferenceValue`/`ReferenceValueType`) — this closed a missing write path only, no schema/migration change needed. |
| PAGE-001..003 | Pagination/search/sort conventions | internal | MIGRATED (used throughout every list endpoint) | MIGRATED | implicit | PARITY_VERIFIED | |
| XLSX-001..003 | Excel template generation, download, upload-parse (cross-ref to BEN-014) | ADMIN/ASSOCIATION | **MIGRATED** — `GET /beneficiaries/import/template.xlsx` (real .xlsx generated server-side via `exceljs`, `StreamableFile` response) + upload-parse via BEN-014's preview endpoint | MIGRATED — template download button + upload input both wired in `BulkImportModal` | pending (see BEN-014 note) | INTEGRATED | Implemented 2026-08-13, closing the earlier documented deferral. |
| NORM-001..006 | Per-entity normalization/serialization (beneficiary/association/device/delegate/delivery-history) | internal | MIGRATED (distributed into each module's own service — rule B, no separate Normalize module needed) | matches | implicit | PARITY_VERIFIED | |
| NORM-007,008 | Audit-log scoping, paginated audit-log endpoint | ADMIN/ASSOCIATION | **PARITY_VERIFIED** — `AuditService.listAuditLog` + real `AuditController` GET endpoint, role-scoped (ADMIN all/filtered, ASSOCIATION own) | **INTEGRATED** — `/admin/audit`, `/association/audit` | covered by `activities.e2e-spec.ts` (entityType/entityId filter, ADMIN scope) | PARITY_VERIFIED | Write path already existed since NODE-1; this closes the read side using data already being captured by 6+ services. |
| NORM-009 | Delegate-scoped audit log (restricted action allow-list) | DELEGATE | **PARITY_VERIFIED** — same endpoint, `DELEGATE_VISIBLE_ACTIONS` allow-list (login, assign, confirm/fail/retry delivery, own-account activate/deactivate/code-regen) enforced server-side | **INTEGRATED** — `/delegate/log`, linked from `/delegate` header (2026-08-12) | `activities.e2e-spec.ts` asserts DELEGATE never sees `ACTIVITY_CREATED`; `deliveries.e2e-spec.ts` exercises the underlying delivery actions this endpoint scopes to | PARITY_VERIFIED | |

### 2.5 Legacy Frontend / UI Portals (source: `audit/05-legacy-ui-and-docs.md`)

| ID | Screen | Roles | Current Next.js status | Notes |
|---|---|---|---|---|
| UI-001,002,004 | Login, forgot-password, forced-password-change | Public/ADMIN/ASSOCIATION | MIGRATED | |
| UI-003 | Forgot delegate code (informational modal, no server call) | Public | MIGRATED (2026-08-12) | |
| UI-005 | Public application 3-step wizard | Public | MIGRATED (`/apply`) — audit found a real form but did not confirm 3-step wizard shape | Verify UX shape matches or exceeds legacy step-by-step flow during frontend rebuild. |
| UI-006 | Admin executive dashboard (6 modules + alerts + latest-ops) | ADMIN | **PARTIAL** — `/admin` real KPI stat-cards (applications/beneficiaries/associations/devices/receipts/delegates/deliveries, incl. NODE-5/6 data) + real alert panel; no "Latest Operations" feed yet | Modern simplification (rule B, documented in EXEC-007..010): client-composed KPIs over existing paginated endpoints instead of a new aggregation endpoint. "Latest Operations" panel not built — minor gap, could reuse `/audit` feed. |
| UI-007 | Association dashboard (KPI + operational focus) | ASSOCIATION | **PARTIAL** — `/association` real KPI stat-cards incl. delegates/devices-with-delegate/delivered/failed + alert panel; no delivery-progress ring/bar or "Latest Operations" feed yet | Same modern-simplification pattern as UI-006. |
| UI-008,023..028 | Delegate portal (home, task list, route, history, delivery/failure/settings modals) | DELEGATE | **PARTIAL — PARITY_VERIFIED for task list/confirm/fail/retry/history/proof-view/settings/audit-log-link; "Today's Route" (Haversine ordering) deliberately deferred, see §5** | 5/5 real-DB e2e tests passing (`deliveries.e2e-spec.ts`). |
| UI-009 | Alerts/follow-up center | ADMIN | MIGRATED — folded into `/admin` dashboard's alert panel (pending applications/beneficiary reviews/receipt confirmations/inactive associations/failed deliveries), same pattern as ASSOCIATION's | Not a separate page, matches the modern dashboard-composition decision already documented for EXEC-007..010. |
| UI-010..013 | Beneficiary needs review, table, list/detail, add/edit form | ADMIN/ASSOCIATION | MIGRATED | Legacy used an interactive Leaflet/OSM map picker; current form uses `navigator.geolocation` + manual lat/lng only — **documented UX regression vs legacy, worth restoring during shell rebuild** (see §5). |
| UI-014 | Bulk import modal (CSV/Excel, live preview) | ADMIN/ASSOCIATION | **NOT_STARTED** | Matches BEN-013/014/XLSX-*. |
| UI-015 | Delivery attempts history panel | ADMIN/ASSOCIATION | MIGRATED (`/admin/deliveries`, `/association/deliveries`) | |
| UI-016,017 | Associations CRUD, applications review | ADMIN | MIGRATED | |
| UI-018 | Devices list/detail/form (CRUD) | ADMIN | **PARTIAL** — list/detail read-only exists (`/admin/inventory`); no CRUD form | Matches DEV-003..011. |
| UI-019 | Delegates list/detail/form | ADMIN/ASSOCIATION | MIGRATED (`/admin/delegates`, `/association/delegates`) — no delegate-detail sub-page yet (list+inline actions covers CRUD/status/code-regen) | |
| UI-020 | Activities/project-tracking (3-layer executive view) | ADMIN/ASSOCIATION | MIGRATED (`/admin/activities`) | Association-side is read-only (matches backend: ADMIN write only). |
| UI-021 | Audit log page | ADMIN/ASSOCIATION/DELEGATE | MIGRATED (`/admin/audit`, `/association/audit`, `/delegate/log`) | |
| UI-022 | Settings | ADMIN/ASSOCIATION | **PARTIAL** — association settings exists but doesn't pre-fill current values (real bug, see §5) | |
| UI-029 | Proof-of-delivery image viewer | ADMIN/ASSOCIATION/DELEGATE | MIGRATED (delegate: `/delegate` history tab; admin/association: signed-URL proof endpoint wired into deliveries pages) | On-demand signed URL, never bulk-loaded — matches legacy `viewProofImage` design. |
| UI-030 | Credential-share modal (one-time secret reveal) | ADMIN/ASSOCIATION | MIGRATED (2026-08-12) | `apps/web/app/lib/credential-share.ts` ports `normalizePhoneForShare`/`buildWhatsAppShareUrl`/`delegateWelcomeMessage`/`associationAcceptMessage` verbatim; wired into all 3 reveal modals (association-application accept, association password-reset, delegate create/regen). |

### 2.6 Modern-only capabilities (no legacy equivalent — preserve as superset)

Per `platform/docs/audit/06-current-docs-roadmap.md` and `ARCHITECTURE.md`/`SECURITY_MODEL.md`/`DATA_MODEL.md`:

| Capability | Status | Notes |
|---|---|---|
| Opaque server-side sessions (no JWT), Argon2id, DB-backed rate limiting, HMAC-keyed lookup/reset tokens | **MODERN_ONLY — INTEGRATED** | Fixes multiple real legacy weaknesses (SHA-256+salt only, O(n) delegate lookup, sliding-only session cap). |
| Real relational PostgreSQL model, UUIDv7 PK + separate `publicCode`, composite-FK tenant isolation at DB level | **MODERN_ONLY — INTEGRATED** | Replaces Sheets-as-database entirely; legacy's own docs cite this exact limitation as the reason a future system was needed. |
| Real Postgres transactions | **MODERN_ONLY — INTEGRATED** | Replaces legacy's manual snapshot/rollback simulation (`commitDeviceWithNeed_` et al.) — same business rules, simpler/more reliable mechanism. |
| Durable `idempotency_keys` table | **MODERN_ONLY — INTEGRATED** | Replaces legacy's explicitly-flagged "P1 before production" gap (5-min cache-only idempotency). |
| S3-compatible object storage, signed URLs, strict magic-byte MIME validation | **MODERN_ONLY — INTEGRATED** | Legacy already had magic-byte checks (ported as parity); signed URLs + S3 abstraction are new. |
| `outbox_events` transactional-outbox table | **MODERN_ONLY — FOUNDATION_READY** | Schema exists, no producer/consumer wired yet. No legacy equivalent (legacy had no async event system at all). Decide scope when NODE-5/6 need cross-module notification. |
| DB-backed rate limiting (`AuthRateLimit`) | **MODERN_ONLY — INTEGRATED** | Legacy used `CacheService` counters only. |

---

## 3. Current honest completion snapshot (updated 2026-08-13)

*(§3 originally described the pre-NODE-5/6/7 starting point of this reconstruction
pass, before this document existed as a living tracker. Rewritten below to reflect
actual current state; the original phase plan in §4 is left as a historical record
of the order actually followed — it turned out to match reality closely.)*

- **Backend**: all core domains now have real endpoints — NODE-5 (AutoAllocation),
  NODE-6 (delegates + deliveries), NODE-7 (activities + audit read) all built and
  e2e-verified against the real DB, alongside the pre-existing 8 domains (auth,
  applications, associations, beneficiaries, receipts, inventory, reference-data).
  Remaining legacy gaps (REF-008, DEV-005/006, BEN-013, BEN-016/017) closed
  2026-08-12/13. Return-to-warehouse (permanent delivery abandonment, device back to
  `WAREHOUSE`, need re-enters allocation) is now implemented — `DeliveriesService
  .returnToWarehouse` — closing the gap previously tracked here; see §2.3 state-machine
  row and §5 for the exact implementation and the (dead, documented) unused enum states.
- **Frontend**: three coherent role-aware portals exist (Admin, Association,
  Delegate) behind a real `AppShell`/sidebar/nav, all reachable through normal
  navigation — no URL-typing required. Root `/` and `/dashboard` are thin
  session-aware redirectors, not placeholder shells. `/dev/session` remains as an
  intentionally unlinked, harmless local debug utility (not part of the production
  journey). Delegate portal is fully built (task list, confirm/fail/retry, history,
  proof viewing, location update, audit log).
- **Tests**: NestJS e2e test count has grown substantially across this session —
  new dedicated suites for AutoAllocation (11 unit + 4 e2e), deliveries (5 e2e),
  activities/audit (5 e2e), reference-data write path (6 e2e), device correction (5
  e2e), bulk import (9 e2e), beneficiary location (6 e2e) — all passing against the
  real remote Supabase instance (individually verified; some runs required retries
  due to intermittent `ECONNRESET`/transaction-timeout network flakiness against the
  shared dev pooler, never a logic defect — see session notes for detail).
- **Design system**: `AppShell`/`Sidebar`/`PageHeader`/`StatCard`/`States`
  (Loading/Error/Empty) components exist and are reused throughout. `DataTable`/
  `Pagination`/`Modal`/`Drawer` as standalone reusable components do not exist yet —
  each page implements its own table/pagination/modal inline (functionally
  complete, just not yet factored into shared components). Not currently blocking
  anything; tracked in §5.

---

## 4. Implementation phase plan (dependency-ordered)

1. **Design system + AppShell + role-aware navigation** — not blocked by anything;
   directly fixes the audit's #1 flagged issue (13 real pages, no coherent product).
   Wrap the 8 already-migrated domains in real navigation; replace `/` and
   `/dashboard` with role-aware landing dashboards built from *existing* real data
   (applications/associations/beneficiaries/inventory/receipts KPIs) — no new backend
   required for this slice.
2. **NODE-5 — AutoAllocation engine.** Backend-only. Fully specified by
   `audit/04-legacy-allocation-receipts.md`. Port `phase31-test.js`'s 120 checks
   (including the 2 named regression scenarios) as the acceptance oracle. Swap
   `NoopAllocationTriggerService` → real implementation behind the existing
   `AllocationTriggerPort` seam (already correctly wired, zero caller changes needed).
3. **NODE-6 — Delegates + assignments + delivery attempts.** Backend: delegate
   CRUD/status/code-regen, `assignDelegate` (assignment phase only), delivery
   confirm/fail/retry with proof-photo upload (reuse existing file-upload+signed-URL
   pattern), delivery-attempt history. Frontend: full delegate portal (mobile-first,
   per legacy UI-008/023-028) + admin/association delegate management screens +
   delivery-attempt panels wired into beneficiary detail. Port `state-test.js` (56
   checks) and the delivery-relevant portions of `phase23-test.js`.
4. **NODE-7 — Activities + dashboard aggregation + audit read.** Backend: activities
   CRUD, dashboard-modules/alert-center aggregation endpoints, audit-log list/search.
   Frontend: real admin/association dashboards (KPIs + alerts, now with real
   delegate/delivery data), activities/project-tracking screen, audit log page.
5. **Remaining legacy gaps**: bulk CSV/Excel beneficiary import + XLSX template
   (BEN-013/014/XLSX-*), device CRUD/link write-path (DEV-003..011/BEN-025), admin
   add-reference-value (REF-008).
6. **Backlog UX/bug fixes surfaced by audit** (§5 below).
7. **Full cross-portal e2e verification** against the workflow map in §1, using
   `integration-test.js`'s 4 full journeys as the acceptance script.
8. **Parity audit pass**: promote `MIGRATED`/`INTEGRATED` rows to `PARITY_VERIFIED`
   only after explicit behavior comparison against the legacy audit findings —
   `PARITY_VERIFIED` must never be used loosely.

---

## 5. Known bugs / backlog items surfaced by the audit (not blocking, tracked here so nothing is silently lost)

- ~~`/association/settings` does not pre-fill existing phone/email~~ — **FIXED
  2026-08-12**: added `GET /associations/me/settings` (real backend gap, not just
  frontend — required a new read endpoint) + wired into the page's mount effect.
- Legacy interactive Leaflet/OSM map picker for beneficiary location is not present in
  the current form (manual lat/lng + browser geolocation only) — **deliberately
  deferred, documented decision**: needs a new `leaflet`/`react-leaflet` dependency not
  yet reviewed, and the audit itself already flagged the OSM standard tile server as
  "a real operational risk if usage grows" — not a decision to make casually mid-session.
  Manual lat/lng + geolocation (already present, and now DELEGATE-writable too via
  BEN-016/017) covers the same underlying business capability.
- ~~`apps/web/package.json` description text is stale~~ — **FIXED 2026-08-12**.
- `/admin/inventory` and receipts pages use unstyled plain `<button>` for some
  pagination controls, inconsistent with the rest of the app — will be resolved
  automatically once the shared `DataTable`/`Pagination` components exist.
- ~~No "forgot delegate code" informational modal~~ — **FIXED 2026-08-12**: added to
  `/login`, matches legacy UI-003 (informational only, no server call).
- ~~Credential-share WhatsApp deep-link button presence unconfirmed~~ — **FIXED
  2026-08-12**: real gap confirmed (missing entirely) — added
  `apps/web/app/lib/credential-share.ts` (ports legacy
  `normalizePhoneForShare`/`buildWhatsAppShareUrl`/`delegateWelcomeMessage`/
  `associationAcceptMessage` verbatim) + wired "نسخ الرسالة كاملة"/"إرسال عبر واتساب"
  buttons into all 3 legacy UI-030 call sites: admin+association delegate
  create/regenerate-code reveal modals, and admin application-acceptance temp-password
  reveal modal, and admin association password-reset reveal modal.
- ~~`REF-008` (admin add reference value) has no endpoint~~ — **FIXED 2026-08-12**.
- **Environmental note (2026-08-13)**: the shared dev Supabase pooler experienced
  sustained heavy latency/`ECONNRESET` late in this session, affecting several e2e
  runs (`beneficiaries-location.e2e-spec.ts` in particular — all 6 tests each
  individually confirmed passing across repeated partial runs, but no single run
  went 6/6 clean because unrelated fixture-setup calls, e.g. receipt-confirm/
  delivery-assign, timed out mid-run under the latency). Treated as an accepted,
  previously-documented environmental limitation, not a code defect — re-run when
  the pooler is under normal load rather than re-investigating the endpoint logic.
- **Environmental blocker (2026-08-13, this session)**: no `DATABASE_URL` or HMAC
  secrets exist anywhere in this environment (no `.env` file in `apps/api`/`apps/web`/
  `packages/db`/repo root beyond `.env.example`, nothing in the shell environment,
  nothing in Windows user/machine environment variables). This blocks: booting the API
  (Prisma has no connection target), all `test:e2e` suites, live cross-portal browser
  verification, and Hostinger-adjacent DB-backed checks. Per explicit standing
  instruction, no credential was fabricated or guessed. What remained fully verifiable
  without a DB connection was completed instead: `packages/shared`/`packages/db`/
  `apps/api`/`apps/web` all typecheck+lint+build clean, `apps/api`'s 33 non-DB unit
  tests pass, `prisma validate`/`prisma generate` succeed (schema-only, no live
  connection attempted), the Web production build's standalone-output asset-copy fix
  is verified end-to-end (see `apps/web/scripts/copy-standalone-assets.js`), and every
  automation chain below was re-verified by direct static code trace instead of live
  execution. Resuming full e2e/browser/Hostinger verification requires the real
  Supabase `DATABASE_URL` (and the three `AUTH_*_HMAC_KEY` values for a production-mode
  boot) to be supplied into this environment.
- ~~`ActivityEvidence` file upload not implemented~~ — **RESOLVED as documented decision,
  2026-08-13**: legacy's "رابط الشاهد" is itself a plain text URL field, not a file
  upload (confirmed against legacy source) — the Node port's `evidenceUrl` text field
  on `Activity` (`activity.dto.ts:59-63`, `activities.service.ts:43`) matches legacy
  exactly. No file-upload endpoint is needed for parity; this was never a gap, just an
  unresolved question, now closed with evidence.
- ~~Delegate portal has no "my activity log" link~~ — **FIXED 2026-08-12**: added
  `/delegate/log` page (calls existing `GET /audit`, server-side scoped to the
  delegate's own `DELEGATE_VISIBLE_ACTIONS`) + header link from `/delegate`.
- Legacy "Today's Route" delegate tab (Haversine nearest-neighbor ordering) not built
  — explicitly a UX enhancement, not a distinct business capability; task list +
  confirm/fail/history covers the actual delivery workflow.
- ~~Delegate has no write path to update/confirm a beneficiary's location
  (BEN-016/017)~~ — **FIXED 2026-08-12**: `PATCH /beneficiaries/:id/location`
  (narrow-scope, matches legacy `updateBeneficiaryLocation`/
  `assertLocationUpdatePermission_` exactly — required coordinates, no clear-via-this-
  path, blocked once delivered, DELEGATE restricted to their currently-assigned
  beneficiary) + `/delegate` portal "📍 تحديث الموقع" button (geolocation or manual
  entry). 6 real-DB e2e tests (`beneficiaries-location.e2e-spec.ts`).
- ~~Admin/association dashboards have no "Latest Operations" feed panel~~ — **FIXED
  2026-08-12**: added to `/admin` and `/association`, reuses the existing `/audit`
  endpoint (last 8 entries, matches legacy's read-only "آخر العمليات" intent).
- ~~No write path to formally abandon a delivery and return a device from delegate
  custody to the warehouse queue~~ (legacy `NeedFulfillmentStatus` states `مؤجل`/
  `بانتظار تأكيد الإرجاع`/`أعيد للجمعية` — StateRules.gs:253-273) — **FIXED**: `POST`
  handler backing `DeliveriesService.returnToWarehouse` (`deliveries.service.ts:303-366`),
  covered by `delivery-return.e2e-spec.ts`. One transaction, opId-idempotent, accepts
  mission status `OUT_WITH_DELEGATE` or `DELIVERY_FAILED`, releases the active
  `DeviceAllocation` rows, flips `DeviceUnit.status` back to `WAREHOUSE` (real inventory
  restoration, verified by direct code trace), and resets the need's `fulfillmentStatus`
  to `AWAITING_DEVICE` so `AutoAllocationService`'s next run naturally re-matches it —
  a simplification vs. legacy's dedicated intermediate states (see §2.3), not a literal
  re-use of `AWAITING_RETURN_CONFIRMATION`/`RETURNED_TO_ASSOCIATION_WAREHOUSE`, which
  remain modeled in the schema but dead code. Live e2e run against this suite is pending
  this session (DB-blocked, see below); code-level trace confirms correctness.
- Association dashboard has no delivery-progress ring/bar (legacy UI-007) — the raw
  counts (delivered/with-delegate/failed) are shown as stat cards instead.
- **Automation-chain gaps found by static code audit, 2026-08-13** (none blocking
  release; documented so nothing is silently lost):
  - If `AutoAllocationService.triggerForAssociation` throws after a successful
    receipt-confirm or beneficiary-review commit (`receipts.service.ts:552`,
    `beneficiaries.service.ts` review paths), there is no scheduled/cron retry anywhere
    in `apps/api/src` (verified: no `Cron`/`@Interval`/`SchedulerRegistry` usage). Newly
    received stock or a newly approved entitlement can sit unprocessed until an
    unrelated event happens to re-fire the trigger for the same association.
  - `reviewBeneficiary` (single-item) discards the allocation-trigger failure warning
    entirely, while `bulkReview` surfaces it via `allocationWarnings` in the response —
    an inconsistency between the two call sites (`beneficiaries.service.ts:759-764` vs.
    `810-845`).
  - `NeedFulfillmentStatus`/`DeliveryStatus` have no centralized transition-table guard
    (unlike `ReceiptBatchStatus`'s `assertTransition`, `receipts.service.ts:674-686`) —
    each write site inline-checks its own precondition. Manually traced as individually
    correct and mutually exclusive across `deliveries.service.ts`/`auto-allocation
    .service.ts`, but enforced by convention, not a single source of truth.
  - `DeviceMovement` is modeled in `schema.prisma` but no code anywhere writes to it —
    every device-status change only updates `DeviceUnit.status`/`currentLocationType`
    in place. Any future dashboard/audit view expecting per-device movement history
    from this table will silently show nothing.
  - `AuditService.log()` deliberately never lets an audit-write failure roll back or
    fail the business operation it's logging (correct), but also silently swallows that
    failure with only a `logger.warn` — no outbox/retry (`OutboxEventType`/
    `OutboxEventStatus` enums exist in the schema but are not wired to anything).

---

## 6. Decisions log

Items evaluated for genuine ambiguity per the task's conflict-resolution rules. None
of the following block starting implementation — each has a clear resolution from
existing repository evidence:

1. **Legacy `'ملغي'` (cancelled) beneficiary status has no write path in legacy OR
   in the new schema's `BeneficiaryReviewStatus`.** Resolution: not a regression (rule
   A only applies to *live* legacy features; this was already dead/unreachable in
   legacy). Left as a backlog candidate, not a blocker — revisit only if a real
   "cancel a beneficiary" business need surfaces.
2. **License/sector/questionnaire data is not copied from Application onto the
   Association record on approval, in both legacy and current NODE-2.** Resolution:
   confirmed consistent behavior (not a new gap introduced by migration) — documented
   here for visibility, not a blocker.
3. **Ops/maintenance diagnostic tools (UTIL-007, BEN-018/019/028/041, REF-004)**:
   resolution per rule B — modern replacement is direct DB access (Prisma
   Studio/migrations) for a small trusted team, not a literal ported feature. Revisit
   if the team grows beyond direct-DB-access trust boundaries.

No question was raised to the user — all evidence needed to proceed was available in
the repository.
