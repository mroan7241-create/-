# Audit 07 — Current API Backend (NestJS) — Feature Parity Investigation

Scope: `apps/api/src` (NestJS API) and `packages/db/prisma/schema.prisma`, as of repo state on branch `platform/node-migration` (commit `6fca768`).

Global wiring facts that affect every row below:
- Global prefix: `/api/v1` (`apps/api/src/main.ts`).
- Global auth guard: `SessionAuthGuard` registered as `APP_GUARD` in `apps/api/src/modules/auth/auth.module.ts:26` — **every route requires a valid session cookie by default** unless decorated `@Public()` (`apps/api/src/common/decorators/public.decorator.ts`). Role checks come from `@Roles(...)` (`apps/api/src/modules/auth/decorators/roles.decorator.ts`), enforced inside the same guard (`session-auth.guard.ts:78-81`).
- Session gate also enforces: revoked/expired/absolute-expired sessions rejected, account/association must be `ACTIVE`, and an ASSOCIATION account with `mustChangePassword=true` is blocked from everything except endpoints marked `@AllowMustChangePassword()`.
- `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` applied globally — unknown DTO fields are rejected.

---

## Section 1 — Full Endpoint Inventory

### health

| Method | Path | Handler (file:line) | Auth/Role | Status |
|---|---|---|---|---|
| GET | /api/v1/health | `HealthController.check` — `apps/api/src/health/health.controller.ts:21` | `@Public()` | Real — pings `SELECT 1` via `prisma`, returns 503 `ServiceUnavailableException` if DB unreachable |

### auth (`apps/api/src/modules/auth/auth.controller.ts`)

| Method | Path | Handler (file:line) | Auth/Role | Status |
|---|---|---|---|---|
| POST | /api/v1/auth/login | `AuthController.login` — auth.controller.ts:51 | `@Public()` | Real — dispatches to `authService.loginDelegate` (access code) or `authService.loginUser` (email+password) based on `dto.type`; sets HttpOnly session cookie |
| POST | /api/v1/auth/logout | `AuthController.logout` — auth.controller.ts:66 | Session required; `@AllowMustChangePassword()` | Real — revokes current session, clears cookie |
| GET | /api/v1/auth/me | `AuthController.me` — auth.controller.ts:75 | Session required; `@AllowMustChangePassword()` | Real — returns current account (no credential/hash) |
| PATCH | /api/v1/auth/password | `AuthController.changePassword` — auth.controller.ts:83 | `@Roles(ADMIN, ASSOCIATION)`; `@AllowMustChangePassword()` | Real — works even when `mustChangePassword=true`; revokes all sessions after success |
| POST | /api/v1/auth/password-reset/request | `AuthController.requestPasswordReset` — auth.controller.ts:93 | `@Public()` | Real — uniform response regardless of account existence (no account-status leakage) |
| POST | /api/v1/auth/password-reset/confirm | `AuthController.confirmPasswordReset` — auth.controller.ts:101 | `@Public()` | Real |
| POST | /api/v1/auth/associations/:id/reset-password | `AuthController.resetAssociationPassword` — auth.controller.ts:108 | `@Roles(ADMIN)` | Real — one-time temp password reveal |

Request DTOs: `LoginDto{type:'user'|'delegate', email?, password?, code?}`, `ChangePasswordDto{currentPassword,newPassword}`, `RequestPasswordResetDto{email}`, `ConfirmPasswordResetDto{email,code,newPassword}`.

### applications (`apps/api/src/modules/applications/applications.controller.ts`)

| Method | Path | Handler (file:line) | Auth/Role | Status |
|---|---|---|---|---|
| POST | /api/v1/association-applications | `ApplicationsController.submit` — applications.controller.ts:25 | `@Public()` | Real — multipart/form-data, license file OR website required; parses `answers` JSON; idempotent via `clientRequestId` |
| GET | /api/v1/association-applications/status/:clientRequestId | `ApplicationsController.status` — applications.controller.ts:63 | `@Public()` | Real — no PII, status lookup only by client-generated id |
| GET | /api/v1/association-applications | `ApplicationsController.list` — applications.controller.ts:70 | `@Roles(ADMIN)` | Real — paginated/search/filter |
| GET | /api/v1/association-applications/:id | `ApplicationsController.detail` — applications.controller.ts:77 | `@Roles(ADMIN)` | Real |
| GET | /api/v1/association-applications/:id/license-file | `ApplicationsController.licenseFile` — applications.controller.ts:84 | `@Roles(ADMIN)` | Real — short-lived signed URL, audited on every view |
| POST | /api/v1/association-applications/:id/review | `ApplicationsController.review` — applications.controller.ts:91 | `@Roles(ADMIN)` | Real — accept/reject, final, idempotent via `opId` |

