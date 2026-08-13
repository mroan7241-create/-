# Audit 05 — Legacy Frontend (Index.html) & Top-Level Docs

Scope: `Index.html` (root, ~663KB / 5670 lines, the entire legacy Google
Apps Script SPA) + `README.md`, `SECURITY_REVIEW.md`, `DEPLOYMENT.md`,
`HANDOFF.md`, `RELEASE.md`. Pure read-only research, no files edited.

**Important scoping caveat found during this audit**: `HANDOFF.md` and
`RELEASE.md` are **stale relative to the current legacy codebase**. Git
history shows `HANDOFF.md` was last touched by commit `212d263 "Phase
2.3.4: Legacy Beneficiary Edit Closure"`, which is *older* than a whole
series of undocumented legacy features added afterward: `d1bcdbe Phase
3.1.1: Allocation and Receipt Integrity Closure`, `0a3574a Phase 3.1.2:
Global Allocation Objective Closure`, `e81db33 Phase 3.1.2a: Allocation
Tie-Break Closure`, `719dcdb Phase 3.2A: واجهة مراجعة واعتماد المستفيدين
(فردي + بالجملة)`, `daa5e6d Patch 3.2A.1: تجميع تشغيل AutoAllocation لكل
جمعية`. None of these commits touched `HANDOFF.md`/`RELEASE.md`. This
means the **beneficiary per-need review/approval workflow, auto-allocation
engine, and receipt-batch/inventory system (`AutoAllocation.gs`,
`BeneficiaryNeeds.gs`, `ReceiptBatches.gs`)** are real, live, tested
legacy features **visible in `Index.html`** but **entirely undocumented**
in the five docs this task covers. Their server-side detail should come
from whichever audit thread covers the `.gs` files directly — this
document only reports what's inferable from `Index.html`'s UI surface
(Section 1, rows UI-010/UI-011) and flags the gap. Also note: `git log`
shows a long `NODE-*` commit sequence already in progress (`platform/`
directory) — the Node/NestJS+Next.js migration referenced by this task is
already underway in this same repo, beyond this audit's scope.

---

## Section 1 — UI Structure & Portals

Single-file SPA (`Index.html`) rendered client-side; `render()` dispatches
on `state.data.role` (`ADMIN` / `ASSOCIATION` / `DELEGATE`) and
`state.screen`/`state.page`. Sidebar nav items come from `navFor(role)` /
`NAV_LABELS` (`Index.html:896-907`). Admin and Association share the same
shell/nav (`dashboard, applications*, beneficiaries, associations*,
devices, delegates, activities, audit, settings` — items marked `*` are
admin-only per `navFor`), while `DELEGATE` role gets an entirely separate
mobile-first shell (`renderDelegate`, `Index.html:4542`) with its own
3-tab nav (list / route / history) and no sidebar.

