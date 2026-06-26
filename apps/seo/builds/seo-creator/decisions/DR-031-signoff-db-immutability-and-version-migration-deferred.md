# DR-031 — signoff-db-immutability-and-version-migration-deferred

**Date:** 2026-06-26
**Run:** #019 (P1.U.4 / PR 013)
**Status:** active
**Build phase:** Phase 1 — Pilot

## Context

P1.U.4 (version hub) requires a NAMED sign-off version that is undeletable/immutable (it is the recorded human-release marker, prd §4/§9). The `content_piece_versions` table (drizzle/0030) has **no** `name`/`active`/`is_signoff` columns, and P1.U.4's write-scope (agent-ui) does not own migrations. So P1.U.4 modeled name/active/sign-off at the `ContentDataAccess` seam, **fail-closed** (production `NOT_WIRED` stub throws), with sign-off immutability enforced in the seam contract (throws `SignoffImmutableError` before any write) — but NOT yet at the database.

## Decision

**Ship the version hub with seam-level (app-layer) sign-off immutability now; defer the DB columns + DB-level immutability to the schema-tenancy lane as a tracked follow-up corrective (candidate PR 020-area / a C.0xx).** The app-layer guard is correct and tested; the DB-level guard is the hardening that survives a direct DB write.

## Consequences — the schema lane MUST (follow-up):

1. **Add columns** to `content_piece_versions`: `name` (text, nullable), `is_active` (bool), `is_signoff` (bool) — then wire the real `listPieceVersions` / `nameVersion` / `setActiveVersion` Drizzle impls (replacing the fail-closed stubs). `setActiveVersion` must clear the prior active row (single active per piece).
2. **Enforce sign-off immutability at the DB:** a no-DELETE RLS policy (or an `is_signoff` trigger guard) so a named sign-off cannot be deleted/overwritten even by a direct DB write — not just the app seam.
3. **Resolve the `ON DELETE CASCADE` concern:** `content_piece_versions.piece_id` is `ON DELETE CASCADE`, so deleting a parent `content_piece` cascade-deletes its versions **including a signed-off one**. Decide whether a sign-off's existence should block parent-piece deletion (e.g. `ON DELETE RESTRICT` when a sign-off exists) so the human-release record can't be erased via the parent.

Until (1)-(2) land, production `/api/versions` is fail-closed (seam throws); the hub is testable + correct at the app layer.

## Revisit if

- The schema lane lands the columns (flip the stubs; add the DB immutability + the cascade decision; then this DR → discharged).

## Related

- Anchor: prd.md §4/§9 (named undeletable sign-off = human-release record), §7
- Predecessors: [[DR-025]] (gate_results/version schema work area), [[DR-023]] (RLS posture)
- PR: P1.U.4 (PR 013)

---

*Authored by /seo-creator-build · Run #019 · 2026-06-26*
