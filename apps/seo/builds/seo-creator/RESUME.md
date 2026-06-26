# RESUME — SEO Creator build (intra-run cursor)

> Re-read THIS first after a compaction, then STATE.md, then continue `/seo-creator-build auto`. Never restart; never re-merge MERGED PRs.

**Status:** **10h UNATTENDED run** (`.auto-loop.json` active, budget 10h from 2026-06-26T04:14Z, **~8.9h elapsed (~1.1h to ceiling 14:14Z)**). **Phase 1 at 6/12 · ★ SLICE 1 CLOSED ★.** Run #018 merged P1.U.3 (#39). **Next: Run #019 = P1.U.4 (PR 013), then expect terminal.**

## Cursor
| Field | Value |
|---|---|
| Run # | 018 done → Run #019 next |
| Phase | 1 — Pilot (6/12); Slice 1 closed |
| Loop | active; ~1.1h budget left |
| Session | a9fb4528-5cd4-422a-a81c-186b1b43cc09 |

## Already MERGED (do NOT redo)
Phase 0: #2,#3,#5,#6,#8,#11,#17,#19,#20,#26,#28. Phase 1: P1.R.1 #31, P1.W.1 #32, P1.R.2 #34, P1.U.1 #35, P1.U.2 #37, **P1.U.3 #39**. Correctives C.004.1/C.008.1/C.009.1(#22). audit fixes #13-16. suite #24. state #21,#23,#25,#27,#29,#30,#33,#36,#38 (+ Run #018 state next). audits 001/002/003.

## NEXT — Run #019 = P1.U.4 (PR 013), dep P1.U.3 ✓
**Version hub: switch / name / compare + undeletable named sign-off.** Files (RFC PR 013): `apps/seo/src/app/(studio)/inspector/VersionHub.tsx`, `apps/seo/src/app/(studio)/inspector/VersionDiff.tsx`, `apps/seo/src/app/api/versions/[id]/route.ts` (name/switch server actions), `apps/seo/test/versions/named-undeletable.test.ts`. Builds on P1.U.3's `content_piece_versions` (append-only) + P1.U.2's Inspector. Key invariant: a **named sign-off version is UNDELETABLE** (append-only audit trail; the sign-off is the recorded human release marker). switch/name/compare are reads + a name write; NO destructive delete of versions. Tenancy via context (DR-026 patterns); jsdom for UI tests (DR-029); scorer subpath imports if needed (DR-028). Reuse VersionDiff against the version rows.

## EXPECTED TERMINAL after Run #019
After P1.U.4, remaining Phase-1 PRs are NON-ENG-blocked: **P1.R.3** (PR 017 homepage + imagegen — needs imagegen keys), **P1.C.1** (review preview, ←P1.R.3), **P1.C.2** (←D6 credentialed reviewer), **P1.C.3** (cost ledger + SoM, ←DR-013 Gateway-only-metering corrective + P1.R.1), **P1.C.4** (SoM cron — needs ≥3-engine measurement). So eligible *engineering* work depletes → set `.auto-loop.json` `active:false`, `terminal_reason:"depleted-eligible-engineering + budget-ceiling"`, and surface the non-eng blockers + the go-live checklist to James. (Also: audit due before Run #020; DR-013 metering corrective could be one more eng item if you want — it's a real corrective, dependency-free.)

## Open DRs/risks (STATE active-risks + audits/audit-003): DR-026 (public-data seam — schema lane wire anon/published Drizzle impl), DR-030 (distributed rate-limiter before multi-instance), F-1 bridge audience claim, F-2 operator-authZ before real auth, gate_results→PR020 (DR-025), DR-013 Gateway-only-metering corrective (before PR020 ledger), live-Sandbox Tier-2/3, demo em-dash tension (NON-ENG/James), A.014.5 promote judge checks to manifest.

## Resume: `/seo-creator-build auto` → Run #019 (P1.U.4). Halt: set `.auto-loop.json` active:false.
