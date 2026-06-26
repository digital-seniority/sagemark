# DR-025 — gate-results-table-deferred-to-pr020

**Date:** 2026-06-26
**Run:** #013 (P0.S.2 / PR 009)
**Status:** active
**Build phase:** Phase 0 — Foundations (closing) → Phase 1

## Context

A.011.7 (audit-002) bound the publish predicate's `evalRan` to a persisted `gate_results` row's `eval_ran` (replacing the loose `verdict !== null` inference). But the `gate_results` table + its Drizzle definition + migration are authored in **PR 020** (the D4 cost-ledger / scorecard-persistence slice), which is NOT yet built. P0.S.2 added a `getGateResult` seam to `ContentDataAccess` to read it.

## Problem

How should publish behave when `evalRan` must read a `gate_results` row that has no production table/impl yet?

## Options considered

- **Option A (chosen): fixture-injected seam + production stub THROWS (fail-closed) until PR 020 wires the table.**
  - Pros: the correct `evalRan` semantics ship now (tests prove a Stage-A veto → `EVAL_DID_NOT_RUN`); production publish fails LOUD (`DataAccessNotWiredError`) rather than defaulting `evalRan` true; no fail-open window.
  - Cons: production `/api/publish` is unreachable (throws) until PR 020 wires `getGateResult` to the real table — acceptable because publish is gated/undeployed in Phase 0 and the worker isn't near a live tenant.
- **Option B: keep the loose `verdict !== null` heuristic until PR 020.**
  - Cons: the ER-4 fail-open class the audit flagged stays open; a dangling verdict with no scorecard satisfies `evalRan`.
- **Option C: author the `gate_results` table now in P0.S.2.**
  - Cons: scope creep into PR 020's schema slice; the table couples to the cost-ledger design not yet specced.

## Chosen

**Option A.** Rationale: ship the correct fail-closed `evalRan` semantics immediately; defer the table to its owning PR; make the interim state fail-loud, never fail-open.

## Consequences

- **PR 020 MUST**, when it adds the `gate_results` table + Drizzle def + migration: (1) wire the real `ContentDataAccess.getGateResult` to read it; (2) populate `eval_ran` on every gate run; (3) widen the `PersistedAuthorization` projection in `context.ts` to include `granted_at` + `scope` (judge improvement — the active-check is currently narrower than PRD §11.5's "granted, not revoked, not expired" + scope). Until then production publish throws `DataAccessNotWiredError`.
- Closes DR-009's open `evalRan` bullet.
- The `getGateResult` test fixture currently defaults `evalRan:true` (convenience); consider defaulting to `null` so future tests opt into a passing gate.

## Revisit if

- PR 020 lands (wire the table + widen the projection + flip this to discharged).

## Related

- Anchor: engineering-rfc.md PR 020 (D4 ledger), prd.md §9.1 (publish predicate), §11.5 (byline authorization)
- Predecessor DRs: [[DR-009]] (audit-route read-only + the evalRan open bullet this closes)
- PR that prompted: P0.S.2 (PR 009)

---

*Authored by /seo-creator-build · Run #013 · 2026-06-26*