Request DTO (`SubmitApplicationDto`): name, category, sector, region, city, phone, email, contactName, notes, licenseNumber, licenseExpiryDate, answers (stringified JSON), pledgeAccepted (string 'true'), website?, clientRequestId, plus multipart `licenseFile`.

### associations (`apps/api/src/modules/associations/associations.controller.ts`)

| Method | Path | Handler (file:line) | Auth/Role | Status |
|---|---|---|---|---|
| PATCH | /api/v1/associations/me/settings | `AssociationsController.updateSelfSettings` — associations.controller.ts:19 | `@Roles(ASSOCIATION)` | Real — phone/email only, associationId taken strictly from session |
| GET | /api/v1/associations | `AssociationsController.list` — associations.controller.ts:26 | `@Roles(ADMIN)` | Real — pagination/search/filter + aggregated counters |
| POST | /api/v1/associations | `AssociationsController.create` — associations.controller.ts:33 | `@Roles(ADMIN)` | Real — creates Association+Account+AuthCredential in one transaction, idempotent via `opId` |
| GET | /api/v1/associations/:id | `AssociationsController.detail` — associations.controller.ts:40 | `@Roles(ADMIN)` | Real |
| PATCH | /api/v1/associations/:id | `AssociationsController.update` — associations.controller.ts:47 | `@Roles(ADMIN)` | Real — transition to INACTIVE revokes all sessions of its accounts |

DTOs: `CreateAssociationDto`, `UpdateAssociationDto`, `AssociationSelfSettingsDto{phone?, email?}`, `ListAssociationsQueryDto`.

### beneficiaries (`apps/api/src/modules/beneficiaries/beneficiaries.controller.ts`) — NODE-3

| Method | Path | Handler (file:line) | Auth/Role | Status |
|---|---|---|---|---|
| POST | /api/v1/beneficiaries/bulk-review | `BeneficiariesController.bulkReview` — beneficiaries.controller.ts:42 | `@Roles(ADMIN)` | Real — each item is its own atomic transaction; fires allocation-trigger once per unique association (NO-OP today, see §3) |
| GET | /api/v1/beneficiaries | `BeneficiariesController.list` — beneficiaries.controller.ts:49 | `@Roles(ADMIN, ASSOCIATION)` | Real — ASSOCIATION scoped to own tenant from session |
| POST | /api/v1/beneficiaries | `BeneficiariesController.create` — beneficiaries.controller.ts:56 | `@Roles(ADMIN, ASSOCIATION)` | Real — beneficiary + needs created atomically, ≥1 valid need required |
| GET | /api/v1/beneficiaries/:id | `BeneficiariesController.detail` — beneficiaries.controller.ts:63 | `@Roles(ADMIN, ASSOCIATION)` | Real |
| PATCH | /api/v1/beneficiaries/:id | `BeneficiariesController.update` — beneficiaries.controller.ts:70 | `@Roles(ADMIN, ASSOCIATION)` | Real — needs editable only before final decision |
| POST | /api/v1/beneficiaries/:id/review | `BeneficiariesController.review` — beneficiaries.controller.ts:80 | `@Roles(ADMIN)` | Real — beneficiary decision + need decisions in one transaction, final, fires allocation-trigger (NO-OP) |
| DELETE | /api/v1/beneficiaries/needs/:needId | `BeneficiariesController.removeNeed` — beneficiaries.controller.ts:87 | `@Roles(ADMIN, ASSOCIATION)` | Real — only for a pending (undecided) need |

DTOs: `CreateBeneficiaryDto`, `UpdateBeneficiaryDto`, `ReviewBeneficiaryDto`, `BulkReviewDto{items[]}`, `RemoveNeedDto{opId}`, `ListBeneficiariesQueryDto`.

### receipts (`apps/api/src/modules/receipts/receipts.controller.ts`) — NODE-4

