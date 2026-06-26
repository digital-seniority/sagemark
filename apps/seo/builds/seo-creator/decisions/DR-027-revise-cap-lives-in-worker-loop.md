# DR-027 — revise-cap-lives-in-worker-loop

**Date:** 2026-06-26
**Run:** #015 (P1.W.1 / PR 014)
**Status:** active
**Build phase:** Phase 1 — Pilot

## Context

P1.W.1 wired the full suite chain (strategist→assistant→writer→audit) and needed the N=3 revise cap: after 3 revise cycles, a 4th must route to human review rather than loop. Question: where does the revise *budget* live — the `@sagemark/core` lifecycle FSM, or the worker loop?

## Decision

**The N=3 revise budget lives in the worker loop (`apps/seo/src/worker/loop/revise-cap.ts`), NOT the FSM.** Rationale: the FSM (`@sagemark/core` `lifecycle-fsm.ts`) is pure and stateless over a *single* transition's legality; the revise budget is per-run loop state. `decideRevise` (pure/total) **consults** `canTransition(review→draft)` for legality rather than duplicating FSM rules; revises #1–3 take the legal `review→draft` edge, the 4th returns `forcedToHumanReview` and is **held at `review`** (a legal no-op, `REVISE_CAP_REACHED`), and an illegal edge force-routes to human fail-closed (`REVISE_EDGE_ILLEGAL`). `runReviseLoop` hard-stops at `cap+1` so a malformed stream can't spin.

## Consequences

- Run-budget / loop-counter state belongs in the worker loop layer, not the FSM. Future stages must NOT push per-run counters into `@sagemark/core` (keep it pure over single transitions).
- The cap consults, never duplicates, FSM legality — single source of truth for transition rules stays in core.
- A forced hold = "stay at `review`" (the human-review chokepoint), never an illegal transition.

## Revisit if

- Multiple loop budgets emerge (consider a small worker-side budget manager).
- The FSM ever needs to enforce the cap itself (e.g. server-side replay protection) — then reconcile.

## Related

- Anchor: prd.md §9 (lifecycle / FSM), §C17 (suite chain); engineering-rfc.md PR 014
- Predecessors: [[DR-016]], [[DR-017]] (worker host loop concerns)
- PR: P1.W.1 (PR 014)

---

*Authored by /seo-creator-build · Run #015 · 2026-06-26*
