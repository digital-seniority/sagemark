# DR-035 — seam-resolver-blocked-needs-asset-linkage-and-live-adapter

**Date:** 2026-06-26
**Run:** #022 (corrective C.021.1 returned BLOCKED — structural)
**Status:** active
**Build phase:** Phase 1 — Pilot

## Context

C.021.1 was scoped (from the Run #21 follow-up note) as "implement the live Drizzle `resolveReferencedAssets` (publish/DR-033) + `resolveHeroAssets` (homepage) impls on the `ContentDataAccess`/`PublicContentDataAccess` seam; widen the public-read select to `clusterRole`/`funnelStage`." The premise was that a live Drizzle data-access adapter exists and these two methods are stubs to fill in.

## Problem

The premise does not hold against `preview`. The agent found — and correctly STOPPED rather than fabricate a fail-open linkage — two structural blockers:

1. **No live Drizzle data-access adapter exists in `apps/seo`.** The cited lines (`context.ts` ~351, 543–566, 628–629) are the `NOT_WIRED_*` fail-closed throw-stubs (`DataAccessNotWiredError`), not Drizzle bodies. Repo-wide there is no concrete `PublicContentDataAccess`/`ContentDataAccess` impl other than the in-memory test fixtures and these throwers; no DB client (`postgres-js`/Supabase/Drizzle) is constructed anywhere in `apps/seo/src` (only `src/worker/*` touches session storage). The live Drizzle adapter is the **deferred schema-tenancy-lane deliverable** noted in [[DR-026]].
2. **No persisted slug → `generated_images` linkage.** The seam resolves human-authored `[photo:slug]` body tokens, but `generated_images` (`0035`) has no `slug` column and the slug is not in `license`/`provenance`/`storage_key`/`tags`. `content_pieces` has no asset-reference column. [[DR-033]]'s own "Revisit if" anticipates exactly this: *"An asset-reference table is added (join content_pieces → assets) — the gate keys off it."* That table/column does not exist.

Both fixes (a `slug`/asset-ref column or join table; and a live DB adapter) require changes C.021.1 explicitly forbade (no new migration, no interface widening). So the corrective is **not buildable as scoped**.

## Options considered

- **Option A: re-scope C.021.1 to include a small asset-linkage migration** (a `slug`/`page_slug` column on `generated_images`, or a `content_piece_assets` join table) — but it still needs a live DB adapter to host the queries.
- **Option B: split into two PRs in dependency order** — (1) a schema-tenancy-lane PR landing the live Drizzle `ContentDataAccess`/`PublicContentDataAccess` adapter + DB client (the [[DR-026]] deferral) and the asset-linkage migration; then (2) the resolver-wiring becomes implementable.
- **Option C: leave as-is** — image-bearing pieces stay fail-closed-unpublishable and heroes degrade to placeholder.

## Decision

**Option B (preferred), with Option C as the safe interim.** C.021.1 is parked. The current fail-closed behavior is correct and is NOT a regression:
- `publish/route.ts:101–104` — absent `resolveReferencedAssets` ⇒ every `[photo:]` token maps to `{resolved:false, licensed:false}` ⇒ `canPublish` blocks `UNLICENSED_ASSET` (DR-033 intent).
- `clients/[client]/page.tsx:85–91` — absent `resolveHeroAssets` ⇒ `hero=null` ⇒ placeholder-strip (no broken/unprovenanced image).

The prerequisite is a **schema-tenancy-lane PR**: live Drizzle data-access adapter ([[DR-026]]) + an asset-reference linkage (slug column or `content_piece_assets` join) under DR-033's provenance model. Wiring the resolvers against an existing field (e.g. fuzzy slug→`storage_key`) is explicitly REJECTED — it cannot enforce per-asset provenance and risks reopening the fail-open the DR-033 gate exists to prevent.

## Consequences

- The "widen public-read select to `clusterRole`/`funnelStage`" sub-task is already satisfied at the type + fixture level (`PublishedPiece` declares them; the in-memory fixture selects them; `homepage.test.ts` groups by them) — there is no *live* select to widen until the adapter lands.
- This is an orchestrator mis-scope, not an agent failure: the agent's refusal-to-fabricate is the correct flywheel behavior. No quality penalty for the agent.

## Links

[[DR-026]] (public-data adapter wiring deferred), [[DR-033]] (publish-side image-license gate + "Revisit if" asset-ref table), [[DR-032]] (imagegen engine), P1.R.3 / PR 017.
