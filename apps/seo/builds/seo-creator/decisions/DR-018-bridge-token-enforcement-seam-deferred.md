# DR-018 — bridge-token-enforcement-seam-deferred

**Date:** 2026-06-26
**Run:** #009
**Status:** active
**Build phase:** Phase 0 — Foundations

## Context

PR 007 (P0.W.4) builds the worker↔apps/seo SSE transport, including a per-run HS256 **bridge JWT** minted by `/api/run`, scoped to exactly `(workspace_id, client_id, run_id)` and expiring at the run-budget ceiling (~90s). AC6 requires that an expired or cross-run token be "rejected by **every** host tool." PR 007 implements `verifyBridgeToken` as the single verification chokepoint and unit-tests it exhaustively (expired, cross-run, cross-tenant, tampered-signature). But the four `/content/api/*` kernel routes that the worker actually calls are **PR 005-owned** and outside PR 007's write-scope — so the verifier is built and tested, but **not yet invoked at the host-tool call sites**.

## Problem

How do we honor AC6 ("rejected by every host tool") when the verifier (PR 007) and its call sites (the PR-005 kernel routes) live in different PRs' write-scopes — without scope-creeping PR 007 into PR-005-owned files?

## Options considered

- **Option A: Defer the wiring to a follow-up corrective, ship PR 007 with the verifier + contract tests only.**
  - Pros: keeps PR 007 in-scope; verifier contract is provably correct in isolation; worker is flag-gated/undeployed so nothing is live.
  - Cons: until wired, the worker→host bridge is authenticated only by convention; AC6 is not enforced end-to-end; a regression that forgets a call site won't fail CI yet.
- **Option B: Expand PR 007's write-scope to edit the four PR-005 kernel routes.**
  - Pros: AC6 enforced end-to-end immediately.
  - Cons: cross-lane scope creep (judge flags it); two PRs both editing the kernel routes invites conflict; violates the write-scope discipline the flywheel depends on.
- **Option C: Block PR 007 (NEEDS-FIXES) until the routes are wired.**
  - Pros: no merge until end-to-end.
  - Cons: the wiring is genuinely not PR 007's to do; the verifier contract is complete and correct; blocking penalizes a clean slice for a cross-PR seam.

## Chosen

**Option A** — defer the call-site wiring to a tracked follow-up, ship PR 007's verifier + contract tests. Rationale: the verifier is the hard part and is provably correct; the call-site insertion is mechanical and belongs to the PR-005 route owner; the worker is flag-gated and undeployed, so there is no live exposure window. The judge approved on this basis but flagged it as the #1 agency-ending-risk surface that currently "rests on convention until wired."

## Consequences

- **A corrective/integration PR (candidate C.009.x or folded into P0.W.5/PR 008's wiring) MUST add `verifyBridgeToken` to all four `/content/api/*` kernel routes** and add an **integration test that fails CI until every host tool invokes the verifier.** This is a release gate before the worker goes near a paying tenant.
- Until that lands, the worker→host bridge is authenticated by convention, not by enforced check — acceptable ONLY while the worker is flag-gated and undeployed.
- Pattern for future PRs: when an AC's verb names a call-site owned by another PR, record the verifier-vs-caller split as a planned decision with a named integration-test owner — don't discover it at implementation time.

## Revisit if

- The worker is about to be deployed to a live tenant (the wiring becomes a hard go-live blocker).
- P0.W.5 (PR 008) or the PR-005 owner lands route changes — fold the `verifyBridgeToken` call + integration test in then.

## Related

- Anchor sub-page: plans/seo-creator/flywheel/engineering-rfc.md (PR 007 AC6), plans/seo-creator/flywheel/prd.md §11.4 (this DR honors the anchors; it does not weaken the scoping requirement, only sequences the enforcement)
- Predecessor DRs: [[DR-016]] (worker model traffic via env seam)
- PR that prompted: P0.W.4 (PR 007)

---

*Authored by /seo-creator-build · Run #009 · 2026-06-26*