| ID | Screen/Feature | Role | Description | Notes |
|---|---|---|---|---|
| UI-001 | Login screen | Public | Tabbed login: "دخول الإدارة والجمعيات" (email+password) vs "دخول المندوب" (delegate access code `MND-XXXXXX`); glassmorphic card over decorative Al-Zad brand background; link to association-application form and "forgot password"/"forgot code" flows. `renderLogin` @1402. | Redesigned in Phase 12/13: marketing panel removed, real background photo + calligraphy image embedded as data URIs. |
| UI-002 | Forgot password (Admin/Association) | Public | Two-step modal: request reset code by email → enter code + new password. `showForgotPasswordModal`/`showResetCodeModal` @1489/1512. | Added Phase 14; uses `MailApp`, 15-min code, generic non-enumerating response. |
| UI-003 | Forgot delegate code | Public (delegate tab) | Informational modal only — "contact your association" — no server call. `showForgotDelegateCodeModal` @1552. | No email path exists for delegate codes by design. |
| UI-004 | Forced password change | Association/Admin (post reset) | Full-screen mandatory flow, no navigation possible until password changed; ends session on success. `renderForcePasswordChange` @1560. | Server-enforced (`requireSession_` blocks all other calls while flag set). |
| UI-005 | Public association application (3-step wizard) | Public | Step 1: association data (name, license #, license expiry, region/city, sector, contact, phone, email builder). Step 2: 8 yes/no acceptance questions sourced from server (`applicationQuestions`). Step 3: license image upload (JPG/PNG/WEBP ≤8MB) + pledge checkbox + review screen. `renderApplyForm`/`applyStepOneHtml`/`TwoHtml`/`ThreeHtml`/`applyReviewHtml` @1785,1651,1680,1701,1719. | Honeypot field (`website`), `clientRequestId` idempotency surviving reload via `sessionStorage`, live status re-check on timeout (`checkApplyStatusAfterTimeout`). |
| UI-006 | Admin Dashboard | ADMIN | 6-module executive dashboard: Beneficiaries, Devices, Associations & Applications, Activities (4 stat-card modules) + full-width "Follow-up & Alerts" panel + "Latest Operations" panel. Every stat is a clickable `<button>` that deep-links to a filtered list page. `renderAdminDashboard` @2193. | Rebuilt in Phase 11 from many separate KPI cards into 6 grouped modules; zero extra Sheets reads. |
| UI-007 | Association Dashboard | ASSOCIATION | KPI row (beneficiaries, approved devices, received devices, delivered devices, delivery-rate %, delegates) + delivery-progress ring/bar + "Operational Focus" panel (`renderAssociationFocus`, computed client-side from already-loaded data: pending-delegate-assignment, failed-delivery, warehouse devices, devices-with-delegate) + Latest Operations. `renderAssociationDashboard` @2140. | Deliberately NOT restructured in Phase 11 (scope frozen). |
| UI-008 | Delegate portal home | DELEGATE | Separate mobile shell: welcome header, "remaining today" / "delivered today" counters, 3 tabs (Task List / Today's Route / History) + settings icon. `renderDelegate` @4542. | No sidebar/admin nav at all — fully distinct experience. |
| UI-009 | Follow-up & Alerts center | ADMIN | Prioritized (critical→high→medium) alert feed with direct click-through to filtered list: pending applications, late/no-evidence activities, association needing follow-up, device status conflicts, beneficiaries without delegate, beneficiaries without devices, stalled deliveries. `renderAlerts`/`buildAlerts_` @2310. | Alerts carry explicit `page`/`filter` fields from server (Phase 11). |
| UI-010 | Beneficiary Needs Review (individual + bulk) | ADMIN/ASSOCIATION | Per-beneficiary modal listing each requested need (e.g. fridge, washer) with individual approve/reject decision + mandatory rejection reason; also a bulk-approve modal across selected beneficiaries. `reviewBeneficiaryModal`/`decideReviewBeneficiary`/`bulkApproveBeneficiariesModal`/`confirmBulkApproveBeneficiaries` @2580,2661,2704,2734. | **Undocumented in HANDOFF/RELEASE** — added post-doc-freeze (git `Phase 3.2A`). Backed by `reviewBeneficiaryNeeds`/`needsSchemaReady` server flag; falls back to "نظام الاحتياجات الجديد غير مُفعَّل بعد" when schema not migrated. |
| UI-011 | Beneficiary table w/ needs & decision columns | ADMIN/ASSOCIATION | Table columns: name, association, review status, needs (requested types), per-need decisions, fulfillment/execution status, delivery status, delegate, actions. `beneficiaryTableRow`/`needFulfillmentCell`/`needDecisionChips` @2467,2441,2456. | Reflects the new per-need approval model layered on top of the legacy single beneficiary-status model. |
| UI-012 | Beneficiaries list/detail | ADMIN/ASSOCIATION | Card + table views, filters (`BENEFICIARY_FILTERS`: جديد/تحت المراجعة/معتمد/بانتظار تحديد الموقع/بانتظار الأجهزة/جاهز للإحالة/جاري التسليم/تم التسليم/تعذر التسليم/ملغي), search, server pagination (`listBeneficiaries`), bulk import modal, Excel template download. `renderBeneficiaries` @2350. | |
| UI-013 | Beneficiary add/edit form | ADMIN/ASSOCIATION | Fields: association (admin only), name, phone, phone2, region/city, district ("الحي", schemaVersion 4), address, landmark, interactive Leaflet/OSM location picker + manual lat/lng fallback, family count, social status, needs checkboxes. `beneficiaryForm`/`locationPickerFields` @2839,2978. | Leaflet lazy-loaded only here; graceful fallback if CDN blocked. |
| UI-014 | Bulk import (CSV/Excel) | ADMIN/ASSOCIATION | Modal with file upload, live preview table (row #, name, coords, ✓/✗ + reason for Excel path), downloadable `.xlsx`/CSV template. `bulkImportModal`/`renderBulkPreviewTable`/`downloadImportTemplateXlsx` @3291,3325,3432. | Invalid rows are excluded from the actual import, never silently coerced. |
| UI-015 | Delivery attempts history (per beneficiary) | ADMIN/ASSOCIATION | Lazy-loaded panel inside beneficiary detail showing every delivery attempt (status, timestamp, delegate, failure reason, proof-image button). `loadDeliveryAttempts`/`renderDeliveryAttempts` @2788,2798. | See Section 2. |
| UI-016 | Associations list/detail/form | ADMIN | CRUD for associations, category field, reset-password action (opens `showCredentialShareModal`). `renderAssociations`/`associationForm`/`resetAssociationPasswordModal` @3497,3761,3740. | |
| UI-017 | Applications review (join requests) | ADMIN | List + detail modal showing all application fields incl. 8 acceptance answers as badges, license file viewer, accept/reject (reject requires reason), accept triggers association creation + `showCredentialShareModal` with WhatsApp share. `renderApplications`/`viewApplication`/`decideApplication` @3548,3581,3634. | |
| UI-018 | Devices list/detail/form | ADMIN (write) / ADMIN+ASSOCIATION (read) | Device CRUD (admin only), device detail (dates, linked beneficiary/delegate, audit trail), filters (`DEVICE_FILTERS`: بالمستودع/مخصص/مع المندوب/تم التسليم/تالف). `renderDevices`/`deviceForm`/`viewDeviceDetail` @3829,3878,3940. | No delete function exists anywhere in the system (by design — "no data deletion"). |
| UI-019 | Delegates list/detail/form | ADMIN/ASSOCIATION | Delegate CRUD, code regeneration (`showSecretReveal`/`showCredentialShareModal`), enable/disable toggle, delegate detail (current task count, delivered count, assigned beneficiaries table), delegate audit-log timeline. `renderDelegates`/`viewDelegate`/`viewDelegateLog`/`delegateLogTimeline` @3984,4037,4072,4086. | |
| UI-020 | Activities / project tracking | ADMIN (write) / ADMIN+ASSOCIATION (read) | Executive 3-layer view: horizontal status-distribution bar (`activityFlowBar`), vertical stage timeline (`activityTimeline`), activity cards grouped by main-activity with progress meter, due/late/evidence-link badges, admin edit button. Filter tabs: all/in-progress/late/completed/upcoming. `renderActivities`/`activityGroups`/`activityCard` @4319,4300,4276. | Rebuilt Phase 9 from a plain table into this 3-layer executive view. |
| UI-021 | Audit log | ADMIN/ASSOCIATION (scoped)/DELEGATE (own only) | Server-paginated, searchable, section-filterable immutable log. `renderAudit` @4455; delegate-specific variant `listDelegateAuditLog`. | No sensitive data (secrets/tokens) ever appears in rows — verified in `security-test.js`. |
| UI-022 | Settings | ADMIN/ASSOCIATION | Change password; association also edits contact info (`updateAssociationSettings`). `renderSettings`/`saveAssociationSettings`/`savePassword` @4468,4510,4523. | |
| UI-023 | Delegate Task List tab | DELEGATE | Cards per assigned beneficiary: name/city/address, delivery-status chip, device tags, last-failed-attempt line, contact actions (WhatsApp/call/copy-phone/maps), "تعذّر" (mark failed) or "↻ إعادة المحاولة" (retry) button, "تأكيد التسليم" (confirm delivery) button (disabled until devices are actually dispatched). `renderDelegateList` @4844. | See Section 2 for full delivery flow. |
| UI-024 | Delegate Today's Route tab | DELEGATE | Opt-in geolocation-based nearest-neighbor ordering (Haversine, straight-line distance, explicitly labeled as non-routing/non-traffic-aware) of beneficiaries with coordinates; beneficiaries without coordinates shown separately with full contact actions, not excluded. Live status re-sync per card without recomputing the route. `renderDelegateRoute`/`startDelegateRoute`/`haversineKm` @4620,4581,4564. | Geolocation requested only on explicit button press; never tracked/stored server-side. |
| UI-025 | Delegate History tab | DELEGATE | List of completed deliveries with proof-image view button per entry; "سجل عملياتي الكامل" (full personal audit log) link. `renderDelegateHistory` @4884. | |
| UI-026 | Delegate delivery confirmation modal | DELEGATE | Photo capture/upload (native `capture="environment"`), live preview, mandatory pledge checkbox, "تم التسليم" button gated until both conditions met (with explicit `aria-describedby` reason text). `deliveryModal`/`updateDeliveryGate`/`handleProofFile`/`saveDelivery` @4949,4984,5000,5026. | See Section 2. |
| UI-027 | Delegate failed-delivery modal | DELEGATE | Reason dropdown (`FAILED_REASONS`: لم يتم التواصل/لا يرد/طلب تأجيل/العنوان غير صحيح/غير موجود/رفض الاستلام) + optional notes. `delegateStatusModal`/`saveDelegateStatus` @4903,4915. | See Section 2. |
| UI-028 | Delegate settings modal | DELEGATE | Read-only profile (name, phone, status, ID) + logout. `delegateSettings` @5053. | |
| UI-029 | Proof-of-delivery image viewer | ADMIN/ASSOCIATION/DELEGATE (scoped) | On-demand modal fetching a single delivery's proof image via `getDeliveryProofImage`; never bulk-loaded, never a raw Drive link. `viewProofImage` @2813. | See Section 2. |
| UI-030 | Credential share modal | ADMIN/ASSOCIATION | Generic one-time-secret display (used for: association temp password on accept, delegate access code on create/regenerate) with copy-secret, copy-full-message, and "Send via WhatsApp" (`wa.me` deep link) buttons; secret never touches `state`/console/audit. `showCredentialShareModal`/`associationAcceptMessage`/`delegateWelcomeMessage` @4772,4750,4758. | Added Phase 13. |

---

## Section 2 — Delivery / Proof-of-Delivery Workflow (critical for NODE-6 parity)

This is entirely delegate-portal-orchestrated (no admin/association step in
the live confirmation itself) and is one of the most deliberately
engineered parts of the legacy UI — several rounds of live-bug fixes are
documented specifically for this flow.

**State machine** (enforced server-side in `StateRules.gs`, mirrored in UI
disabled-states): a beneficiary's `deliveryStatus` moves
`لم يبدأ → خرج مع المندوب → تم التسليم` (happy path) or
`خرج مع المندوب → تعذر التسليم → (retry) → خرج مع المندوب → تم التسليم`.
`تم التسليم` is a true terminal state with **no self-loop** — re-confirming
an already-completed delivery is always rejected, not silently accepted as
a no-op (a deliberate design decision made during Phase 1, called out
explicitly in `HANDOFF.md` as "a subtle but important distinction fixed
before any live run").

**1. Dispatch.** A delegate can only see and act on beneficiaries actually
assigned to them (`assignDelegate` moves devices to `مع المندوب` and
beneficiary to `خرج مع المندوب` atomically under `LockService`). The
"تأكيد التسليم" (confirm delivery) button in both the Task List and
Today's Route tab is disabled (with a title/tooltip explaining why) unless
at least one device with status `مع المندوب` exists for that beneficiary
(`routeStationCanDeliver`/`canDeliver` checks, Index.html:4610,4857).

**2. Confirm delivery (`deliveryModal`, Index.html:4949).** Opens a modal
showing beneficiary name/address/device tags, then:
- A file input (`accept="image/jpeg,image/png,image/webp"`,
  `capture="environment"` — opens the phone camera directly on mobile) —
  label reads "التقاط أو اختيار صورة الإثبات" (capture or choose proof
  photo). Hint: "JPG أو PNG أو WEBP — بحد أقصى ٦ ميجابايت."
- Client-side validation on file select (`handleProofFile`,
  Index.html:5000): rejects >6MB or non-whitelisted MIME type with a
  toast, reads the file via `FileReader.readAsDataURL` into
  `state.proofData`, shows a live `<img>` preview.
- A mandatory pledge checkbox: "أؤكّد أنني سلّمت الأجهزة المذكورة أعلاه
  إلى المستفيد، وأن الصورة المرفقة إثبات صحيح للتسليم" (I confirm I
  delivered the listed devices to the beneficiary and the attached photo
  is genuine proof of delivery).
- **Gate**: the "تم التسليم" submit button starts `disabled`;
  `updateDeliveryGate()` (Index.html:4984) re-evaluates on every photo/
  checkbox change and enables the button only when both a photo is
  attached AND the pledge is checked, writing the specific missing
  condition(s) into a live `role="status" aria-live="polite"` hint text
  next to the button. A code comment flags this was a **live-observed bug
  fix** (2026/08/01): previously the disabled reason was only discoverable
  *after* clicking, not before.
- On submit (`saveDelivery`, Index.html:5026): calls
  `confirmDelivery(token, {beneficiaryId, proofDataUrl, confirmed: true,
  opId})`. `opId` is stable per-beneficiary across retries of the *same*
  attempt (survives timeout-triggered re-clicks) so a network timeout
  followed by resubmission cannot double-record a delivery — the server
  (`withIdempotency_`) replays the original successful result instead of
  re-executing.
- On success: beneficiary is removed from the delegate's active task list
  entirely (`removeEntity`), `remaining`/`deliveredToday` counters update
  locally without a full reload, modal closes, success toast shown.

**3. Server-side proof integrity (from `SECURITY_REVIEW.md` §6, confirmed
applicable to this exact flow).** A confirmed real vulnerability found and
fixed in this project: `saveProofImage_` originally only checked the
client-declared `data:image/...;base64,` prefix — any client could label
arbitrary content (text/HTML) with that prefix and pass validation.
Fixed by adding `verifyImageMagicBytes_()` which checks the actual decoded
byte signature (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WEBP
`RIFF....WEBP`) and rejects anything not matching. Other controls: 6MB
hard cap before any Drive upload, server-generated filename
(`beneficiaryId + timestamp + extension`, never client-supplied → no path
traversal), single fixed private Drive folder (`proofFolder_()`, ID in
Script Properties, no public sharing set programmatically), delegate can
only upload proof for a beneficiary actually assigned to them
(`confirmDelivery_` checks `رقم المندوب` before calling
`saveProofImage_`), and `LockService` + `withIdempotency_` together
prevent a double-submit race from creating two delivery records. **Known
un-covered gap, explicitly documented**: no check of actual image
*dimensions* or visual content (e.g., detecting a blank/black photo) —
out of scope without a paid image-processing service.

**4. Proof image access is fully gated and lazy.** As of Phase 12,
`saveProofImage_` stopped returning a public Drive URL at all — it stores
only `{fileId, fileName, fileType, fileSize}`. The only way to view a
proof image is `getDeliveryProofImage(token, deliveryId)`
(`Index.html:2813`, `viewProofImage`), a guarded RPC that streams the
bytes back as a `data:` URL: ADMIN can view any delivery's proof,
ASSOCIATION only its own beneficiaries', DELEGATE only their own
deliveries. It is never bulk-loaded — each click is a fresh guarded
fetch, and each view is itself audit-logged server-side.

**5. Failed delivery ("تعذّر التسليم").** `delegateStatusModal`
(Index.html:4903) — a required reason dropdown (`FAILED_REASONS`: لم يتم
التواصل / لا يرد / طلب تأجيل / العنوان غير صحيح / غير موجود / رفض
الاستلام — "could not reach / no answer / requested postponement / wrong
address / not found / refused to accept") + optional free-text notes.
Devices remain physically `مع المندوب` (with the delegate) — this state
does **not** return devices to the warehouse, only flips the beneficiary's
`deliveryStatus`. Server only accepts this transition from `خرج مع
المندوب` (can't fail-mark a beneficiary whose devices never left).

**6. Retry ("↻ إعادة المحاولة").** A single explicit button
(`retryDelivery`, Index.html:4937) that flips `deliveryStatus` back to
`خرج مع المندوب` without touching devices, the delegate assignment, or
the prior attempt history. `HANDOFF.md` documents this explicitly as
replacing a prior *workaround* that was "the only practical solution" —
an association previously had to go into "Change Delegate" and re-save
the same delegate just to unstick a failed delivery. This is now a
first-class one-click action available from both the Task List and
Today's Route cards.

**7. Attempt history is cumulative, never overwritten.**
`deliveryAttemptsFor_` builds the full attempt list (successful or
failed) from the delivery-records sheet; nothing is erased on retry.
Visible to admin/association via the beneficiary detail's lazy-loaded
"سجل التسليم" panel (`loadDeliveryAttempts`/`renderDeliveryAttempts`,
each row: status chip, timestamp, delegate name, failure reason if any,
"🖼 عرض صورة الإثبات" button if a proof exists for that attempt) and to
the delegate via the same button embedded in their own History tab.

**8. Known live-observed bugs already fixed in this exact flow** (per
`HANDOFF.md` "Phase 9" section, dated to a live test round on
2026/08/01): (a) devices disappearing from a beneficiary's card
immediately after a failed-delivery mark, because the partial-save
response previously returned only the beneficiary `record` and the client
replaced the whole list item, losing the embedded `devices` array — fixed
by having every delegate-portal mutation response return the full
`delegateTaskPayload_` (record + devices + attempts) and merging instead
of replacing; (b) the Today's Route tab not reflecting a just-confirmed/
just-failed delivery without a full page reload, fixed by re-reading live
status per card on every render via `findBeneficiary(id)` while keeping
the originally-computed route order/distance stable.

---

## Section 3 — Documented Decisions & Requirements

- **No hard deletion anywhere in the system, for any role** — explicitly
  called out as a deliberate rule ("لا حذف بيانات أو وظائف قائمة") and
  verified: "لا توجد أي دالة حذف جهاز في كامل المشروع لأي دور."
  (`SECURITY_REVIEW.md` §3)
- **`Index.html` deliberately kept as a single file**, re-evaluated and
  re-confirmed at every major phase (Phase 3, 8, 9): `HtmlService.include()`
  concatenates text server-side before sending, so splitting doesn't
  reduce payload and increases risk of hitting Apps Script's per-file size
  limits — "exactly the class of failure that was the project's original
  outage cause." (`README.md` "الأداء", `SECURITY_REVIEW.md` §8,
  `RELEASE.md` §14)
- **No paid API/service anywhere** — explicit constraint honored
  throughout: Leaflet + OpenStreetMap tiles (free, no key) for the
  location picker; Haversine straight-line "nearest neighbor" routing
  (free, explicitly labeled as *not* real turn-by-turn routing) instead
  of Google Directions API; `tel:`/WhatsApp/Google Maps as plain links,
  no Maps JavaScript API. (`README.md`, `HANDOFF.md` Phase 5)
- **OpenStreetMap standard tile server flagged as a real operational
  risk** if usage grows — subject to OSMF fair-use policy, not approved
  for heavy production use; recommendation to migrate to a
  production-tier free tile provider (MapTiler/Stadia) or self-hosted
  tiles is documented but explicitly deferred as "your decision" since it
  requires registering an external account, which was out of scope for
  that session. (`SECURITY_REVIEW.md` §7)
- **Maintenance/migration functions require a temporary, hashed,
  time-boxed access token (`grantMaintenanceAccess_`)** — added as a
  second independent defense layer on top of Apps Script's `_`-suffix
  privacy convention, because *any* non-underscore top-level function in
  an Apps Script project is automatically callable via
  `google.script.run` by anyone who opens the deployed web app URL,
  regardless of whether the client UI calls it. This was a **confirmed
  real vulnerability** (all setup/migration functions were previously
  callable with zero session check) that was actually fixed, not just
  documented. (`SECURITY_REVIEW.md` §2, `DEPLOYMENT.md` §5)
- **Idempotency (`opId`/`withIdempotency_`) is explicitly a short-lived,
  best-effort mitigation only** (5-minute `CacheService` TTL, no strict
  durability guarantee from Google) — a **durable idempotency ledger on
  an independent store is documented as a mandatory P1 item before any
  production launch**, deliberately not built yet. (`HANDOFF.md` Phase 3
  §7, `RELEASE.md` §23 "Phase 2.3.4")
- **Google Sheets has no true server-side OFFSET/LIMIT query** — every
  `list*()` call still reads the *entire* sheet into Apps Script memory
  then filters/sorts/paginates locally. Measured to scale roughly
  linearly with row count; explicitly flagged as an **architectural
  ceiling** that becomes noticeable around 5,000 beneficiaries and would
  require "indexing/an independent database" to fix — called out as a
  separate future architectural decision, not a bug in the current phase.
  (`RELEASE.md` §9) — **directly relevant to the Node/Postgres migration
  rationale.**
- **Full 3-portal integration journey is scripted and passing**:
  `tools/integration-test.js` runs one continuous flow — association
  application → acceptance → forced password change → delegate creation →
  single + bulk beneficiary onboarding → device allocation → delegate
  assignment → failure + retry → actual documented delivery → dashboard/
  list consistency → two-association isolation → session/token
  revocation. This is effectively the canonical "what must work
  end-to-end" acceptance spec for parity purposes. (`README.md`,
  `HANDOFF.md`)
- **Test-suite scale at last doc update**: 1095/1095 assertions across 9
  tools (`verify`, `smoke`, `server-test`, `security-test`, `state-test`,
  `account-test`, `perf-test`, `reference-test`, `integration-test`) with
  zero regressions across the whole branch history — used as the release
  gate. (`HANDOFF.md`)
- **Security review is explicitly self-described as *not* a substitute
  for a professional penetration test** — every doc repeats this caveat
  verbatim ("ليست اختبار اختراق مستقلًا ولا معتمَدًا"). An independent
  pen test is listed as still outstanding. (`SECURITY_REVIEW.md`,
  `DEPLOYMENT.md` "بنود لا تزال تحتاج اختبارًا حيًا")
- **Passwords/delegate codes**: `Utilities.getUuid()`-based generation,
  stored hashed+salted only, shown to the operator exactly once (via the
  credential-share modal), never logged to audit/console, and rotating a
  credential immediately revokes all sessions opened with the old one.
  (`SECURITY_REVIEW.md` §4, `HANDOFF.md` Phase 2)
- **No live deployment or production data has ever been touched from
  any of these authoring sessions** — every phase explicitly states no
  `setupSheets_`/migration/`applyReleaseSchema_` was run against live
  data; everything is code-only until a human operator runs it.
  (repeated throughout `DEPLOYMENT.md`, `HANDOFF.md`, `RELEASE.md`)

---

## Section 4 — Explicitly Deferred / Not Built in Legacy

- **Durable idempotency ledger** (independent store, not cache-based) —
  documented P1-before-production, deliberately unbuilt. (`RELEASE.md`
  §23, `HANDOFF.md` Phase 3)
- **`listDevices`/`listAssociations`/`listDelegates` server pagination**
  is fully built and tested server-side but **never wired into the
  actual list-page UI** — those three pages still load the entire table
  from `getBootstrapData` client-side. Only `beneficiaries`, `audit`, and
  `applications` were actually converted to paginated fetch-on-open.
  Documented as a scoped, deliberate partial rollout, not an oversight.
  (`HANDOFF.md` Phase 3 "توضيح حرج")
- **`beneficiaries` array still sent twice** (once fully inside
  `getBootstrapData`, again via paginated `listBeneficiaries` when the
  page opens) — known, documented, intentionally not resolved because
  removing it would require rewriting every place in `Index.html` that
  assumes the full array is available locally (dropdowns, name lookups,
  KPI click-filtering). (`HANDOFF.md` Phase 3)
- **Interactive column-header sort (click-to-sort) in table UIs** — server
  supports `sortBy`/`sortDir` fully; no UI control exists to set it yet
  (default sort only). (`HANDOFF.md` Phase 3)
- **`repairStateIntegrityIssues()`** — fully built, tested, but *never
  invoked from anywhere in the app* and never run against live data; a
  manual, explicit, human-approved-only tool. (`HANDOFF.md` Phase 1)
- **`migrateLegacyReferenceValues()` / `migrateReferenceData()`** —
  built, dry-run-capable, but never executed on live data; reference
  dropdowns fall back to free-text until an operator runs the migration.
  (`HANDOFF.md` Phase 4)
- **Forced password change on *account creation*** (new association from
  accepted application, or admin-added) — only enforced on the explicit
  **password-reset** path, not on initial account creation. Documented as
  "logical and consistent to extend, but a separate decision requiring
  an explicit request." (`HANDOFF.md` Phase 2)
- **Password-reuse prevention is only 1-generation deep** (compares
  against current + immediately-previous password only, not a full
  history) — documented as a conscious architectural limit, not an
  oversight. (`HANDOFF.md` Phase 2)
- **No standalone "association account details" page** (e.g. detailed
  login history) — only the existing popup/detail view. (`HANDOFF.md`
  Phase 2)
- **Device form status dropdown still visually shows all 5 device
  statuses** (including server-protected ones like "مع المندوب"/"تم
  التسليم") even though the server always rejects setting them manually
  — a cosmetic follow-up deliberately deferred until state-safety work
  finished first. (`HANDOFF.md` Phase 1)
- **No independent penetration test performed** — automated
  code-level/simulated security review only. (all docs)
- **No live browser/mobile-device testing performed from within any
  authoring session** — Leaflet map rendering, camera capture, WhatsApp
  app hand-off, real network timing, WCAG contrast/screen-reader
  behavior, and `MailApp` daily-quota behavior are all listed as
  "verified only in Node.js simulation / Playwright preview, not on a
  live deployment or real device." (`DEPLOYMENT.md` closing section,
  `HANDOFF.md` per-phase "ما لم يُختبَر حيًّا")
- **Image *content* validation beyond byte-signature** (dimensions,
  blank/black-photo detection) for delivery proof — explicitly out of
  scope without a paid image-processing service. (`SECURITY_REVIEW.md`
  §6)
- **A "جاري التجهيز" (in-preparation) intermediate delivery state
  exists in the schema/transition map but is no longer reachable from any
  current code path** — kept only for backward compatibility with old/
  imported data; `assignDelegate` now jumps straight from "لم يبدأ" to
  "خرج مع المندوب". (`HANDOFF.md` Phase 1)

---

## Section 5 — Post-Legacy / Modern Feature Ideas Mentioned in Docs

The five audited docs are legacy-only (they describe the Apps Script
system's own internal roadmap, not a forward-looking Node migration plan)
— so there is **no explicit "build this in the new platform" wishlist**
inside them. The closest things to modern/forward-looking signals found:

- **The Sheets-as-database ceiling is explicitly named as the reason a
  future architecture change would be needed**: "requires indexing / an
  independent database" once beneficiary counts reach the tens of
  thousands — read as tacit acknowledgment that the *next* system (i.e.
  this Node/Postgres migration) is the intended answer to a limit the
  legacy system cannot solve within its own constraints. (`RELEASE.md`
  §9)
- **A durable idempotency ledger on an independent data store** is
  described in almost database-agnostic terms ("جدول/قاعدة بيانات
  مستقلة") — effectively a requirement statement that maps directly onto
  something a proper backend+DB (i.e., the new platform) should provide
  natively, where the legacy system could only fake it with a 5-minute
  cache.
- **Production-tier map tiles** (MapTiler/Stadia/self-hosted) flagged as
  the natural next step beyond the free OSM tile server if usage grows —
  a concrete, small, portable feature idea for the new platform's
  location picker.
- **The already-in-progress `NODE-*` commit series in this same repo**
  (visible via `git log`, e.g. `NODE-2.2`, `NODE-3`, `NODE-3.1`,
  `NODE-3.2`, `NODE-3.3`, `NODE-4`, `NODE-4.1`, `NODE-4.2`, `NODE-4.2.1`,
  plus `HOSTINGER-TEST-0` through `0.5`) is itself the strongest signal
  of what's considered "next": beneficiary needs/review (`NODE-3` family,
  mirroring legacy `Phase 3.2A`), receipt batches + device inventory
  (`NODE-4` family, mirroring legacy `ReceiptBatches.gs`), and initial
  Hostinger-managed deployment plumbing (`HOSTINGER-TEST-*`) — these are
  **out of scope for this document** (not covered by the 5 docs audited)
  but should be cross-referenced by whichever audit thread covers the
  `platform/` directory and the newer `.gs` files, since they represent
  legacy features that *never made it into* `HANDOFF.md`/`RELEASE.md`
  and are consequently invisible to anyone who only reads those two
  files.

**Recommendation for the parity investigation**: treat `HANDOFF.md` and
`RELEASE.md` as authoritative only through "Phase 14" (forgot-password/
glass-card). For beneficiary-needs review, auto-allocation, and receipt
batches — all visibly wired into `Index.html`'s current UI (Section 1,
UI-010/UI-011) — the `.gs` source files themselves (`BeneficiaryNeeds.gs`,
`AutoAllocation.gs`, `ReceiptBatches.gs`) and their git commit messages
are the only reliable source of truth, since the narrative docs never
caught up to them.
