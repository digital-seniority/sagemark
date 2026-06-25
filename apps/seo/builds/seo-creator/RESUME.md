# RESUME — SEO Creator build (intra-run cursor)

> **What this file is.** The fine-grained cursor for an in-flight `/seo-creator-build auto` run.
> STATE.md is the between-batch PR ledger; THIS file is the within-run pointer — rewritten by the
> orchestrator at every phase transition. After a context compaction or session resume, re-read
> this file first, then STATE.md, then continue. Never restart a run from scratch based on a
> compaction summary — trust this cursor + STATE.md + `gh pr view` reality.

**Status:** not started (no auto run has begun yet)

## Cursor

| Field | Value |
|---|---|
| Run # | — |
| Loop iteration | — / — |
| Lock phase | — |
| Updated at | — |

## In-flight PRs (this batch)

_None yet. When a run is active, each spawned PR appears here as `id → worktree → branch → status`._

## Next action

Begin a run: read STATE.md, run drift watch + preflight, plan the first batch.

## Resume command

```
/seo-creator-build auto
```

To halt an active autonomous loop, delete `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/.auto-loop.json`.
