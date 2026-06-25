# DR-009 — audit-route-read-only

**Date:** 2026-06-25
**Run:** #004
**Status:** active
**Build phase:** Phase 0 — Foundations

## Context

P0.E.4 ported the `/content/api/{brief,draft,audit,publish}` kernel route contract from
flywheel-main origin/preview. flywheel-main's `/content/api/audit` route MUTATES — it persists
a scorecard and moves `draft→review` as a side effect. The sagemark RFC (PR 005 criterion 1 +
the risk note) mandates the **opposite**: audit must be **read-only** ("an `/content/api/audit`
that can mutate … collapses the moat"). The agent followed the sagemark spec and made audit
read-only by TYPE (the route receives a `ReadOnlyDataAccess` view that structurally lacks the
mutation methods); a spy test asserts zero writes. The judge confirmed this is spec-correct and
the safer moat.

## Decision

**`/content/api/audit` is READ-ONLY — it returns the verdict + Stage-A/Stage-B detail and never
mutates `status`.** This deliberately diverges from the flywheel-main reference implementation.

## Consequences

- The `draft→review` transition is NOT a side effect of audit. The suite-skill flow (and the
  worker, PR 006) must perform that transition via a SEPARATE explicit lifecycle/publish call —
  do NOT expect audit to advance state.
- Audit's read-only-by-type wiring (`ReadOnlyDataAccess`) is the pattern: evaluation routes get
  a data view without mutation methods, so "audit can't write" is enforced by the type system,
  not just by convention.
- Any future PR that wires the worker's audit step must NOT reintroduce mutation into audit to
  match flywheel-main — that would collapse the read-only moat. If a transition is needed after
  audit, it goes through the publish/lifecycle route where `canPublish`/`assertTransition` runs.

## Open (judge-flagged, for the worker/wiring lane — not blocking now)

- **`evalRan` inference:** publish currently infers `evalRan` from `verdict !== null` (looser than
  "a scorecard row is persisted"). When PR 004 persistence is fully wired, decide whether
  `evalRan` must bind strictly to a persisted scorecard (e.g. `scorecard_id`/`evalScore !== null`)
  so the FSM's "eval-did-not-run" clause can't be satisfied by a dangling verdict.
- **Contract-version pin:** `contract.test.ts` hardcodes `WORKER_PINNED_CONTRACT_VERSION` locally
  as a stand-in; at PR 006 it must move into the worker's source and the test import from there,
  so the build-fails-on-mismatch guarantee is truly host↔worker.

## Revisit if

- The suite-skill flow genuinely requires audit to advance state (then re-design via an explicit
  transition step, not by mutating audit).

## Related

- Anchor: engineering-rfc.md (### PR 005 criterion 1 + risk note) · PR: P0.E.4 (Run #004)
- Forward-binding on: P0.W.2 (PR 006 worker host) wiring of the audit step

---

*Authored by /seo-creator-build · Run #004 · 2026-06-25 20:50*
