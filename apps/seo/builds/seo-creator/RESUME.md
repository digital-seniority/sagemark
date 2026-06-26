# RESUME — SEO Creator build (intra-run cursor)

> Re-read THIS first after a compaction, then STATE.md, then continue `/seo-creator-build auto`. Never restart; never re-merge MERGED PRs.

**Status:** Phase 1 at 7/12. The 10h unattended run ended at Run #019; since then (user-directed): **imagegen built out** (Stage 1 #43 + Stage 2 #45, 0035 applied to Sagemark + bucket) and **audit-004 done (no Critical — P1.R.3 CLEAR)**. `.auto-loop.json` is `active:false`. No run-lock. **Next: build P1.R.3.**

## Already MERGED (do NOT redo)
Phase 0 (10): #2,#3,#5,#6,#8,#11,#17,#19,#20,#26,#28. Phase 1 (7): #31,#32,#34,#35,#37,#39,#41. imagegen: #43 (stage1), #45 (stage2). Correctives C.004.1/C.008.1/C.009.1(#22). audit fixes #13-16. suite #24. state #21,#23,#25,#27,#29,#30,#33,#36,#38,#40,#42,#44. audits 001/002/003/004.

## NEXT — P1.R.3 (PR 017 — resource-library homepage + imagegen hero), the only dep-eligible engineering PR
Files (RFC §616): `apps/seo/src/app/clients/[client]/page.tsx` (homepage off the clusterRole/funnelStage columns), `apps/seo/src/lib/render/hub-homepage.ts`, `apps/seo/src/lib/tools/hero-image.ts` (in-process `generateHeroImage` from `@sagemark/imagegen`, async/job-wrapped, tenancy+cost-cap host-side), `apps/seo/test/render/homepage.test.ts`, `apps/seo/test/tools/hero-provenance.test.ts`.
**MUST FOLD IN (audit-004):**
- **DR-033 (the landmine):** add the publish-side image-license precondition — `canPublish` (likely a new `TransitionContext.referencedImages` field in @sagemark/core) asserts every image referenced in the body resolves to a licensed `generated_images`/stock row (workspace-scoped); render-gate refuses unprovenanced assets (key off `license` presence). **Do NOT ship `[photo:]` resolution without this.** Stock (Pexels) assets also need a recorded license/attribution.
- **F1 (High):** add a `status==='draft'` guard to `/api/edit` (a non-draft piece must not be editable) + a guards test. (Separate quick corrective C.020.1 OR fold in.)
- **F8 trip-hazards:** async/job-wrap the hero gen (don't block the SSR homepage `await`); inject `makeNotWiredImageStore()` so the homepage degrades to placeholder-strip (not 500) when imagegen isn't live; Pexels-stock-first then generate; the live generated path stays behind `IMAGEGEN_LIVE` (OFF) until creds + a Gateway image-model smoke.
- A.014.1 funnel-enum already discharged → the 0031 CHECK won't reject.

## Then: P1.C.1 (PR 018 review preview, ←P1.R.3). NON-ENG-blocked: P1.C.2 (←D6 reviewer), P1.C.3/P1.C.4 (←≥3-engine SoM; +DR-013 metering corrective; renumber the aux migration 0036+ since 0035 is imagegen).

## Process debt to wire (audit-004 C-1b — 3 cycles open): promote into `build-flywheel-manifest.json` judge_criteria: `tool-allowlist-single-source`, `worker-credential-publish-scope` (audit-002), the normalize-before-gate lesson (DR-024), and the new `migration-runs-on-live-pooled-role` (audit-004 C-1). Do before the next worker/schema/imagegen PR.

## imagegen live-flip checklist (DR-032): set `IMAGEGEN_LIVE=1` + service-role creds on the deploy; confirm the 4 Gateway image-model ids via a smoke; true-up `ESTIMATED_USD_PER_IMAGE_BY_TIER` (null today).

## Open DRs/risks (full list in STATE active-risks + audits/audit-003/004): DR-013 metering corrective, DR-025 (gate_results writer→PR020), DR-026 (public-data adapter wiring), DR-030 (distributed rate-limiter), DR-031 (sign-off DB immutability), DR-033 (publish image-license gate), F-2 operator-authZ before real auth, live-Sandbox Tier-2/3, demo em-dash tension (NON-ENG/James).

## Resume: `/seo-creator-build auto` (clear of the audit gate now) → P1.R.3. Halt: set `.auto-loop.json` active:false (already false).