| Method | Path | Handler (file:line) | Auth/Role | Status |
|---|---|---|---|---|
| GET | /api/v1/receipts | `ReceiptsController.list` — receipts.controller.ts:43 | `@Roles(ADMIN, ASSOCIATION)` | Real |
| POST | /api/v1/receipts | `ReceiptsController.create` — receipts.controller.ts:61 | `@Roles(ADMIN)` | Real — multipart (optional `adminProofFile`) or plain JSON; batch+items atomic, initial status always DRAFT |
| GET | /api/v1/receipts/:id | `ReceiptsController.detail` — receipts.controller.ts:74 | `@Roles(ADMIN, ASSOCIATION)` | Real |
| POST | /api/v1/receipts/:id/send | `ReceiptsController.send` — receipts.controller.ts:81 | `@Roles(ADMIN)` | Real — DRAFT → AWAITING_ASSOCIATION_CONFIRMATION |
| POST | /api/v1/receipts/:id/confirm | `ReceiptsController.confirm` — receipts.controller.ts:99 | `@Roles(ASSOCIATION)` | Real — multipart (quantityPhoto, signatureImage, up to 50 damagePhotos, associationReportFile); fires allocation-trigger (NO-OP) after ≥1 good unit confirmed |
| GET | /api/v1/receipts/:id/evidence/:evidenceType | `ReceiptsController.evidence` — receipts.controller.ts:122 | `@Roles(ADMIN, ASSOCIATION)` | Real — short-lived signed URL for quantity/signature/damage/adminProof/report; audited per view |

DTOs: `CreateReceiptBatchDto{associationId,supplierName,sentDate,notes?,documentNumber?,items,opId}`, `ConfirmReceiptBatchDto{receiverTitle,items,damagePhotoLinks?,opId}`, `SendReceiptBatchDto{opId}`, `ReceiptEvidenceQueryDto{damagePhotoId?}`, `ListReceiptBatchesQueryDto`.

### inventory (`apps/api/src/modules/inventory/inventory.controller.ts`)

| Method | Path | Handler (file:line) | Auth/Role | Status |
|---|---|---|---|---|
| GET | /api/v1/inventory/devices | `InventoryController.list` — inventory.controller.ts:19 | `@Roles(ADMIN, ASSOCIATION)` | Real — server-side pagination; ADMIN sees all (optionally filtered), ASSOCIATION own tenant only |
| GET | /api/v1/inventory/devices/:id | `InventoryController.detail` — inventory.controller.ts:32 | `@Roles(ADMIN, ASSOCIATION)` | Real — parity with legacy `getDeviceDetail` |

DTO: `ListDeviceUnitsQueryDto{page?,pageSize?,associationId?,deviceType?,status?}`.

### reference-data (`apps/api/src/modules/reference-data/reference-data.controller.ts`)

| Method | Path | Handler (file:line) | Auth/Role | Status |
|---|---|---|---|---|
| GET | /api/v1/reference-values | `ReferenceDataController.getReferenceValues` — reference-data.controller.ts:20 | `@Public()` | Real — all reference lists (regions/cities/device types/social statuses/categories...), no session required, no sensitive data |

### Stub / foundation-only modules (each has exactly ONE endpoint, a self-describing status probe — no business logic)

