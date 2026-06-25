# SEO Creator build state

This directory is the orchestrator's persistent memory. It's owned by `/seo-creator-build`.

**Agents (engineering or otherwise) must NOT edit any file in this directory.** The Phase 4 judge flags any agent diff touching paths under here as scope-creep → `NEEDS-FIXES`.

## Layout

```
C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/
├── README.md                         # this file
├── STATE.md                          # current state pointer
├── run-log.md                        # append-only history
├── quality-log.md                    # trend table (one row per run)
├── checkpoints/                      # per-run detailed reports
│   ├── README.md
│   └── run-NNN-YYYY-MM-DD.md         # one per completed run
├── .run-lock.json                    # per-build mutex (only exists during a run)
├── flywheel-events.jsonl             # machine-truth event log (STATE.md is a view)
├── decisions/                        # decision records (one per non-obvious decision)
│   └── DR-NNN-slug.md
├── audits/                           # audit reports (one per audit invocation)
│   └── audit-NNN-YYYY-MM-DD.md
├── anchors.json                      # Layer 1 drift watch hashes
├── replays/                          # replay fixtures for judge/orchestrator regression testing
│   └── R-NNN-slug.md
├── corrections/                      # process-correction PR records (C.NNN.X)
```

## Conventions

- **STATE.md is the truth.** When in doubt, read it. The most-recent checkpoint is the detailed view of the most-recent run; STATE.md is the rolling pointer.
- **Never delete checkpoints.** They're the audit trail. If they grow large, rotate to a sub-directory (`checkpoints/archive-YYYY-MM/`).
- **`.run-lock.json` exists ⟺ a run is in flight or crashed mid-run.** Absent = idle. Present = check age + lock phase per the recovery decision tree in [blueprint chapter 05](../../../learnings/build-flywheel-blueprint/05-state-and-recovery.md).
- **`flywheel-events.jsonl` is append-only.** Never edit by hand. The orchestrator regenerates STATE.md / run-log.md / quality-log.md from events during Phase 6.
- **Decision records are immutable once written.** If a decision is superseded, write DR-NNN+1 referencing the superseded one — never edit the original.
- **Audits never auto-merge.** `A.NNN.X` PRs created from audit findings require human review precisely because they exist to fix something the judge missed.

## Reading order for a new contributor

1. Most recent checkpoint in `checkpoints/` — what just happened
2. STATE.md — where we are now
3. quality-log.md — how the trend looks
4. run-log.md — full history if you need context
5. The PR-MAP at `` — the work-unit registry
6. The decision-log in `decisions/` — the institutional memory

## Reading order to recover from a crashed run

1. `.run-lock.json` — what phase the crashed run reached
2. The corresponding `checkpoints/run-NNN-IN_PROGRESS.md` — what was assigned
3. Worktrees referenced in the IN_PROGRESS — what each agent left behind
4. STATE.md — the orchestrator-side state at the moment of crash

The `/seo-creator-build` recovery flow walks you through this — see [the orchestrator's Phase 1.5](../.claude/skills/seo-creator-build.md) §"Run lock".

## Compiled from

`learnings/build-flywheel-blueprint/` v1.0 on 2026-06-25T17:30:00-04:00 by `build-flywheel` skill v1.0.0. See `build-flywheel-manifest.json` at the repo root for the full compile decisions.
