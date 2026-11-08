# Count-only beneficiary proposal — local implementation

This feature is a read-only financial simulation, not beneficiary approval, need approval, stock allocation, signature or mail. It adds a separate GET endpoint and an opt-in compact section/column on the existing beneficiary page. The existing planning dialog and write flows are unchanged. No migration, dependency or environment change is required.

## Proposed policy, visible in the UI

- Input total: integer0–10000. The denominator is all active non-archived non-demo associations; only the requested association's authorized households are returned. Regional administrators never divide the whole project total by their regional subset.
- The association gets `floor(total / associationCount)`. The division remainder is displayed unassigned and never awarded by ID/name/order. The selected association's unused quota is displayed separately; other associations' unused quota is not claimed to be known.
- Current financial classification/ranking is reused. Classifying the cohort includes all active households as before; new count proposals exclude previously rejected and financially unclassified families. Existing allocations remain fixed and consume the quota, including active allocations outside the returned active-household cohort.
- For an association quota Q, the initial coverage planning target starts at `floor(Q /1.4)` from the70/20/10 family mix. Exact two-device families are capped at20% and exact three-device families at10% of the initial selected pool; these caps remain conservative as additional first-device families are added. They are upper bounds, never targets to fill.
- Higher financial priority families come first. Third-device proposals are restricted to HIGH financial families in this version; second-device proposals to HIGH then MEDIUM. The additional counts are conditional on subsequent review of necessity. No narrative weight, diagnosis or truth judgment is invented. The UI explicitly describes this policy and its financial-only basis for review.
- Caps are rounded down, preserving hard upper bounds. Integer-rounding can otherwise reduce coverage when Q increases, so bounded preceding quotas establish a nondecreasing minimum coverage target. A shared unresolved financial rank is treated as a group; a partial boundary never uses an identifier to select a winner.
- After conditional additional proposals, remaining slots go to first devices for next families. Zero means outside this proposal or waiting for data/tie review, not a rejection.
- Existing allocations are never revoked to satisfy new shares/quota; any existing exception is shown. Larger-than-safe analysis workloads are rejected with an explicit bounded-analysis error rather than partially ranking an association.

The target-pool/cap interaction above is a concrete policy interpretation to review in the local preview, not evidence that each additional device is necessary. No production deployment has been performed for this feature.

## API / security / freshness

`GET /beneficiary-workspace/count-proposals?total=1150&associationId=<uuid>` requires ADMIN and `beneficiaries.read`, validates DTOs, checks the selected association before cohort or global-count reads, applies scope again to the cohort, uses a repeatable-read transaction and returns `private, no-store`. It selects no names, phones, addresses or narrative text. The full cohort is used regardless of search/page/city/device filters, and a cohort above5000 is rejected.

The response carries the exact parent source version plus a fingerprint of the family review status and all need IDs/decisions. The UI additionally matches association, input total, request generation and review revision. It aborts superseded requests and hides stale responses/changed-input results. No query runs for every search keystroke; total is applied explicitly. Failures do not block household review. Types are never selected: partial proposals say the type has not been determined; a complete count merely covers the existing non-rejected request set.

## Checks and limits

- 11 feature API tests cover integer/cap/conservation/monotonicity properties, unresolved ties, existing allocations, scope, global denominator and cohort limits. Existing priority/workspace tests also passed (43 API tests across the six relevant suites).
- 121 web tests passed, including hiding source/review/device-stale proposals. API and web production builds passed.
- The actual rule engine was run against the saved read-only study cohort:1123 unique household IDs from24 associations, totals1000/1150/1200. All count/cap/conservation checks passed. Existing allocation counts were assumed zero for that offline comparison, since the study snapshot does not contain them. Runtime about92ms for all three scenarios on the local run; excludes DB/network and is not a live speed claim.
- Local preview uses the actual React components/CSS and actual pure rule engine with synthetic household data. Its small standalone interaction harness is not the authenticated full Next application and does not verify the real React fetch lifecycle end to end. It demonstrates0/1/2/3 proposals,2-of-3 without choosing types, total changes and a390px dialog without horizontal overflow.
- No authenticated production check or deployment is claimed. API then web release remains pending. The before-source archive, preview and verification artifacts are in `Downloads/alzad-count-proposals-checkpoint-20261108`.