| Method | Path | Handler (file:line) | Auth/Role | Status |
|---|---|---|---|---|
| GET | /api/v1/accounts/_module-status | `AccountsController.moduleStatus` — accounts.controller.ts:14 | none (no `@Public()`, no `@Roles` — falls through the global guard requiring *some* valid session since it's not marked Public; effectively unreachable without auth) | Stub — returns `{module,descriptionAr,parityStatus:'FOUNDATION_READY'}` |
| GET | /api/v1/activities/_module-status | `ActivitiesController.moduleStatus` — activities.controller.ts:14 | same as above | Stub |
| GET | /api/v1/allocation/_module-status | `AllocationController.moduleStatus` — allocation.controller.ts:14 | same as above | Stub |
| GET | /api/v1/audit/_module-status | `AuditController.moduleStatus` — audit.controller.ts:14 | same as above | Stub |
| GET | /api/v1/delegates/_module-status | `DelegatesController.moduleStatus` — delegates.controller.ts:14 | same as above | Stub |
| GET | /api/v1/deliveries/_module-status | `DeliveriesController.moduleStatus` — deliveries.controller.ts:14 | same as above | Stub |
| GET | /api/v1/settings/_module-status | `SettingsController.moduleStatus` — settings.controller.ts:14 | same as above | Stub |

Each of these controllers is a **module boundary placeholder only** — no service, no DTOs, no business methods, no Prisma access. Comment header on every one of them (verbatim pattern):
> "`NODE-0: حدود الوحدة فقط، بلا نقل Business Logic كامل بعد`" — "NODE-0: module boundary only, no business logic migrated yet."

**Total endpoint count: 42** (35 real business endpoints + 7 `_module-status` foundation stubs).

---

## Section 2 — Prisma Schema Domains

Source: `packages/db/prisma/schema.prisma` (1033 lines, 27 models, 18 enums). Domain grouping below follows the file's own numbered section comments (1 through 27).

| Domain | Models | Key Fields / Relations |
|---|---|---|
| **Accounts & Auth** | `Account`, `AuthCredential`, `AuthSession`, `PasswordResetToken`, `AuthRateLimit` | `Account`: role(`AccountRole`: ADMIN/ASSOCIATION/DELEGATE), associationId (nullable), status(ACTIVE/SUSPENDED), mustChangePassword, publicCode; relations to credentials, sessions, reviewed applications/beneficiaries/needs, uploaded files, created/confirmed receipt batches, device allocations created, device movements performed, delivery missions as delegate, delivery attempts as delegate, audit logs, idempotency keys. `AuthCredential`: type(EMAIL_PASSWORD/DELEGATE_ACCESS_CODE), identifier, secretHash+previousSecretHash. `AuthSession`: tokenHash, expiresAt (sliding 6h), absoluteExpiresAt (hard 12h cap), revokedAt. `PasswordResetToken`: tokenHash, attemptCount, TTL 15min. `AuthRateLimit`: HMAC'd subjectHash, sliding window counters. |
| **Associations & Applications** | `Association`, `AssociationApplication`, `ApplicationAnswer` | `Association`: category/region/city/phones[]/status(ACTIVE/INACTIVE); relations to accounts, beneficiaries, needs, receipt batches, device units/allocations/movements, delivery missions, audit logs. `AssociationApplication`: status(UNDER_REVIEW/ACCEPTED/REJECTED), licenseFileId (unique FK), resultingAssociationId (unique FK, prevents double-conversion), clientRequestId (idempotency), reviewedById. `ApplicationAnswer`: one row per acceptance question (questionKey/answer boolean), unique per (applicationId, questionKey). |
| **Reference data** | `ReferenceValue` | `type`(`ReferenceValueType`: REGION/CITY/ASSOCIATION_CATEGORY/SOCIAL_STATUS/DEVICE_TYPE/ASSOCIATION_SECTOR/DEVICE_SPEC/SUPPLIER/DIFFERENCE_REASON/RECEIVER_TITLE — 10 types), self-referential `parentId`/`children` hierarchy, sortOrder, active flag. |
| **Beneficiaries & Needs** | `Beneficiary`, `BeneficiaryNeed` | `Beneficiary`: associationId, region/city/district/address/phone, familyCount, socialSecurity, maritalStatus, income, landmark/notes, lat/long+locationSource, reviewStatus(`BeneficiaryReviewStatus`: UNDER_REVIEW/APPROVED/REJECTED), legacyStatus(`LegacyBeneficiaryStatus` — historical only), legacyNeedsText; composite unique (id, associationId) for tenant-safe composite FKs from child tables. `BeneficiaryNeed`: deviceType(`DeviceType`: REFRIGERATOR/OVEN/WASHING_MACHINE), decisionStatus(`NeedDecisionStatus`: PENDING/APPROVED/REJECTED), fulfillmentStatus(`NeedFulfillmentStatus` — 9-state lifecycle from APPROVED_ENTITLEMENT through AWAITING_DELEGATE_ASSIGNMENT/ASSIGNED_TO_DELEGATE_PENDING/OUT_WITH_DELEGATE/DELIVERED), unique(beneficiaryId, deviceType) — one need per device type per beneficiary regardless of decision outcome. |
| **Files / Evidence** | `FileObject` | storageProvider/bucket/objectKey (unique together), mimeType, sizeBytes, sha256, category(`FileCategory`: ASSOCIATION_LICENSE, RECEIPT_QUANTITY_PHOTO, RECEIPT_SIGNATURE_PHOTO, RECEIPT_DAMAGE_PHOTO, DELIVERY_PROOF_PHOTO, DELIVERY_RECIPIENT_SIGNATURE, ACTIVITY_EVIDENCE, RECEIPT_ADMIN_PROOF, RECEIPT_ASSOCIATION_REPORT); referenced by applications (license), receipt batches (4 kinds), receipt damage photos, delivery attempts (proof+signature), activity evidence. |
| **Receipts (device intake)** | `ReceiptBatch`, `ReceiptItem`, `ReceiptDamagePhoto` | `ReceiptBatch`: status(`ReceiptBatchStatus`: DRAFT/AWAITING_ASSOCIATION_CONFIRMATION/RECEIVED_COMPLETE/RECEIVED_WITH_DISCREPANCIES), createdById/confirmedById (must differ — service-enforced), 4 file FKs (quantity/signature/adminProof/associationReport), documentNumber. `ReceiptItem`: deviceType (nullable enum + legacyDeviceTypeText fallback), sentQty/goodQty/damagedQty/missingQty, differenceReason/Notes. `ReceiptDamagePhoto`: links a file to a specific receipt item. |
| **Inventory / Devices** | `DeviceUnit`, `DeviceAllocation`, `DeviceMovement` | `DeviceUnit`: status(`DeviceStatus`: WAREHOUSE/ALLOCATED/WITH_DELEGATE/DELIVERED/DAMAGED), currentLocationType(`DeviceMovementLocationType`: WAREHOUSE/DELEGATE/BENEFICIARY/DAMAGED_HOLDING) + currentLocationRef (polymorphic, service-validated not DB-enforced), CHECK constraint enforcing location-ref presence rules by type. `DeviceAllocation`: status(`DeviceAllocationStatus`: ACTIVE/RELEASED), composite FKs tying device+need+beneficiary to the same associationId, partial-unique indexes (raw SQL) enforcing "one active allocation per device" and "one active allocation per need" — this is the **sole source of truth** for what's currently assigned to whom. `DeviceMovement` (append-only): from/to location type+ref, reason, referenceType/referenceId (generic pointer back to the triggering entity), performedById. |
| **Deliveries** | `DeliveryMission`, `DeliveryAttempt` | `DeliveryMission`: beneficiaryId, associationId, delegateAccountId (nullable — assignment not yet made), status(`DeliveryStatus`: NOT_STARTED/PREPARING/OUT_WITH_DELEGATE/DELIVERED/DELIVERY_FAILED), assignedAt, scheduledFor. `DeliveryAttempt` (append-only, mirrors legacy "التسليمات" sheet): status, failureReason(`DeliveryFailureReason`: COULD_NOT_REACH/NO_ANSWER/POSTPONEMENT_REQUESTED/INCORRECT_ADDRESS/NOT_FOUND/RECEIPT_REFUSED), proofFileId, recipientSignatureFileId, attemptedAt. |
| **Activities** | `Activity`, `ActivityEvidence` | `Activity`: phaseOrder/phaseName, mainActivityOrder/mainActivityName, subActivityName, responsible, startDate/endDate, completionPercent(Decimal 5,2), status(free string), notes. `ActivityEvidence`: activityId, fileId (nullable), approvalStatus (free string), notes. |
| **Audit** | `AuditLog` (append-only) | actorAccountId/actorRole (nullable — system actions), associationId (nullable), action, entityType, entityId, metadata(Json), createdAt. No update/delete path exists or is intended. |
| **Cross-cutting / Infra** | `IdempotencyKey`, `SystemSetting`, `OutboxEvent`, `PublicCodeCounter` | `IdempotencyKey`: unique(accountId, scope, key), status(IN_PROGRESS/COMPLETED/FAILED), responseJson cache. `SystemSetting`: free-form key→Json config store. `OutboxEvent`: type(`OutboxEventType`: BENEFICIARY_APPROVED/RECEIPT_CONFIRMED/STOCK_INCREASED), status(PENDING/PROCESSED/FAILED), payload(Json), attempts/lastError — transactional outbox pattern, not yet observed to have a consumer in `apps/api/src` (see §3). `PublicCodeCounter`: atomic per-prefix counter (`prefix`→`nextValue`) backing all human-readable `publicCode` values (BEN-, ASC-, RCB-, etc.) via `INSERT...ON CONFLICT DO UPDATE`. |

Total: **27 models**, **18 enums**. Every model is real (no placeholder/TODO tables) — this is deliberately a NODE-0/NODE-0.1 "design the whole domain up front" schema; the gap between schema and API is entirely on the *service/controller* side, not the data model.

---

## Section 3 — Stubs / TODOs / No-op Adapters Found

A full-tree grep for `TODO`, `FIXME`, `NOT_STARTED`, "not implemented", `Noop`/`NoOp`, `placeholder`, `stub` across `apps/api/src` found **no textual TODO/FIXME comments at all** in this codebase — the team's convention instead is fully-implemented "module boundary" stub controllers (Section 1's `_module-status` rows) plus one explicit no-op adapter behind an interface (Hexagonal/ports-and-adapters seam). Findings:

