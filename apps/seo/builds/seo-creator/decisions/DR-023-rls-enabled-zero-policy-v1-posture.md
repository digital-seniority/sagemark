# DR-023 — rls-enabled-zero-policy-v1-posture

**Date:** 2026-06-26
**Run:** audit-002 (back-filling a DR-NEEDED from Run #006)
**Status:** active
**Build phase:** Phase 0 — Foundations

## Context

Run #006's checkpoint flagged a DR-NEEDED that was never filed (audit-002 state-historian finding A.011.11). The tenancy-root tables (`content_clients`, `voice_specs`, `content_pieces`, `content_piece_versions`, and the release/signoff/authorization tables) ship in v1 with **RLS enabled but only the single anon policy** `content_pieces_public_read` (`FOR SELECT TO anon USING (status='published')`); `voice_specs` and `content_piece_versions` have NO anon policy at all. Authenticated-tenant-user policies are deferred because the auth seam (`auth.ts`, [[DR-003]]) is still a no-op placeholder — there are no authenticated end-user sessions yet; all operator access is service-role through the workspace-scoped query wrapper.

## Problem

What is the v1 RLS policy posture, and when do workspace-scoped authenticated-user policies get added?

## Options considered

- **Option A: RLS-enabled-zero-policy for non-anon (anon = published-only; everything else via service-role wrapper that injects workspace_id+client_id).**
  - Pros: fail-closed (no matching policy ⇒ zero rows, never error-open); the #1 cross-tenant risk is closed by RLS-default-deny + the service-role wrapper's mandatory tenant scoping; matches the thinnest slice (no authenticated end users yet).
  - Cons: when authenticated tenant users land, per-row workspace policies must be added or those users get zero rows.
- **Option B: Add workspace-scoped authenticated policies now.**
  - Cons: premature — `auth.ts` is a no-op; no authenticated user rows to scope; untestable; speculative.

## Chosen

**Option A.** Rationale: with no authenticated end-user sessions in v1, anon-published-only + service-role-wrapper-scoping is the complete and fail-closed posture; CI proves it (RLS Tier-2 17/17, anon = published-only + zero on internal tables, cross-tenant zero rows). Adding authenticated policies now would be untestable speculation.

## Consequences

- v1 RLS = anon-published-read-only + service-role wrapper enforces `workspace_id`+`client_id` on every operator query (fail-closed: an unscoped query throws before executing).
- **When the auth seam ([[DR-003]]) is filled** with real authenticated tenant users, add workspace-scoped `SELECT`/`INSERT`/`UPDATE` policies (`USING (workspace_id = auth.workspace())`) — until then authenticated-user direct DB access is intentionally zero-rows.
- The CI tenant-isolation contract test is the standing guard; extend it with authenticated-user cases when policies are added.

## Revisit if

- `auth.ts` (DR-003) is filled with real authenticated tenant users → add workspace-scoped policies + extend the contract test.
- A new table is added that authenticated users must read directly.

## Related

- Anchor sub-page: plans/seo-creator/flywheel/prd.md §11.4 (5-layer tenancy)
- Predecessor DRs: [[DR-003]] (auth placeholder), [[DR-006]] (schema-flywheel RLS+CI), [[DR-015]] (Sagemark project)
- Surfaced by: audit-002 (state-historian), originally Run #006

---

*Authored by /seo-creator-build · audit-002 · 2026-06-26*
