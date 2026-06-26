# RESUME — SEO Creator build (intra-run cursor)

> Re-read THIS first after a compaction, then STATE.md, then continue `/seo-creator-build auto`. Never restart; never re-merge MERGED PRs.

**Status:** **10h UNATTENDED run** (`.auto-loop.json` active, budget 10h from 2026-06-26T04:14Z, **~8.5h elapsed (~1.5h to ceiling 14:14Z)**; autonomous auto-merge). **Phase 1 at 5/12.** Run #017 merged P1.U.2 (#37). **Next: Run #018 = P1.U.3 (PR 012).**

## Cursor
| Field | Value |
|---|---|
| Run # | 017 done → Run #018 next |
| Phase | 1 — Pilot (5/12) |
| Loop | active; ~1.5h budget left (may stop at budget — that's a clean terminal, not a failure) |
| Session | a9fb4528-5cd4-422a-a81c-186b1b43cc09 |

## Already MERGED (do NOT redo)
Phase 0: #2,#3,#5,#6,#8,#11,#17,#19,#20,#26,#28. Phase 1: P1.R.1 #31, P1.W.1 #32, P1.R.2 #34, P1.U.1 #35, **P1.U.2 #37**. Correctives C.004.1/C.008.1/C.009.1(#22). audit fixes #13-16. suite #24. state #21,#23,#25,#27,#29,#30,#33,#36 (+ Run #017 state next). audits 001/002/003.

## NEXT — Run #018 = P1.U.3 (PR 012), dep P0.S.2 ✓ + P1.U.2 ✓
**Conversational fine-tune: `/api/edit` bounded diff + full gate re-run + versioning — the Slice-1 EDIT FLOOR (closes Slice 1).** Files (RFC PR 012): `apps/seo/src/app/api/edit/route.ts`, `apps/seo/src/lib/edit/constrained-edit-contract.ts` (`{region,instruction}→bounded markdown diff + summary` — net-new), `apps/seo/src/worker/prompts/seo-edit.system.md`, `apps/seo/src/lib/edit/version-write.ts`, `apps/seo/src/app/(studio)/agent/ActivityFeed.tsx`, `apps/seo/test/edit/guards.test.ts`. Guards: SHA-256 stale-edit (409), per-tenant rate-limit (429), workspace-ownership (403). The bounded edit re-runs the FULL gate + writes an append-only version. canPublish/FSM host-side (don't fork). drafter≠verifier preserved. This is the Slice-1 close-out per PRD §12 (one bounded edit → re-gate → gated version). Use jsdom for any UI test (DR-029); client scorer imports via subpath (DR-028).

## Then: P1.U.4 (PR 013 — version hub switch/name/compare + undeletable named sign-off, dep P1.U.3). **AUDIT due ~Run #019.** NON-ENG blocked: P1.R.3 (imagegen keys), P1.C.1-4 (D6 reviewer, ≥3-engine SoM).

## If budget hit mid-Run-#018: the IN_PROGRESS lock + the agent's worktree branch recover it; set .auto-loop.json terminal_reason="budget" + active:false ONLY at a clean boundary, else just resume next session.

## Open DRs/risks (STATE active-risks + audits/audit-003): DR-026 (public-data seam — schema lane wire anon/published Drizzle impl), DR-028 (subpath scorer imports), DR-029 (jsdom opt-in), F-1 bridge audience claim, F-2 operator-authZ before real auth, gate_results→PR020 (DR-025), live-Sandbox Tier-2/3, demo em-dash tension (NON-ENG/James), A.014.5 promote judge checks to manifest.

## Resume: `/seo-creator-build auto` → Run #018 (P1.U.3). Halt: set `.auto-loop.json` active:false.
