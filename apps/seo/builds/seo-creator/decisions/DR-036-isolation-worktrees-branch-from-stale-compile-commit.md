# DR-036 — isolation-worktrees-branch-from-stale-compile-commit

**Date:** 2026-06-26
**Run:** #022 (observed by all 3 spawned agents)
**Status:** active
**Build phase:** Phase 1 — Pilot

## Context

Phase 3 spawns each PR agent with `isolation: "worktree"`. The skill (Phase 3.0) assumes each linked worktree branches off the root repo's current `HEAD` (which the orchestrator lands on `origin/preview` before spawning).

## Problem

All three Run #22 agents reported their isolated worktree branch was cut from **`95d5486`** — the `/seo-creator-build` orchestrator-compile commit, **65 commits behind `preview`** (`8d75eb9`) — NOT from `preview` HEAD. That base predates the entire `apps/seo` implementation (no `src/lib/content`, no migrations 0030+, no SSR route). An agent that wrote against it would produce a PR diffed against stale state (rebase storms, phantom "deletions", broken deps).

## Decision

Two-part:

1. **Agent-side guard (already happened, make it standard).** Each agent verified `95d5486` was a clean ancestor of `preview` with **zero divergent commits**, then fast-forwarded its worktree branch to `origin/preview` HEAD (`git reset --hard preview` / `git merge --ff-only preview`) before writing. This is safe (no work lost; pure ancestor fast-forward) and produced clean PRs diffed against `preview`. The Phase 3 agent prompt should include this as an explicit STEP 0.5 after the isolation guard: *"confirm your base == `origin/preview` HEAD; if it is a clean ancestor with 0 divergent commits, `git merge --ff-only origin/preview` before writing; if it has diverged, STOP and report."*

2. **Root cause to investigate (orchestrator/infra).** Why does `isolation: "worktree"` branch from `95d5486` instead of the orchestrator's checked-out `preview` HEAD? Hypotheses: the harness creates worktrees from the commit where the build skill/session was compiled, or from a cached ref, not from live `HEAD`. Until understood, the orchestrator MUST NOT assume agents inherit `preview` — the STEP 0.5 ff-guard is load-bearing, and Phase 6 commit/PR must verify each worktree branch is based on `origin/preview` HEAD (Run #22 did: both COMPLETE worktrees confirmed at `8d75eb9` before commit).

## Consequences

- No correctness impact this run (agents self-corrected; both merged/PR'd diffs are clean against `preview`). But it is a silent floodgate hazard: an agent that skipped the ff-guard could ship a catastrophic stale diff.
- Add the STEP 0.5 ff-to-preview guard to the agent prompt template for all future runs.
- Verify-before-commit (Phase 5) must always check `git -C <wt> rev-parse HEAD == origin/preview HEAD` before staging.

## Links

Run #22 checkpoint; Phase 3.0 (land root on preview); the Run #130 stale-base failure mode referenced in the agent Step-0 guard.
