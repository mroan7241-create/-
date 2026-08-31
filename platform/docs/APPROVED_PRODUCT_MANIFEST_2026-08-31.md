# Approved product manifest — 2026-08-31

This manifest is the implementation boundary for the final reconciliation. It records approved behavior only; it does not introduce business values.

## Roles and boundaries

- `ADMIN`: full Zaad operational administration.
- `ASSOCIATION`: tenant-scoped association operations only.
- `DELEGATE`: assigned field missions only.
- `ABANMI`: read-only project dashboard, aggregated reports, and project tracking. No beneficiary contact/address/authentication data and no mutation authority.

Every boundary is enforced by the API. Client-side routing is usability only.

## Association application lifecycle

`Application → Eligibility → Evaluation → MAIN/RESERVE selection → Agreement/setup → Activation`

- Eligibility states: passed, failed, needs information (pending before a decision).
- Evaluation uses exactly six criteria and totals 100 points: operational readiness 30, technical capability 20, previous experience 20, integrity/transparency 15, participation commitment 10, sustainability/impact 5.
- Geographic need is not an approved criterion or tie-breaker.
- A supporter-approval reference is not required for selection.
- `selection.passThreshold` and `selection.mainTargetCount` have no invented defaults. Until explicitly configured they remain `BUSINESS CONFIG REQUIRED`.
- Credentials are issued only by the actual activation path, never by eligibility or selection display.

## Information architecture

- Applications owns eligibility, evaluation, and final selection as one lifecycle.
- Generic “evaluation and selection” and “work cycles” navigation entries are hidden; approved operations remain reachable in their domain context while consolidation continues without deleting backend capability.
- Association dashboard order: KPIs, real-state attention alerts (critical/medium/low), recent operations.
- Dashboard data is aggregated server-side to avoid browser request fan-out.
- Delegate active missions and history are returned by one complete server query, without a first-100 cap.

## ABANMI portal

- Sections: project dashboard, reports, project tracking.
- Reports: overall, association, region, beneficiaries/needs aggregates, devices/inventory, delivery/execution, association closure and project closure.
- Filters: date, association and region.
- Outputs: on-screen, print-friendly and server-generated XLSX.
- Privacy: no beneficiary PII.
- Mutation attempts and access to admin/association/delegate resources fail at the central auth boundary.

## Release constraints

- Schema changes are append-only. Historical migrations remain immutable.
- No production migration or deployment occurs before local technical, visual, security and cross-role acceptance passes.
- Existing production baseline and rollback references remain preserved.
