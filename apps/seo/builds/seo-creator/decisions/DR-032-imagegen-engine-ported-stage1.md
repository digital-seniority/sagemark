# DR-032 — imagegen-engine-ported-stage1

**Date:** 2026-06-26
**Run:** user-directed build (post-Run #019; unblocks P1.R.3)
**Status:** active
**Build phase:** Phase 1 — Pilot

## Context

P1.R.3 (PR 017) needs `generateHeroImage` from `@sagemark/imagegen` (RFC §616), but `apps/imagegen` was a `not_implemented` stub. James directed "build out imagegen." A mature, injection-based engine exists at `flywheel-main/packages/videogen/imagegen` (DR-001 port source).

## Decision

**Port the imagegen engine into `apps/imagegen` (`@sagemark/imagegen`) in two stages.** Stage 1 (DONE, PR #43 `d55a7bb`, judge 5/5·5/5): the durable engine (spec/capability/compile/router/generate/moderate/persist/cost) + a SEO-adapted `generateHeroImage` orchestrator + `/api/run` wiring + in-process package `exports` (so apps/seo imports it like `@sagemark/core`). Stage 2 (DEFERRED): Supabase persistence.

## Stage-1 properties (judge-verified)
- **Gateway-only / metered (DR-013):** the live generator is built from dynamically-imported `ai` `generateImage` (NOT `experimental_generateImage` — renamed in ai@7.0.2) + `@ai-sdk/gateway` `gateway.imageModel`; no raw provider key; image spend routes through the metered Gateway. Generator is injected (fake for tests).
- **Pre-spend safety:** moderation + cost-cap run BEFORE `generate` (no spend on a refused/over-cap request).
- **Provenance/license always recorded** (Never-list #8 precondition); missing-license fast-fails before upload.
- **Fail-closed store:** production store is `NOT_WIRED` (throws/501) until Stage 2; in-memory fake backs tests/dry-run.
- 74 tests, typecheck + build green; `@sagemark/imagegen` exports `generateHeroImage` + generators for apps/seo in-process use; `[photo:slug]` → `parsePhotoToken`/`resolveHeroPlaceholder` for P1.R.3.

## Consequences / Stage-2 follow-up (the deferred work)
**Before the live generated-hero path is usable in production, a Stage-2 PR (schema-tenancy + imagegen) MUST:**
1. Author `store-supabase.ts` (live `GeneratedImageStore` + `makeSupabaseSignUrl`) replacing the NOT_WIRED stub.
2. Add the `generated_images` + `image_generations` migration in `packages/schema-flywheel` + the `seo-generated-images` storage bucket + workspace-scoped RLS (apply to Sagemark = NEEDS-INPUT, like 0034).
3. **Gate live `/api/run` behind a flag until the store lands** — judge nit: in live mode a valid request currently spends on the Gateway then throws at persist (paid-for-and-dropped). Fails loud, but flag it off until Stage 2 to avoid wasted spend.
4. Confirm the image model ids against the live Gateway (`gateway.getAvailableModels()`); the four ids are carried from the flywheel IG-0 spike (Tier-3 NEEDS-INPUT).
5. True-up the cost-cap estimate table (`ESTIMATED_USD_PER_IMAGE_BY_TIER`) against live Gateway pricing (currently a conservative pre-spend estimate).

## P1.R.3 impact
The **Pexels stock-photo path is fully unblocked** (key provisioned local + sagemark-seo). The **generated-hero path has its engine** now (apps/seo can `import { generateHeroImage } from "@sagemark/imagegen"`), but real persistence needs Stage 2. P1.R.3 can wire `src/lib/tools/hero-image.ts` against the engine with the store injected (fail-closed until Stage 2).

## Related
- Anchor: engineering-rfc.md PR 017 (§615-616); prd.md §6 (image licensing, Never-list #8)
- Predecessors: [[DR-001]] (port-source = flywheel-main), [[DR-013]] (Gateway-only metering)
- Unblocks: P1.R.3 (PR 017)

## Stage-2 UPDATE (audit-004) — SHIPPED + APPLIED
Stage 2 is no longer deferred: merged PR #45 (`2478669`, judge 5/5; CI fix `0817379` removed `storage.*` SQL from the migration per the live-pooled-role failure class) — `store-supabase.ts` + `0035_generated_images` + fail-closed RLS + gated `/api/run` (refuse-before-spend). Migration **applied to Sagemark** (`rilaycjkksfosnxvenzt`) + the private `seo-generated-images` bucket **created** (event M020-E03). The "bucket provisioning is storage-admin, NOT a SQL migration" decision is load-bearing (see DR header / 0035). **Still open before flipping the live generated path on:** set `IMAGEGEN_LIVE=1` + service-role creds on the deploy; confirm the 4 Gateway image-model ids via a smoke; true-up `ESTIMATED_USD_PER_IMAGE_BY_TIER` (all `null` today). Publish-side license enforcement for referenced images → [[DR-033]].

---

*Authored by /seo-creator-build · user-directed imagegen build · 2026-06-26 (Stage-2 update: audit-004)*
