# RESUME — SEO Creator build (intra-run cursor)

> Re-read THIS first after a compaction, then STATE.md, then continue `/seo-creator-build auto`. Never restart; never re-merge MERGED PRs.

**Status:** **10h UNATTENDED run** (`.auto-loop.json` active, budget 10h from 2026-06-26T04:14Z, ~2h elapsed; autonomous auto-merge). **Phase 1 underway (2/12).** Run #015 merged P1.R.1 (#31) + P1.W.1 (#32). **Next: Run #016 = P1.R.2 + P1.U.1 (parallel).**

## Cursor
| Field | Value |
|---|---|
| Run # | 015 done → Run #016 next |
| Phase | 1 — Pilot (2/12) |
| Loop | active, 10h window |
| Session | a9fb4528-5cd4-422a-a81c-186b1b43cc09 |

## Already MERGED (do NOT redo)
Phase 0: #2,#3,#5,#6,#8,#11,#17,#19,#20,#26,#28. Phase 1: **P1.R.1 #31, P1.W.1 #32**. Correctives C.004.1/C.008.1/C.009.1(#22). audit fixes #13-16. suite #24. state #21,#23,#25,#27,#29,#30. audits 001/002/003.

## NEXT — Run #016 = Phase-1 batch (2 lanes, parallel)
- **P1.R.2 (PR 016 — CI reachability gate: sitemap == published-and-indexable set, both directions)** — lane render-geo, dep **P1.R.1 ✓** (#31). Files (RFC PR 016): `apps/seo/test/render/reachability-gate.test.ts`, `apps/seo/src/lib/render/indexable-set.ts`, CI step in `.github/workflows/seo.yml` (or the existing ci.yml). Asserts sitemap entries ⊆ published+indexable AND every published+indexable piece is in the sitemap (both directions). Reuses P1.R.1's render/sitemap libs.
- **P1.U.1 (PR 010 — three-zone agent canvas shell)** — lane agent-ui, dep **P0.W.4 ✓** (SSE #20). Files (RFC PR 010): `apps/seo/src/app/(studio)/SeoStudioCanvas.tsx`, `(studio)/agent/{AgentPanel,AgentMessageStream,ThinkingDelta,ToolUseRow}.tsx`, `(studio)/artifact/{ArtifactZone,BriefCard,ModeTabs}.tsx`, `src/components/ScoreSignalDot.tsx`, `src/lib/stream/use-ui-message-stream.ts`. **Reuse the existing apps/agents StudioCanvas** (videogen) — CHECK it exists at `C:/Users/stone/Code/flywheel-main/apps/agents/...` (DR-001 port source) or in-repo; adapt, strip video controls, point at the PR 007 SSE stream. UI lane — first UI PR, may need care.
- Different lanes (render-geo + agent-ui), minimal overlap → parallel OK. Cap 1 high-risk.

## Then (Run #017+): P1.U.2 (PR 011 token streaming + Inspector scorecard, ←P1.U.1), P1.U.3 (PR 012 /api/edit bounded diff + re-gate, ←P0.S.2+P1.U.2), P1.U.4 (PR 013 version hub). NON-ENG blocked: P1.R.3 (imagegen keys), P1.C.1-4 (D6 reviewer, ≥3-engine SoM). Audit due ~Run #019.

## Open DRs/risks (see STATE active-risks + audits/audit-003): DR-026 (public-data seam — schema lane must wire anon/published Drizzle impl), DR-027 (revise-cap in worker), F-1 bridge audience claim, F-2 operator-authZ before real auth, gate_results→PR020 (DR-025), live-Sandbox Tier-2/3 (now runnable), demo em-dash tension (NON-ENG/James), A.014.5 promote judge checks to manifest, P1.R.1 "no client component in public route" structural guard.

## Resume: `/seo-creator-build auto` → Run #016 (P1.R.2 + P1.U.1). Halt: set `.auto-loop.json` active:false.
