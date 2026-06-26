# RESUME — SEO Creator build (intra-run cursor)

> Re-read THIS first after a compaction, then STATE.md, then continue `/seo-creator-build auto`. Never restart; never re-merge MERGED PRs.

**Status:** **10h UNATTENDED run** (`.auto-loop.json` active, budget 10h from 2026-06-26T04:14Z, ~1.5h elapsed; autonomous auto-merge). **Phase 0 COMPLETE; audit-003 phase-close CLEAR (no Critical/High).** Entering Phase 1. **Next: Run #015 = P1.R.1 + P1.W.1 (parallel).**

## Cursor
| Field | Value |
|---|---|
| Run # | 014 (audit-003) done → Run #015 (Phase 1) |
| Phase | 1 — Pilot (0/12) |
| Loop | active, 10h window |
| Session | a9fb4528-5cd4-422a-a81c-186b1b43cc09 |

## Already MERGED (do NOT redo)
Phase 0 (all 10): #2,#3,#5,#6,#8,#11,#17,#19,#20,#26,#28. Correctives C.004.1/C.008.1/C.009.1(#22). audit fixes #13-16. suite #24. state #21,#23,#25,#27,#29. audits 001/002/003.

## NEXT — Run #015 = first Phase-1 batch (2 lanes, parallel)
- **P1.R.1 (PR 015 — content-hub SSR render route + FAQ JSON-LD + placeholder stripping)** — lane render-geo, dep P0.S.2 ✓. **Highest leverage** (gates P1.R.2/P1.C.1/P1.C.3). Build the Slice-1 BODY-ONLY render floor (per audit-003 sequencing). Files (RFC PR 015): `apps/seo/src/app/clients/[client]/blog/[slug]/page.tsx`, `src/lib/render/{client-blog,build-faq-jsonld,resolve-placeholders}.ts`, `clients/[client]/{sitemap.xml,robots.txt}/route.ts`, `vitest.config.ts`, `test/render/*`. status='published' filter; body-in-initial-HTML; no leaked placeholder tokens.
- **P1.W.1 (PR 014 — wire strategist/assistant/audit suite skills + N=3 revise cap)** — lane worker-runtime, dep P0.W.5 ✓. Extends `load-suite.ts` to register the 3 skills against /content/api/*; `loop/revise-cap.ts` (N=3→hold at review); `test/golden/suite-chain.test.ts`. **Fold A.014.1** (normalize golden funnel_stage TOFU/MOFU/BOFU → awareness/consideration/decision per the 0031 CHECK) + A.014.5 (promote the 2 structured judge checks). Use vendored suite paths (DR-022).
- Different lanes, minimal file overlap → parallel OK. Cap 1 high-risk.

## Then (after Run #015): P1.R.2 (←P1.R.1), P1.U.1 (canvas, eligible), P1.U.2-4, then P1.C.x/P1.R.3 (NON-ENG blocked: D6 reviewer, imagegen keys, ≥3-engine SoM). Audit due ~Run #019.

## audit-003 actionable (see audits/audit-003): A.014.1 funnel-enum (pre-PR017), Slice-1-floor-first, A.014.5 judge checks, F-1 bridge audience claim, F-2 operator-authZ before real auth, gate_results→PR020, em-dash demo tension (NON-ENG/James), live-Sandbox Tier-2/3 now runnable.

## Resume: `/seo-creator-build auto` → Run #015 (P1.R.1 + P1.W.1). Halt: set `.auto-loop.json` active:false.
