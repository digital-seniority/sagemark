# DR-020 — bridge-token-intra-tenant-run-scope

**Date:** 2026-06-26
**Run:** #010 (corrective C.009.1)
**Status:** active
**Build phase:** Phase 0 — Foundations

## Context

C.009.1 (DR-018) wired `verifyBridgeToken` into every `/content/api/*` host tool. Because the kernel routes are stateless tools with no independent "current run" to check against, each route verifies the per-run bridge JWT **against the token's own decoded claims** (signature = authority), then enforces `body.clientId === token.cl`. The judge (5/5·5/5) confirmed this is sound for cross-tenant containment but flagged the intra-tenant consequence.

## Problem

Should the kernel routes bind the token's `run` claim to an independently-known in-flight run id, or is verifying the token against its own claims (so a valid token authorizes any call for that tenant within its ~90s window) acceptable?

## Options considered

- **Option A: Verify against the token's own claims (token authorizes that tenant's run for its lifetime).**
  - Pros: matches PR 007's design intent (a per-run JWT minted host-side authorizes that run); stateless kernel tools need no run registry; cross-tenant (the agency-ending risk) is fully closed; ~90s expiry bounds any replay window.
  - Cons: a valid, unexpired token could be replayed for a *different run of the same tenant* within ~90s (no in-flight-run binding at the tool layer).
- **Option B: Bind `token.run` to an authoritative in-flight run id at each route.**
  - Pros: strict per-run binding; replay across same-tenant runs blocked.
  - Cons: requires a run registry / lookup the stateless tools don't have; adds state + a DB read per host-tool call; out of scope for the thinnest slice; the worker already only acts within its own run, so the threat is low while undeployed.

## Chosen

**Option A.** Rationale: the agency-ending risk (cross-tenant leak) is fully closed; the residual (intra-tenant same-window run replay) requires an attacker already holding a valid host-minted token for that tenant, within 90s, and the worker is flag-gated/undeployed. Binding to an in-flight run id is a Phase-1 hardening, not a thinnest-slice requirement. The "cross-run" test case is therefore tamper-detection (re-pointing `run` breaks the signature), not in-flight-run binding — documented as such.

## Consequences

- Kernel routes derive tenancy from the verified token claims; they do NOT cross-check `token.run` against an external run id.
- If/when a run registry exists (host orchestrator / lease manager, deferred per [[DR-017]]), revisit to bind `token.run` to the leased run id for full per-run isolation.
- Test semantics: `bridge-auth.test.ts` "cross-run" = tamper-detection. Don't mistake it for in-flight-run binding.

## Revisit if

- The worker is deployed to a live tenant AND multiple concurrent runs per tenant are possible (the replay window becomes reachable).
- A run registry / lease manager lands (then bind `token.run` to it).

## Related

- Anchor sub-page: plans/seo-creator/flywheel/engineering-rfc.md (PR 007 AC6), prd.md §11.4
- Predecessor DRs: [[DR-018]] (the enforcement seam), [[DR-016]], [[DR-017]] (lease manager deferred — where the run registry would live)
- PR that prompted: C.009.1 (Run #010)

---

*Authored by /seo-creator-build · Run #010 · 2026-06-26*
