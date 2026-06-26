# DR-033 — publish-side-image-license-gate

**Date:** 2026-06-26
**Run:** audit-004
**Status:** active — **REQUIRED before P1.R.3 wires `[photo:]` resolution into published bodies**
**Build phase:** Phase 1 — Pilot

## Context

audit-004 (security, F-LICENSE-1) found that the Never-list #8 invariant ("no unlicensed/un-provenanced image in a published piece", prd §6) is enforced ONLY at imagegen *persist* time (`assertLicensePresentForSource` in the imagegen engine). The publish FSM (`canPublish` / `TransitionContext` in `@sagemark/core/lifecycle/lifecycle-fsm.ts`) has **no** image/asset/license field and never checks one; the SEO app has zero linkage between the publish gate and the `generated_images` license rows. Today this is safe *by absence* — no generated image can reach a published `content_piece` body because P1.R.3 (the `[photo:]`→image resolution) isn't built and the render route STRIPS `[photo:]` tokens.

## Problem

When P1.R.3 wires `resolveHeroPlaceholder` / `[photo:]` resolution into rendered/published bodies, the only thing between an unlicensed or orphaned asset and a public page would be the persist-time assert — which is NOT re-checked at publish, and a render-time resolution that short-circuits on an `externalUrl` (`persist.ts` `resolveGeneratedAssetUrl`) would carry no license check. That reopens Never-list #8 at the publish edge.

## Decision

**Add a publish-side image-license precondition, host-enforced, that lands WITH (or before) P1.R.3's `[photo:]` resolution — never after.** Concretely: `canPublish` (or a publish-route preflight) must assert that **every image referenced by the piece body resolves to a `generated_images` row (or an approved stock/Pexels asset) with a non-null `license`, scoped to the bound `workspace_id`** — and a missing/orphaned/unlicensed reference is a fail-closed publish block with a stable code (e.g. `UNLICENSED_ASSET`). The render route must likewise refuse to surface an unprovenanced asset (key the render-gate off `license` presence, since the store currently persists `license` NOT NULL but drops `prompt_hash`/`provenance`/`seed` — see DR-032).

## Consequences

- P1.R.3 scope MUST include: (a) the `[photo:]`/hero resolution, (b) the publish-side license precondition, (c) the render-time provenance/license gate, (d) the Pexels-stock-asset license record path (stock images also need a recorded license/attribution). Do NOT ship (a) without (b)+(c).
- `TransitionContext` likely needs an `assets`/`referencedImages` field (a small core change) so `canPublish` can check it host-side (agent-unreachable).
- Stock (Pexels) assets need a license/attribution record too (Pexels license + source URL), so the gate is uniform across generated + stock.

## Revisit if

- P1.R.3 is descoped to stock-only (still need the stock license record + the publish gate).
- An asset-reference table is added (join content_pieces → assets) — the gate keys off it.

## Related

- Anchor: prd.md §6 (image licensing, Never-list #8), §9 (fail-closed publish)
- Predecessors: [[DR-032]] (imagegen engine; persist-time license), [[DR-026]] (render escape-first)
- Surfaced by: audit-004 (security F-LICENSE-1); gates P1.R.3 (PR 017)

---

*Authored by /seo-creator-build · audit-004 · 2026-06-26*
