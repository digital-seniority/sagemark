# RESUME — SEO Creator build (intra-run cursor)

> Re-read THIS first after a compaction, then STATE.md, then continue `/seo-creator-build auto`. Never restart; never re-merge MERGED PRs.

**Status:** Between runs — Run #004 ended (depleted), then the **P0.W.1 gate was resolved out-of-loop** (live Sandbox run + remediation, **CONFIRMED 4/4 PASS**, merged at #3). Worker lane now UNBLOCKED. Ready to start **Run #005** via `/seo-creator-build auto`.

## Cursor
| Field | Value |
|---|---|
| Run # | 005 (not yet started — `.auto-loop.json` is `active:false`; `auto` will create a fresh loop) |
| Loop iteration | — |
| Lock phase | (none — no run-lock held) |
| Updated at | 2026-06-25T23:30Z |

## In-flight
_(none — no agents running, no run-lock held)_

## Already MERGED (do NOT redo): P0.E.1(#2), P0.E.2(#5), P0.E.3(#8), P0.S.1(#6), P0.E.4(#11), C.004.1(#10), **P0.W.1(#3)**.

## Next up (now reachable — gate cleared)
- **P0.W.2 (PR 006 — Agent-SDK worker on Vercel Sandbox).** The first worker-lane PR, now unblocked by the P0.W.1 merge. **Must implement the hardened profile proven by the spike:** egress = `networkPolicy` allowlist + in-VM `iptables` DROP on `169.254.0.0/16` (DR-010); fs = no-shell worker + workdir-scoped file tool (DR-011); fail-closed boot-refusal preflight. Reference impl in `apps/seo/spike/capability-enforcement/_harness.ts` (`hardenSandbox`, `readViaWorkdirTool`, `assertControlsOrRefuse`).
- **Audit is DUE** before the next work-doing run (4 runs since last; threshold 5). The orchestrator runs it first.

## Key facts
- P0.W.1 gate = **CONFIRMED (hardened profile)**; see PR #3 `RESULTS.md`, DR-010, DR-011. Sandbox is the worker runtime.
- Live Sandbox creds: a 7-day team-scoped `VERCEL_TOKEN` (`sagemark-seo-spike`, expires 2026-07-02) is in `.claude/settings.local.json`. Sandbox run user = `uid=1000(vercel-sandbox)`, can `sudo`, permissive base image, `iptables` present.
- Port source: flywheel-main **origin/preview** for the worker host (DR-001). canPublish + Stage-A vetoes enforced HOST-SIDE, never in the loop.
- **Supabase = DSN** (`gshcdvcfgbzpzwhvlxmg`, [[DR-012]]). `0030`–`0033` applied + RLS verified as anon. Public conn vars in `.claude/settings.local.json`; `DATABASE_URL`/service-role are human/CI secrets (needed for CI Tier-2). Apply future migrations to DSN.

## Resume: `/seo-creator-build auto` (starts Run #005) · Halt: delete `.auto-loop.json`