| file:line | What it defers | Impact |
|---|---|---|
| `apps/api/src/modules/allocation/noop-allocation-trigger.service.ts:16-24` — `NoopAllocationTriggerService.triggerForAssociation()` | The entire `AutoAllocation.gs` auto-matching engine (device ↔ beneficiary-need matching) — logs one debug line (`"تجاهُل مقصود لإشارة تخصيص للجمعية..."`) and returns; no read, no write, no side effect | Beneficiary need approvals and receipt-batch confirmations correctly *signal* "an allocation opportunity may exist now" (call sites below), but nothing acts on that signal — devices never get auto-assigned to approved needs today. This is explicitly scoped to NODE-5. |
| `apps/api/src/modules/allocation/allocation-trigger.port.ts:29-36` — `AllocationTriggerPort` interface | Defines the seam/contract NODE-5 must implement (`triggerForAssociation(associationId): Promise<void>`), with 3 documented invariants the real implementation must preserve: (1) never called inside the review transaction — always post-commit; (2) failure must never roll back the review decision, only warn; (3) exactly once per unique association per batch, not once per beneficiary | Confirms the interception points already exist and are wired correctly — NODE-5 is a drop-in `useClass` swap in `allocation.module.ts:14`, no caller changes needed |
| `apps/api/src/modules/allocation/allocation.module.ts:14` — DI binding `{ provide: ALLOCATION_TRIGGER_PORT, useClass: NoopAllocationTriggerService }` | Same as above — the wiring itself | NODE-5 implementation swaps this one line |
| `apps/api/src/modules/beneficiaries/beneficiaries.service.ts:782` — call site `await this.allocationTrigger.triggerForAssociation(associationId)` (inside individual + bulk review flows) | Confirms timing/dedup logic (once per unique association in a bulk batch) is already migrated and tested; only the engine body is missing | No functional effect currently — call resolves to the no-op |
| `apps/api/src/modules/receipts/receipts.service.ts:550` — call site `await this.allocationTrigger.triggerForAssociation(batch.associationId)` (after receipt confirm produces ≥1 good unit) | Same pattern — confirms "new stock arrived" correctly signals allocation opportunity | Same — no-op today |
| `apps/api/src/modules/accounts/accounts.controller.ts`, `activities.controller.ts`, `allocation.controller.ts`, `audit.controller.ts`, `delegates.controller.ts`, `deliveries.controller.ts`, `settings.controller.ts` (each `:14`, `moduleStatus()`) | All real business endpoints for these 7 domains — accounts management, activities/dashboard, delegate CRUD, assignment, delivery attempts, audit log querying, system settings | These modules expose *only* a self-describing status probe (`parityStatus: 'FOUNDATION_READY'`); zero services, zero DTOs, zero Prisma access. Everything under NODE-5/6/7 (plus accounts/settings management) is unimplemented at the API layer even though the DB schema fully supports it. |
| `packages/db/prisma/schema.prisma` — `OutboxEvent` model (§24, lines 954-966) | Transactional-outbox table exists (`BENEFICIARY_APPROVED`/`RECEIPT_CONFIRMED`/`STOCK_INCREASED` event types, PENDING/PROCESSED/FAILED status, attempts/lastError) but no producer or consumer code was found anywhere in `apps/api/src` | Dead/future infrastructure — not wired to anything yet; not blocking current endpoints but worth flagging as another "schema ahead of code" gap, possibly related to the eventual NODE-5 allocation engine or cross-service notifications |

