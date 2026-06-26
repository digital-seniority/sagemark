# DR-021 — authenticate-bridge-request-two-function-api

**Date:** 2026-06-26
**Run:** #010 (corrective C.009.1)
**Status:** active
**Build phase:** Phase 0 — Foundations

## Context

Before C.009.1, kernel routes bound tenancy via `bindRequestContext(clientId, data, resolveWorkspace)` (operator session path only). C.009.1 needed to add a worker-bridge-JWT path without disturbing the operator path or its tests.

## Problem

Overload `bindRequestContext` to also handle the bearer-token path, or add a separate `authenticateBridgeRequest` that wraps it?

## Options considered

- **Option A: Add `authenticateBridgeRequest(request, requestedClientId, data, resolveWorkspace, {secret,nowMs})` that branches on the `Authorization: Bearer` header; calls the unchanged `bindRequestContext` for the no-bearer operator path.**
  - Pros: operator path byte-for-byte unchanged (no regression to existing route tests); one fail-closed chokepoint for the worker path; clear separation of the two credential models.
  - Cons: two functions to know about.
- **Option B: Overload `bindRequestContext` with the bearer logic inline.**
  - Pros: one entry point.
  - Cons: mixes two auth models in one function; higher regression risk to the operator path; harder to test the two paths independently.

## Chosen

**Option A.** Rationale: keeping the operator path untouched eliminates regression risk and made the existing 153 route tests pass unchanged; the bridge path gets a single auditable chokepoint. This is the **standing pattern**: routes call `authenticateBridgeRequest(...)`; it delegates to `bindRequestContext(...)` when no bearer is present.

## Consequences

- New convention: kernel/host-tool routes authenticate via `authenticateBridgeRequest` (which handles BOTH worker-bridge and operator-session). New host tools must call it (the `bridge-auth.test.ts` table enforces this).
- `bindRequestContext` remains the operator-session primitive, now wrapped — do not call it directly from a new host tool; call `authenticateBridgeRequest`.
- `verifyBridgeToken`/`mintBridgeToken` now live in `@/lib/auth/bridge-token` (re-exported from `api/run/route.ts` for back-compat).

## Revisit if

- A third credential model appears (e.g. a public review-token path) — then reconsider whether one dispatcher should own all three.

## Related

- Anchor sub-page: plans/seo-creator/flywheel/engineering-rfc.md (PR 005 routes, PR 007 bridge)
- Predecessor DRs: [[DR-018]], [[DR-003]] (auth placeholder seam)
- PR that prompted: C.009.1 (Run #010)

---

*Authored by /seo-creator-build · Run #010 · 2026-06-26*
