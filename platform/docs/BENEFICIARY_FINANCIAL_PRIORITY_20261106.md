# Read-only beneficiary financial priority

## Scope

Local implementation based on the reviewed historical pilot. No schema migration, production write, email, acceptance, rejection or allocation is performed. This is a financial recommendation, not completed holistic need scoring. Disease, disability, loss of provider and other narrative circumstances remain original evidence shown for human review; no unapproved numeric weights or inferred diagnoses are applied.

Each association is independent. For valid active household records, compute household income / member count and the association median. HIGH is <=75% of that median, MEDIUM is above that through 125%, LOW is above 125%. These are relative financial labels, not official poverty/eligibility thresholds. Different associations can classify the same per-person income differently. Equal financial ratios sort by original association priority; a final stable ID tie is technical only, not additional evidence of need. Missing/invalid income or count is UNCLASSIFIED, never treated as zero. Explicit zero is retained. Zero with social security is an ambiguity notice, not an automatic correction or rejection.

## Backend and scope

`GET /beneficiary-workspace/priorities?associationId=<uuid>` requires ADMIN and `beneficiaries.read`. One explicit allowed, non-archived, non-demo association is required. Household scope is enforced again in the cohort query; archived households are excluded. No phone, address, identity or contact fields are selected. A cohort above 5000 is rejected rather than silently truncated. Ratios and class boundaries use integer cents and rational comparisons to avoid rounding errors. Class ranks derive from the complete association, not current page/search/city/device filters.

The existing list/overview/review endpoints retain their old behavior. Priority retrieval is independent so failures do not block the household list. No model, external AI service, vector store, background process or additional dependency is introduced. Recommendations are not stored as beneficiary decisions.

## Frontend

A compact badge such as `مرتفعة · 2` is visible in the existing income cell, with per-person income below it. The selected association has a one-line expandable summary. The badge opens a read-only accessible dialog with household income, count, per-person income, original priority, source narratives and warnings. No new data entry or decision buttons are introduced. Existing metrics and filters remain.

The separate read request runs on association/review refresh, not every household search. Responses are aborted on scope change; stale association/revision results are hidden, and each badge is additionally matched to the exact household source version. Original UI review routes, dirty-state behavior and decision version checks are unchanged. Narrative text is rendered as escaped text; no HTML or instruction execution.

## Verification

- 32 API tests: pure priority rules, scoped read service and existing review/navigation/rules. Unresolved ties share a rank instead of inventing need differences from identifiers.
- 120 existing web tests including exact household/version matching for recommendations.
- API TypeScript check/build and Next production build.
- Pure TypeScript engine matched all 20 historical pilot rows, including ranks, classes and per-person amounts, computed from all 100 household rows in the backup.
- Local calculation benchmark for 1200 synthetic rows /24 independent associations: under 10ms in the recorded runs; excludes DB/network and is not a live page-speed claim.
- Visual preview rendered from actual React components/CSS with synthetic data, expanded/collapsed and 390px mobile dialog; mobile dialog had no horizontal overflow.

## Limitations and release

Live database access was not resolved in this task. No claim is made of live counts, live performance improvement or production end-to-end verification. Narrative weights still need a sufficiently varied current sample and explicit policy review. The local preview is not the full production page or an authenticated integration test. Deploy API then web only after release approval; older API makes recommendation unavailable while the list remains usable. Source-before archive and verification artifacts are under `Downloads/alzad-beneficiary-priority-checkpoint-20261106`.