No other `throw new Error("not implemented")`, `NotImplementedException`, or comparable runtime-guard stubs were found — the "unfinished" surface area is entirely the 7 `_module-status`-only controllers plus the allocation no-op, both of which are clean, intentional, well-documented seams rather than half-written code.

---

## Section 4 — NODE-5/6/7 Backend Readiness

### Delegate management (create/status/code regeneration) — **MISSING**
`apps/api/src/modules/delegates/` contains only `delegates.controller.ts` (single `_module-status` GET) and `delegates.module.ts` — no service, no DTOs, no Prisma calls. The `Account` model already fully supports delegates today: `role: DELEGATE`, `AuthCredential{type: DELEGATE_ACCESS_CODE, identifier, secretHash}` (access-code login already works end-to-end via `AuthController.login` → `authService.loginDelegate`, since delegate *login* was migrated as part of NODE-1's auth work). What's missing is the **management side**: no endpoint exists to create a delegate account, list delegates, suspend/reactivate one, or regenerate their access code (legacy `saveDelegate`/`setDelegateStatus`/`regenerateDelegateCode`). This is explicitly the first bullet of NODE-6 in `docs/MIGRATION_ROADMAP.md:158-163`.

### Beneficiary → delegate assignment — **MISSING**
Schema support exists: `DeliveryMission.delegateAccountId` (nullable FK to `Account`, so a mission can exist "unassigned") plus `assignedAt` timestamp, and `NeedFulfillmentStatus` enum already includes `AWAITING_DELEGATE_ASSIGNMENT` / `ASSIGNED_TO_DELEGATE_PENDING` / `OUT_WITH_DELEGATE` states (schema.prisma:97-99). No controller or service anywhere sets `delegateAccountId` or transitions a need through those fulfillment states — `DeliveriesController` is a bare `_module-status` stub, `AllocationController` likewise. Roadmap explicitly names `assignDelegate` (assignment phase only) as a NODE-6 deliverable (`docs/MIGRATION_ROADMAP.md:161`).

### Delivery attempt recording — **MISSING**
`DeliveryAttempt` model (append-only, mirrors legacy "التسليمات" sheet) is fully modeled: `status`, `failureReason` (6-value enum), `notes`, `proofFileId`, `recipientSignatureFileId`, `attemptedAt`, relations to mission/beneficiary/delegate/files. No API code creates, lists, or reads any `DeliveryAttempt` row — `DeliveriesController` exposes nothing but the status probe. Legacy operations named explicitly in the roadmap (`confirmDelivery`/`retryDelivery`/`updateDeliveryStatus`/`listBeneficiaryDeliveryAttempts`) have zero counterpart in `apps/api/src`.

### Delivery proof/photo handling — **PARTIAL (infrastructure only)**
`FileCategory` enum already includes `DELIVERY_PROOF_PHOTO` and `DELIVERY_RECIPIENT_SIGNATURE` (schema.prisma:175-176), and `DeliveryAttempt.proofFileId`/`recipientSignatureFileId` are wired FKs to `FileObject`. The generic file-storage plumbing this would reuse already exists and is proven in production-shaped code: `apps/api/src/modules/files/storage.service.ts` + `file-validation.util.ts`, and the exact multipart/signed-URL pattern is already implemented twice (applications' `licenseFile`, receipts' `quantityPhoto`/`signatureImage`/`damagePhotos`/`associationReportFile` + the `GET .../evidence/:evidenceType` signed-URL pattern in `ReceiptsController`). No delivery-specific controller/service consumes any of this yet — it is scaffolding, not working delivery-proof upload/retrieval.

### Allocation trigger mechanism — **PARTIAL (seam exists, engine is a documented no-op)**
Exact mechanics, from `apps/api/src/modules/allocation/`:
- `AllocationTriggerPort` (allocation-trigger.port.ts) defines a one-method interface: `triggerForAssociation(associationId: string): Promise<void>`, injected via a Symbol DI token `ALLOCATION_TRIGGER_PORT`.
- `NoopAllocationTriggerService` (noop-allocation-trigger.service.ts) is the only implementation registered (`allocation.module.ts:14`): it does **nothing** except emit a `Logger.debug` line — no DB read, no DB write, no external call, no return value the caller inspects.
- It is called from exactly two places, both already correctly timed and deduplicated: `beneficiaries.service.ts:782` (after an individual or bulk beneficiary-need review approves ≥1 need — once per unique association even across a bulk batch) and `receipts.service.ts:550` (after a receipt-batch confirmation produces ≥1 good/undamaged device unit).
- What a real NODE-5 implementation needs to do (per the port's own doc-comment and `docs/MIGRATION_ROADMAP.md:150-156`): port the `AutoAllocation.gs` matching algorithm **unchanged** in business rules — for the given association, find `BeneficiaryNeed` rows in `AWAITING_DEVICE`/eligible fulfillment states and match them against available `DeviceUnit` rows in `WAREHOUSE` status of the matching `deviceType`, creating `DeviceAllocation` rows (respecting the partial-unique-index invariants "one active allocation per device" / "one active allocation per need") and advancing `NeedFulfillmentStatus`. Must run outside/after the caller's transaction (never inside the review transaction — invariant documented in the port file), must never let its own failure roll back or fail the review decision that triggered it (catch-and-warn only, matching legacy's `runAutoAllocation_` isolation), must add a `pg_advisory_xact_lock` per association to prevent concurrent double-allocation, and per legacy `phase31-test.js`/`phase31.2-test`, the matching must be proven to **globally maximize the number of fully-completed beneficiaries**, not just greedily match per-association.
- The DB schema already has every table this needs (`DeviceAllocation`, `DeviceUnit`, `BeneficiaryNeed.fulfillmentStatus`) — this is purely an application-logic gap, not a data-model gap.

### Activities / dashboard — **MISSING**
`Activity` and `ActivityEvidence` models are fully designed (phase/main-activity/sub-activity hierarchy, completion percentage, evidence with approval status). `ActivitiesController` is a bare `_module-status` stub with no service, no DTOs. Legacy `getActivitiesBundle`/`saveActivity` (named explicitly under NODE-7 in the roadmap) have no counterpart at all.

### Audit — **PARTIAL (write path exists and is actively used; read/query API is missing)**
`AuditService` (`apps/api/src/modules/audit/audit.service.ts`) is a real, fully-implemented, `@Global()` service — not a stub. It writes to `AuditLog` (append-only) via `prisma.auditLog.create(...)`, and deliberately swallows its own failures (`try/catch` + `Logger.warn`) so a logging failure can never roll back the business operation that triggered it — this exactly mirrors the legacy `audit_()` isolation pattern per its own doc-comment. It is already invoked from `auth.service.ts`, `applications.service.ts`, `associations.service.ts`, `beneficiaries.service.ts`, and `receipts.service.ts` — i.e., every currently-migrated write-heavy service logs real audit entries today. What's missing is entirely the **read side**: `AuditController` exposes only `_module-status`; there is no endpoint to list/search/filter audit log entries (legacy `listDelegateAuditLog`, named explicitly under NODE-7 in the roadmap, has no counterpart). So: audit *logging* EXISTS and is production-grade; audit *querying/reporting* is MISSING.

---

## Summary (for reporting back)

- **Total HTTP endpoints found: 42** — 35 real business endpoints across 9 fully-migrated modules (health, auth, applications, associations, beneficiaries, receipts, inventory, reference-data) + 7 `_module-status` foundation-only probes (one per stub module: accounts, activities, allocation, audit, delegates, deliveries, settings).
- **Delegate management (CRUD/status/code regen): MISSING** — controller/module exist as empty scaffolding only; DB schema (Account+AuthCredential) already supports it, delegate *login* already works, but no management endpoints exist.
- **Beneficiary → delegate assignment: MISSING** — `DeliveryMission.delegateAccountId` field and `NeedFulfillmentStatus` states exist in schema; zero application code sets/transitions them.
- **Delivery attempt recording: MISSING** — `DeliveryAttempt` model fully designed; `DeliveriesController` is a bare stub, no create/list/read logic anywhere.
- **Allocation trigger: PARTIAL** — the `AllocationTriggerPort` seam is real, correctly wired, and called at exactly the right two moments (beneficiary-need review, receipt confirmation); the actual `NoopAllocationTriggerService` implementation is a deliberate, well-documented no-op that does nothing at all — the real `AutoAllocation.gs`-equivalent matching engine (NODE-5) still needs to be written.
- **Activities/dashboard: MISSING** — model exists, controller is a bare `_module-status` stub, no service/DTOs.
- **Audit: PARTIAL** — write-side (`AuditService.log(...)`) is real, global, and already used by 5 migrated services; read/query API (list/search audit log) does not exist (`AuditController` is a bare stub).
