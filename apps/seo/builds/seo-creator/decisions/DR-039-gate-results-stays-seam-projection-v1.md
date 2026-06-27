# DR-039 — gate-results-stays-seam-projection-v1

**Date:** 2026-06-26
**Run:** audit-005 (consolidation; supersedes part of [[DR-025]])
**Status:** active — **supersedes [[DR-025]]'s `gate_results`-table mandate**
**Build phase:** Phase 1 — Pilot

## Context

[[DR-025]] (Run #013) deferred a persisted `gate_results` audit table to "PR 020" and listed three binding obligations PR 020 MUST do: (1) add the `gate_results` table + Drizzle def + migration and wire `getGateResult` to it; (2) populate `eval_ran` on every gate run; (3) widen the `PersistedAuthorization` projection in `context.ts` to include `granted_at` + `scope`. The RFC §3.1/§3.3 + PRD §6/§9.1 likewise describe `gate_results` as a first-class queryable audit table (with `idx(sourcing_blocked)` driving the D3 reversal metric).

P1.C.3 (PR 020, #58) shipped the cost ledger + share-of-model but **computed the gate-block-by-sourcing rate from a seam-level projection of existing gate-result data** (`getGateResult`, `PersistedGateResult.sourcingBlocked`) and persisted NO `gate_results` audit row — the `0039` migration header explicitly states "there is NO `gate_results` table … it is a seam-level projection, not a persisted table." It also did not perform obligation (3). audit-005 flagged this as the unmet DR-025 obligation (H1/H2) + a decision-gap (M4).

## Decision

**`gate_results` stays a SEAM-LEVEL PROJECTION in v1 — no persisted audit table.** The D3 gate-block-by-sourcing metric is computed from the existing gate-result data via the data-access seam (`getGateResult` → `PersistedGateResult`), which is sufficient for the pilot's metric needs. DR-025's obligation (1) (add the table) is **superseded**; obligation (2) (`eval_ran`) is satisfied at the verdict-persistence layer (the gate verdict is bound to a persisted version row, not a separate results table).

DR-025 obligation **(3) — widening `PersistedAuthorization` with `granted_at` + `scope` — is NOT superseded.** It is load-bearing for the §11.5 YMYL release predicate ("granted, not revoked, not expired" + scope), which today cannot evaluate `scope` and treats "granted" implicitly. It is re-scoped to **corrective A.005.1** (audit-005).

## Options considered

- **A: ship the `gate_results` table now** (DR-025 as written) — Pros: queryable audit row, matches the RFC. Cons: another table + migration + a writer the live `ContentDataAccess` pipeline doesn't yet have (DR-026 deferral); the D3 metric doesn't need a separate table when the projection suffices for v1.
- **B (chosen): seam projection in v1** — Pros: no extra schema; the metric is computed from data the gate already produces; defers the table until a real audit/queryability requirement appears. Cons: spec drift (RFC/PRD still describe a table) — reconciled via spec-update A.005.3.

## Consequences

- **Spec-update (A.005.3):** RFC §3.1/§3.3 + PRD §6/§9.1 must record that `gate_results` is a seam projection (no table) in v1, with the "revisit if a queryable audit row is required" condition.
- **A.005.1 (load-bearing):** widen `PersistedAuthorization` to `{id, grantedAt, scope, revokedAt, expiresAt}` so the §11.5 active-authorization check evaluates scope + explicit grant; and wire `recordCredentialedRelease` into the live publish/sign-off flow with `pilot:false` in production ([[DR-037]]) + a test.
- **Revisit if:** a queryable gate-audit requirement (per-veto-code FP/FN dashboards beyond the in-seam projection, or a compliance audit trail) appears → add the `gate_results` table then.

## Links

[[DR-025]] (superseded re: the table), [[DR-037]] (pilot:false go-live), [[DR-026]] (live adapter deferral), P1.C.3 / PR 020 (#58); audit-005 H1/H2/M4; RFC §3.1/§3.3, PRD §6/§9.1.
