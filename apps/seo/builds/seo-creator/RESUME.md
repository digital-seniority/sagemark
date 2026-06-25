# RESUME — SEO Creator build (intra-run cursor)

> Re-read THIS first after a compaction, then STATE.md, then continue `/seo-creator-build auto`.
> Never restart from scratch. Never re-merge MERGED PRs. Trust this cursor + STATE.md + `gh pr view`.

**Status:** Run #002 active — agents spawning

## Cursor

| Field | Value |
|---|---|
| Run # | 002 |
| Loop iteration | 2 / 8 |
| Lock phase | agents_spawning |
| Updated at | 2026-06-25T19:46Z |

## In-flight PRs (this batch)

| id | lane | worktree | status |
|---|---|---|---|
| P0.E.2 | engine-port | (isolation:worktree) | IN_FLIGHT — port 12 scorers + faithfulness/voice gates from flywheel-main into @sagemark/core |
| P0.S.1 | schema-tenancy | (isolation:worktree) | IN_FLIGHT — bootstrap packages/schema-flywheel + content schema + RLS + contract test |

## Already done (do NOT redo)

- Run #001: **P0.E.1 MERGED** (PR #2, ec13f1c). **P0.W.1 open + human-gated** (PR #3 — live Sandbox run gates PR 006; DR-002 — do NOT mark REQUIRES_HUMAN_MERGE, do NOT auto-merge).
- Setup PR #1 (hooks) + state PR #4 merged.

## Key facts

- Port-source root = `C:/Users/stone/Code/flywheel-main/` (DR-001).
  - P0.E.2 scorers/gates: `flywheel-main/apps/agents/src/lib/content/*` (faithfulness-gate.ts, voice-gate.ts, flesch-kincaid.ts, etc.). Some named files (broken-chunk-linter, banned-lexicon-linter, geo-citation) may differ — agent locates closest + ports faithfully.
  - P0.S.1 content schema: flywheel-main `packages/schema-flywheel` — content tables are on flywheel-main's **origin/preview** (local stops at 0029).
- **packages/schema-flywheel does NOT exist in sagemark** — P0.S.1 agent bootstraps it.
- **No Supabase wired in sagemark** — P0.S.1 live RLS contract test = Tier-3 NEEDS-INPUT unless a local Docker pg is reachable (Tier-2). Don't fake.
- Auto-merge ON. Hooks installed.

## Next action

Both agents spawning (Phase 3). When both return → Phase 4 lane-sharded judge (engine-port, schema-tenancy) → Phase 5/5.5 commit + auto-merge approved → Phase 6 state → Phase 7c loop-back (next: P0.E.3; P0.E.4 once P0.S.1 merges).

## Resume command
```
/seo-creator-build auto
```
Halt: delete `apps/seo/builds/seo-creator/.auto-loop.json`. Pause: create `.auto-loop.pause`.
