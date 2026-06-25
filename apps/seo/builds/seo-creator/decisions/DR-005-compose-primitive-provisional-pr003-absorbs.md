# DR-005 — compose-primitive-provisional-pr003-absorbs

**Date:** 2026-06-25
**Run:** #002
**Status:** active
**Build phase:** Phase 0 — Foundations

## Context

P0.E.2 (PR 002) acceptance criterion 4 requires "a thrown scorer surfaces as a fail-closed
error, never a silent pass (test injects a throw and asserts the gate composer would veto)."
But "the gate composer" is **PR 003's `seo-gate`**, which is not yet built. To satisfy the
criterion without leaving a load-bearing fail-closed guarantee unmet, the agent authored a
minimal net-new primitive `packages/core/src/scorers/compose.ts` (`runScorersFailClosed` →
`VETO_SCORER_THREW`). The judge approved it as a justified minimal backstop but flagged the
markdown/logic-drift risk (judge §10: the agentic path and the operator-console path must
never fork the gate logic).

## Problem

A net-new composer in `@sagemark/core` pre-empts PR 003's `seo-gate`. If PR 003 re-implements
its own composition loop instead of consuming/absorbing `compose.ts`, the build ends up with
two fail-closed composers that can drift apart — exactly the forked-logic anti-pattern.

## Chosen

**`compose.ts` is PROVISIONAL.** It exists only to give criterion 4 a real, testable host-side
backstop now. **PR 003's `seo-gate` MUST absorb-or-delete it** (either build Stage-A/Stage-B on
top of `runScorersFailClosed`, or replace it and remove the file) — it must NOT introduce a
second, independent composer.

## Consequences

- `packages/core/src/scorers/compose.ts` is a temporary primitive. The PR 003 agent prompt MUST
  be told: consume or supersede `compose.ts`; do not fork a parallel composer. The PR 003 judge
  MUST verify there is exactly ONE fail-closed composition path after PR 003 lands.
- If PR 003 supersedes it, delete `compose.ts` + its test in that PR.
- This DR is the single source of the "one composer" invariant for the gate.

## Revisit if

- PR 003's seo-gate lands and absorbs/replaces compose.ts (then mark this DR satisfied/superseded).

## Related

- Anchor: engineering-rfc.md (### PR 002 criterion 4, ### PR 003 seo-gate)
- PR that prompted: P0.E.2 · Predecessor DRs: DR-001, DR-004
- Forward-binding on: P0.E.3 (PR 003)

---

*Authored by /seo-creator-build · Run #002 · 2026-06-25 20:05*
