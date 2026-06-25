---
name: seo-creator-build
description: Orchestrate one iteration of the SEO Creator multi-session flywheel build. Reads current state, plans the run, spawns concurrent worktree-isolated agents for parallel PR work, runs a process+product quality check via a judge agent, commits via gh native flow, and writes a session checkpoint so the next run picks up seamlessly. Use when continuing the SEO Creator build at C:/Users/stone/Code/sagemark/plans/seo-creator/flywheel.
---

# /seo-creator-build — Flywheel orchestrator

You are running **one iteration of the SEO Creator multi-session build**. Each invocation = one "run" that advances the work by 1-N merged PRs and writes a checkpoint the next run will read.

Keywords: seo creator build, content hub build, seo gate build, sagemark apps/seo, agent-sdk worker build

## Input

`$ARGUMENTS` (optional):
- **Empty** → pick up from `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/STATE.md`
- **A PR id** (e.g., `P0.W.1`) → focus this run on that specific PR
- **`status`** → read-only — report current state without spawning any work; does NOT acquire the run lock
- **`dry-run`** → run Phases 1, 1.5 (preflight only — no lock acquired), and 2 (planning); print the planned agent prompts and write-scope manifests; **do not spawn agents, do not write IN_PROGRESS checkpoint, do not commit**
- **`bootstrap`** → first-run initialization (creates STATE.md from PR-MAP)
- **`auto [max-loops=N]`** → **autonomous loop.** Run a batch, then loop back to Phase 1 and run another, continuing across context-compaction boundaries until eligible work is depleted or a cap/blocker hits. Writes `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/.auto-loop.json` (the control + kill switch) and keeps `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/RESUME.md` current so a mid-run compaction resumes exactly. Default cap: 8 loops (override with `max-loops=N`). See the "Autonomous loop + context management" section below.
- **`pause`** → non-destructively pause an active auto-loop: create `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/.auto-loop.pause`. The Stop hook lets the turn end (so you can ask questions / inspect) without killing the loop. Report that it's paused.
- **`resume [--claim]`** → delete `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/.auto-loop.pause` to un-pause, then continue with `auto`. If the loop is owned by another (e.g. ended) session, `--claim` clears its `session_id` so this session adopts it. If `.auto-loop.json` isn't active, say so.
- **`conservative`** → fall back to `cap-4` capacity for this run only (4 PR agents + 1 judge max). Useful when human-review bandwidth is the real bottleneck.
- **`max=N`** → override the per-run cap to N PR agents.
- **`no-merge`** → run normally but stop after Phase 5 PR creation; do NOT auto-merge. Useful when verifying judge calibration after a process change.
- **`audit [scope]`** → run an audit pass (no engineering work). `scope ∈ {full, architecture, convention, spec, tests, state}`. Spawns 5 parallel audit-agents and writes `audits/audit-NNN-YYYY-MM-DD.md`.
- **`phase-close`** → forces a full audit before transitioning to the next build phase. Required at phase boundaries.

## Skill runtime

This skill is written for the **claude-code** runtime running in **powershell**. Cross-runtime migration: see `C:/Users/stone/Code/sagemark/.claude/skills/seo-creator-build/runtime-adapters-note.md` (if emitted).


## Source of truth

This skill operates against these documents. Read them every run:

- **PRD:** `prd.md` — Strategic + product spec

Build state lives in `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/`:

- `STATE.md` — current state pointer (always reflects "where are we right now")
- `run-log.md` — append-only history of every run
- `quality-log.md` — process + product scores per run (trend table)
- `checkpoints/run-NNN-YYYY-MM-DD.md` — detailed per-run report
- `RESUME.md` — intra-run cursor (finer than STATE.md); rewritten at every phase so a mid-run context compaction resumes exactly
- `.auto-loop.json` — autonomous-loop control + kill switch (ephemeral, gitignored); present+`active` ⇒ a loop is running
- `flywheel-events.jsonl` — append-only machine-truth event log; STATE.md is a generated view
- `decisions/DR-NNN-slug.md` — decision records (one per non-obvious decision)
- `audits/audit-NNN-YYYY-MM-DD.md` — audit reports (one per audit invocation)
- `anchors.json` — content-hash map for the anchor sub-pages (Layer 1 drift watch)

Supporting prompts live in `C:/Users/stone/Code/sagemark/.claude/skills/seo-creator-build/`:

- `judge-prompt.md` — the judge agent's persona for quality checks (SEO Creator-specific lanes)
- `state-template.md` — STATE.md structure
- `checkpoint-template.md` — checkpoint structure
- `decision-record-template.md` — DR shape
- `audit-prompt.md` — 5 audit-agent personas

## Autonomous loop + context management (READ FIRST in `auto` mode)

This build supports an **autonomous loop** that survives Claude Code context compaction. The discipline below is what makes a multi-hour run continue smoothly across compaction boundaries instead of stalling — treat it as load-bearing, not optional.

**Three durable artifacts (all in `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/`):**

- **`STATE.md`** — the between-batch PR ledger (which PRs are MERGED/NOT_STARTED/etc.).
- **`RESUME.md`** — the *intra-run cursor*. Rewrite it **at every phase transition** (the same moments you update `.run-lock.json`'s `phase`). It records: run #, loop iteration, current phase, in-flight PR assignments (`id → worktree → branch → status`), the next eligible batch, and a one-sentence "next action." This is the file a post-compaction session reads FIRST.
- **`.auto-loop.json`** — the loop control + **kill switch**. The Stop hook reads + ENFORCES this (so the bounds survive compaction — they don't depend on this prose surviving a summary). Shape:
  ```json
  { "active": true, "slug": "seo-creator", "run_number": N, "iteration": K,
    "max_iterations": 8, "consecutive_block_limit": 3,
    "manifest_path": "build-flywheel-manifest.json", "started_at": "<iso>",
    "budget": { "max_wall_clock_hours": 6 },
    "last_merged_count": 0, "consecutive_blocks": 0, "total_blocks": 0,
    "paused": false, "hard_stop": false, "terminal_reason": null, "compactions": 0 }
  ```
  Note: `phase` is NOT stored here — it lives in `.run-lock.json` (the canonical resume pointer). `manifest_path` is relative to the project root so the Stop hook can read the dependency DAG for real eligibility. `budget`/`started_at`/`last_merged_count`/`total_blocks` are what let the hook enforce wall-clock + anti-runaway in code.

**Lifecycle:**

1. **On `auto` start:** write `.auto-loop.json` with `active:true, iteration:1`, `started_at` = now, `manifest_path` pointing at this build's `build-flywheel-manifest.json`, and `budget`/`max_iterations`/`consecutive_block_limit` copied from the manifest's `operations.auto_loop` (honor `max-loops=N` from `$ARGUMENTS` as an override). Then run Phase 1 normally.
2. **Every phase transition:** update `RESUME.md` (the human/compaction cursor). You do NOT need to touch `.auto-loop.json` here — the hook maintains its own counters.
3. **At end of Phase 6 (after self-verify + state landing) — the LOOP-BACK decision:**
   - Recompute eligible work from the freshly-written `STATE.md` (NOT_STARTED/INTERRUPTED PRs whose deps are MERGED, minus non-engineering blockers).
   - **Continue the loop** if eligible work remains and no hard-stop condition tripped: bump `iteration` in `.auto-loop.json`, update `RESUME.md` ("looping to run #N+1"), then **go back to Phase 1** (re-read STATE.md fresh — do not reuse stale in-context state).
   - **Otherwise end the loop:** set `.auto-loop.json` `active:false` and `terminal_reason` (do NOT delete the file — deletion races with the PreCompact hook and can resurrect a dead loop; `active:false` is the clean terminal state). Write a final `RESUME.md` summary (X merged / Y blocked / Z remaining) and report.
4. **Hard-stop conditions** (set `hard_stop:true, active:false, terminal_reason`, and SURFACE — do not loop past these): blocked, requires_human_merge, self_verify_inconsistency, abort. Concretely: any PR `BLOCKED` after max re-judges, any `REQUIRES_HUMAN_MERGE`, a Phase 6 self-verify inconsistency, or any preflight/abort failure.

**Bounds are enforced by the Stop hook, not by this prose.** Even if a compaction erases the steps above, the Stop hook independently: enforces the wall-clock budget (from `started_at` + `budget`), resets the stall counter only when it observes the on-disk MERGED count rise (real progress), trips a hard `total_blocks` ceiling derived from `max_iterations`, and refuses to force continuation when STATE.md shows no dependency-eligible work. The prose above is the *happy path*; the hook is the *guarantee*.

**Compaction continuity (how a mid-run compaction recovers):** three reinforcing mechanisms point the next turn back here — the **Stop hook** (keeps the turn alive), the **SessionStart(compact) hook** (re-injects the resume pointer), and the **CLAUDE.md Compact Instructions** block. Each says the same thing: *re-read `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/RESUME.md` then `STATE.md`, and continue `/seo-creator-build auto` from the cursor — do not restart, do not re-merge MERGED PRs.* Installed by `.claude/hooks/install-autoloop-hooks.mjs` (start-flywheel runs it automatically); idempotent and no-ops when no loop is active.

**Kill switch:** delete `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/.auto-loop.json` to STOP the loop after the current turn. **Pause (non-destructive):** create `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/.auto-loop.pause` — the Stop hook will let the turn end (so you can ask questions / inspect) without killing the loop; delete the pause file to resume.

**Idempotency:** every loop re-verifies GitHub reality in Phase 6 (`gh pr view --json state`), so a compaction that lands mid-merge can never double-merge — a PR already `MERGED` on GitHub is recorded, not re-created.

## Phase 1 — Read state (parallel)

Read in parallel via Read tool calls in a single message:

1. `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/STATE.md` — current state
2. `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/run-log.md` — last 200 lines (use offset for tail)
3. prd.md — PR map + relevant PR sections for the next batch
4. Most recent checkpoint in `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/checkpoints/`
5. `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/anchors.json` — current anchor hashes

If `STATE.md` does not exist (or `$ARGUMENTS` is `bootstrap`):
- Bootstrap from PR-MAP — copy the structure from `C:/Users/stone/Code/sagemark/.claude/skills/seo-creator-build/state-template.md`
- Mark every PR as `NOT_STARTED`
- Skip to Phase 6 (write state, no agents to spawn yet)

If `$ARGUMENTS` is `status`:
- Report current state from STATE.md (phase, X/Y merged, next-up PRs, active blockers).
- **Auto-loop status** (read `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/.auto-loop.json` if present): active / paused (is `.auto-loop.pause` present?) / ended-with-`terminal_reason`; `iteration`/`max_iterations`; elapsed = now − `started_at` vs `budget.max_wall_clock_hours`; `consecutive_blocks`/`total_blocks`/`compactions`; and a **hook-health** line — confirm `.claude/hooks/flywheel-stop-continue.mjs` exists and `.claude/settings.json` has the 4 flywheel hooks wired (if not, the loop won't survive compaction — tell the user to run `.claude/hooks/install-autoloop-hooks.mjs`). Then list the next eligible PRs.
- Stop. Do not spawn agents, do not commit. Do not acquire the run lock.

If `$ARGUMENTS` is `pause`:
- Create `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/.auto-loop.pause` (empty file). Report: "Auto-loop paused — the current turn may end normally; the loop control (`.auto-loop.json`) is preserved. Run `/seo-creator-build resume` to continue." Stop (no lock, no agents).

If `$ARGUMENTS` starts with `resume`:
- Delete `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/.auto-loop.pause` if it exists.
- **Ownership check (reclaim path):** read `.auto-loop.json`. If it's `active` and its `session_id` is set to a DIFFERENT session than the current one, the loop is owned by another (possibly dead) session — the hooks will refuse to drive it from here. If `$ARGUMENTS` is `resume --claim`, **clear `session_id`** (set it to `null`) so this session re-claims it via the Stop hook on the next block; report "Reclaimed loop (was owned by session `<old>`)". If `--claim` was NOT passed, STOP and surface: "This loop is owned by session `<old>`. If that session has ended, run `/seo-creator-build resume --claim` to adopt it."
- If `.auto-loop.json` exists with `active:true` and ownership is fine (or just reclaimed), continue as `auto` (fall through to the auto path). If there's no active loop, report that there's nothing to resume and stop.

If `$ARGUMENTS` starts with `auto` (autonomous loop):
- Parse an optional `max-loops=N` (else default 8).
- If `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/.auto-loop.json` does NOT already exist with `active:true` (i.e., this is the start of a loop, not a post-compaction continuation), **create it** per the full shape in "Autonomous loop + context management" — including `started_at` (now), `manifest_path`, and `budget`/`max_iterations`/`consecutive_block_limit` copied from the manifest's `operations.auto_loop`, plus `last_merged_count:0, total_blocks:0, consecutive_blocks:0, paused:false, hard_stop:false`. (These fields are what the Stop hook enforces against.)
- If it DOES already exist with `active:true`, you are CONTINUING an in-flight loop (likely after a compaction) — do not reset it; read `RESUME.md` for the cursor and proceed.
- Then continue into Phase 1.5 normally. The loop-back happens in Phase 7c.

## Phase 1.5 — Preflight + acquire run lock

Before planning anything, verify the environment is ready and no other run is in progress. **Fail early — half-broken runs are worse than no run.**


### Phase 1.5b — Orchestrator-only checks

**Prior-run-state-landing check.** Before planning this run, verify the previous run's Phase 6 state landing actually reached `origin/preview`. Without this, the orchestrator's anchor-hash registry, quality-log trend, and audit-counter all silently operate on stale data.

```powershell
# Verify the most recent state-landing commit IS on origin/<base>
git fetch origin preview --prune
git log --oneline origin/preview --grep "^build: Run #" -1
# If the grep returns nothing OR returns a run number more than 1 behind expected, prior Phase 6 was skipped.
```

If the check trips:
- **STOP** and surface: "Prior run #N-1 Phase 6 (orchestrator state landing) did not reach `origin/preview`. The on-disk STATE.md is X runs behind the integration trunk. Options: (a) recover stranded state from the orchestrator branch via PR; (b) ignore and proceed with stale state (acknowledged risk; flag in checkpoint)."
- Do NOT proceed silently — the flywheel's drift watch (Phase 1.7) operates on stale data and will silently miss anchor drift.

The orchestrator's worktree must be in a usable state. (Each PR agent gets its own fresh worktree via `isolation: "worktree"` in Phase 3, so cleanliness of the parent repo doesn't matter — only the orchestrator's own worktree.)

**PowerShell:**

```powershell
# Must succeed
git rev-parse --is-inside-work-tree

# ORCHESTRATOR worktree must be clean
git status --porcelain                                       # output must be empty

# GitHub auth
gh auth status 2>&1 | Select-String "Logged in"              # must match

# Env loaded (smoke test required vars)

# Commit workflow available
```

Map failures to user-actionable remediation:

| Failure | Remediation surfaced to user |
|---|---|
| Not in a worktree | "Per CLAUDE.md, every task uses a worktree. Run `EnterWorktree` first." |
| Orchestrator worktree has uncommitted changes | "The orchestrator's worktree must be clean (each PR agent gets its own fresh worktree). Commit or stash the local changes first." |
| `gh auth` missing | "Run `gh auth login` first." |

Any failure → STOP. Surface the specific failure with remediation. Do not continue.

### Orchestrator-owned files (agents are forbidden from editing)

Agent-spawned work must NOT touch these paths — only the orchestrator (this skill) writes them:

- `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/STATE.md`
- `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/run-log.md`
- `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/quality-log.md`
- `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/checkpoints/*`
- `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/.run-lock.json`
- `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/flywheel-events.jsonl`
- `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/decisions/*`
- `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/audits/*`
- `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/anchors.json`

This is enforced via two mechanisms:
1. The agent prompt template (Phase 3) explicitly lists these as out-of-scope
2. Judge phase (Phase 4) flags any agent's diff that touches these files as scope-creep → `NEEDS-FIXES`

If an agent did edit these (judge catches it), revert just those file changes from the agent's worktree before considering the PR for commit.

### Run lock

Check `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/.run-lock.json`:

**If lock file does NOT exist:** create it and proceed:

```json
{
  "run_number": NNN,
  "started_at": "<ISO timestamp>",
  "phase": "preflight",
  "session_id": "<random uuid>",
  "branch": "<current branch name>",
  "worktree_path": "<absolute path>"
}
```

**If lock file EXISTS:** another run is in progress OR a prior run crashed.

1. Read the lock + the corresponding `run-NNN-IN_PROGRESS.md` checkpoint (if any)
2. **Check lock age** — compute `now - started_at`:
   - **< 4h:** treat as likely-still-running. Surface to user with that framing.
   - **≥ 4h:** treat as likely-crashed. Surface with that framing and lean toward resume/force-clear.
   - **≥ 24h:** strongly suggest force-clear; the work is almost certainly orphaned.
3. Surface to user: *"Run #NNN lock found (started `<ts>`, age `<H>h`, last phase: `<phase>`, branch: `<branch>`). Likely status: `<still-running | crashed | orphaned>`. Options: (a) RESUME from the last consistent state, (b) FORCE-CLEAR the lock and start fresh (any uncommitted agent work is lost)."*
4. Wait for user decision
5. **Resume path:** read the IN_PROGRESS checkpoint; jump to the appropriate phase based on lock's `phase` field. Only re-run the phase that didn't finish.
6. **Force-clear path:** archive `run-NNN-IN_PROGRESS.md` as `run-NNN-ABORTED.md`; delete the lock; restart at Phase 1.5

The lock file is updated as the run progresses (`phase` field flips through `preflight → agents_spawning → judging → committing → verifying`) and **deleted at the end of Phase 6** when the run cleanly completes.

## Phase 1.7 — Drift watch (~30s; four parallel checks)

Update lock: `phase = "drift_watch_complete"` after this phase.

Run these four checks in parallel via Read tool calls in a single message:

### a. Anchor sub-page hash check

Read `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/anchors.json` (the recorded hashes from last run's Phase 6). For each anchor, compute the current hash of `C:/Users/stone/Code/sagemark/plans/seo-creator/flywheel/<sub-page>`. Compare.

If any anchor's hash differs → **drift signal**. Surface:

> **Anchor drift detected:** sub-page `` has been edited since Run #NNN-1. Current PR-MAP rows referencing this sub-page may be operating on stale interpretation. Options: (a) read the diff between hashes, update relevant PR-MAP rows + create reconciliation PRs, then continue; (b) proceed with stale interpretation (acknowledged risk); (c) `/seo-creator-build audit spec` for full bidirectional reconciliation now.

### b. Trend signal check

Read last 5 rows of `quality-log.md`. Trip a `recommend-audit` message if ANY of:
- Judge score (process or product) declined for 3+ runs in a row
- `BLOCKED` rate > 20% of PRs across the window
- Re-judge rate > 40% across the window

### c. State sanity check

Pick 3 random PRs marked `MERGED` and `gh pr view <URL> --json state,mergeCommit`. Verify (a) `state == "MERGED"` AND (b) `mergeCommit` is reachable from `origin/preview` via `git merge-base --is-ancestor <mergeCommit> origin/preview`. If either fails → STATE.md is out of sync with reality. Surface.

**Edge case:** PRs that show GitHub `state == "OPEN"` but whose commit IS reachable from the base branch (integrated outside the PR flow — e.g., via direct merge). Treat as MERGED for dependency purposes; flag the stale GitHub PR for human cleanup. STATE.md should record both the PR URL (historical context) and the integrated-commit SHA.

### c.5. Greppable-assertion check (content drift — for anchors with assertions[])

For each anchor in `anchors.json` that has an `assertions[]` array, run each assertion's `check_command` and compare its stdout to `expected`. Mismatches surface as **content-drift** candidates (non-blocking warning — log to checkpoint).

This catches the failure mode where the anchor file's hash is unchanged but shipped code diverged from a structurally-checkable spec commitment (e.g., "system has 26 tools registered; if `grep -c "Tier" pkg/tools/registry.go" != 26, the spec moved but no one noticed"). Cost: ~10s total across all anchors; budget ~30s.

```powershell
# Each assertion runs and gets compared to expected
for anchor in anchors.assertions:
  actual = run(anchor.check_command).stdout
  if actual != anchor.expected:
    surface_warning("content drift: {anchor.name} expected '{anchor.expected}', got '{actual}'")
```


### d. Decisions-captured check

Read the last checkpoint. If judges flagged decision-worthy items that haven't yet become `DR-NNN-slug.md` files in `decisions/`, surface the gap.

### What trips

If any of the four trips, pause and ask the user before proceeding to Phase 2. Cheap to check; high signal when it fires.

## Phase 3.0 — Land root repo on `origin/preview` (before spawning)

Update lock: `phase = "main_synced"` after this phase.

**Why this matters in floodgate mode:** the `isolation: "worktree"` tool creates each temporary worktree branched off the root repo's current `HEAD`. If `HEAD` is stale, every spawned agent branches from stale state and their PRs conflict with current integration. Squash-merges produce new commit SHAs distinct from feature-branch SHAs, so a stale local base causes rebase storms.

**Strategy: pull-ff-only** (simple — assumes the base branch is not checked out in another worktree).

```powershell
git checkout preview
git fetch origin --prune
git pull --ff-only origin preview
```

**On `--ff-only` failure** (local has unpushed commits AND origin has advanced): **STOP**. Surface the three options to the user: push local, hard-reset local, inspect manually. Do not auto-resolve — worktree divergence is exactly the kind of state drift the flywheel must not paper over.

**On `git fetch` failure** (network, GitHub down, auth): **STOP**. Don't proceed with a possibly-stale local base.

## Phase 2 — Plan this run

Update lock: `phase = "preflight"` → `phase = "preflight"`.

**Audit blocking gate.** Before planning this run, check `runs_since_last_audit` (tracked in STATE.md). If ≥ 5 work-doing runs have occurred without a `/seo-creator-build audit`, the current invocation is **BLOCKED** from work-doing. Surface to user:

> Runs since last audit:  ≥ threshold 5. The orchestrator will not advance the build further until an audit runs. Invoke `/seo-creator-build audit full` now (~5-10 min), then re-run.

STOP. Do not advance to Phase 2 picker.

From the PR-MAP and current state, identify:

1. **Eligible PRs** — `NOT_STARTED` or `INTERRUPTED` PRs whose code dependencies are all `MERGED`. **Also exclude PRs blocked by non-engineering deliverables** (counsel signoffs, vendor subscriptions, brand assets).

2. **Pick the batch** in this priority order:

   **a. Different lanes preferred.** SEO Creator has 6 lanes: engine-port, worker-runtime, schema-tenancy, agent-ui, render-geo, client-review. Pick across mixed proportions. True parallelism + minimal merge-conflict risk.

   **b. Dependency-unblocking PRs preferred.** When tied, pick the one whose merge frees the most downstream work.

   **c. Cap high-risk PRs at 1 per run.** "High-risk" = anything tagged `risk: High` in the PR-MAP.

   **d. Floodgate mode (DAG-bounded).** Default: spawn every dependency-eligible PR's agent. No arbitrary cap. `conservative` argument falls back to cap-4. `max=N` overrides.


   **e. When N+ PRs are eligible, document picker logic.** State which N picked, which were deferred, and the one-line reason for each.

   **f. Lane disambiguation for judge sharding.** PRs touching write-scopes in multiple lanes (e.g., both backend and frontend file paths) go into the `cross-cutting` shard (NOT split across lane shards). Cross-cutting shard reviews BE/FE contract alignment + feature-flag wiring end-to-end + doc/code drift.

   **g. Lane → subagent_type mapping.** When spawning agents in Phase 3, map each PR to a subagent_type:

| PR lane / nature | Subagent type |
|---|---|
| engine-port (Port the deterministic content kernel (scorers, faithfulness/voice gates, seo-gate, lifecycle-fsm, content-store) from flywheel-main origin/preview into @sagemark/core + apps/seo, verbatim — no reinvention, no markdown drift.) | `general-purpose` |
| worker-runtime (The Claude Agent SDK self-hosted worker on Vercel Sandbox: the autonomous loop host that runs the seo-copywriter suite skills, the capability-denial confinement, and the worker<->apps/seo SSE transport.) | `general-purpose` |
| schema-tenancy (Supabase multi-tenant schema + RLS + the client_signoffs / credentialed_releases / byline_authorizations release split + CI tenant-isolation contract tests.) | `general-purpose` |
| agent-ui (The three-zone agent canvas (reuse the existing apps/agents StudioCanvas/PinOverlay/VersionHub), live token streaming, the Inspector gate scorecard, conversational fine-tune, and the version hub.) | `general-purpose` |
| render-geo (The content-hub SSR render route, FAQ JSON-LD, placeholder stripping, sitemap/robots, the CI reachability gate, the generated resource-library homepage (D7), and imagegen hero resolution.) | `general-purpose` |
| client-review (Tokenized client-review preview, pinned comments + section approve/request-changes verbs, Request-changes->edit-loop routing + named sign-off + approval-debt KPI, the separate SEO cost ledger, and share-of-model instrumentation.) | `general-purpose` |
| Cross-cutting (multiple lanes' write-scopes touched) | `general-purpose` |

3. **List active blockers** — any non-engineering deliverables blocking. Surface them in the run plan even if they don't affect this run's batch.

If `$ARGUMENTS` specifies a PR id, that overrides — only do that PR. Surface if its dependencies aren't met.

**Output:** State the plan to the user in 4–7 sentences before spawning anything. Format:

> **Run #NNN plan:** Spawning N concurrent agents for PR `<id>` (<desc>), PR `<id>` (<desc>), PR `<id>` (<desc>). Lane mix: `<lanes>`. Deferred this run: PR `<id>` (reason — e.g., "second high-risk PR; one per run cap"). Estimated <range> minutes. Quality judge will run after. Committing approved work via gh native flow at the end. Active blockers (don't gate this run): <list or "none">.

Wait for any user objection.

### Write the IN_PROGRESS checkpoint (before spawning anything)

If the machine crashes mid-run, the next invocation must know what was assigned. Write `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/checkpoints/run-NNN-IN_PROGRESS.md`:

- The full run plan (verbatim from above)
- Per-PR assignment: which agent will own which PR
- **Write-scope manifest per PR** — the files/directories each agent is expected to touch (from the PR-MAP row). Agents declare actual touched files in their reports; judge cross-checks for scope creep.
- Lock-file reference + start timestamp

Update the lock file's `phase` to `agents_spawning`.

This file gets renamed to `run-NNN-YYYY-MM-DD.md` at the end of Phase 6 when the run completes cleanly. If aborted, stays as IN_PROGRESS for next-run recovery.

## Phase 3 — Spawn concurrent agents (single message, multiple Agent tool calls)

For each PR in the batch, spawn one Agent in a single message (true parallel execution). **Use `isolation: "worktree"` on every Agent call** so each agent gets its own git worktree on its own branch.

**Parallel-mode awareness:** when this batch has N>4 agents, set `SEO_CREATOR_FLOODGATE=1` in each spawned agent's environment so it knows it's running alongside siblings and applies shared-resource discipline (per blueprint chapter 10 §3).

### Agent prompt template


For each PR, fill this template:

```
You are implementing PR <ID> of the SEO Creator build (lane: <LANE>).

PARENT PLAN: prd.md

THIS PR's SPEC: <see <SPEC.md path>:<section ref> — paste the entire section verbatim below>

<paste the entire PR spec section: scope, files touched, migration SQL, acceptance criteria, test plan with tier fallback, dependencies, risk, rollback>

WRITE-SCOPE MANIFEST: This PR is expected to touch ONLY these files/directories:
- <enumerated list from the PR-MAP row's write_scope>

OUT-OF-SCOPE (forbidden — judge will flag):
- C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/** (orchestrator-owned)
- Any file outside your declared write-scope manifest

If your work requires editing files outside your scope, STOP and report — do not improvise. Scope creep is a flag for the judge.

STEP 0 — WORKTREE ISOLATION GUARD (MANDATORY — run this BEFORE writing any file):

You were spawned with `isolation: "worktree"`, so you MUST be operating in your own
linked worktree, NOT the parent repo's working tree. If isolation silently failed to
bind, writing here corrupts the shared root and tangles with sibling agents (the Run #130
failure mode). Verify before touching anything. Do NOT `cd` to an absolute repo path and
do NOT assume you are at the repo root — operate in the worktree the harness placed you in.

```powershell
if ((git rev-parse --git-dir) -eq (git rev-parse --git-common-dir)) {
  Write-Error "[Step 0] STOP: not in an isolated worktree — isolation did not bind. Refusing to write; report to the orchestrator."; exit 1
}
Write-Output "[Step 0] OK — isolated worktree confirmed"
```

If the guard fails, STOP and report — do NOT try to "fix" your location by cd-ing elsewhere.

PARALLEL-RUN AWARENESS (floodgate mode):
- If you see SEO_CREATOR_FLOODGATE=1 in your environment, the orchestrator is running you alongside many sibling agents in parallel. This affects how you self-test:
  - **DB-touching tests** in the shared local DB MUST be transaction-scoped (begin tx → run test → ROLLBACK). Cross-test data contention is the main floodgate failure mode.
  - If your PR requires DB-mutating integration tests that CAN'T be transaction-scoped, mark those tests as **Tier-3 NEEDS-INPUT** in your report and explain — the judge verifies the logic from the code path.
  - **Filesystem operations** are worktree-isolated; no special handling needed.
  - **Shared ports / Docker namespaces**: prefix with a unique worktree-derived ID to avoid cross-test bleed.
- Your worktree is your own (via `isolation: "worktree"`) — you don't see, and can't accidentally edit, the parent repo or other agents' worktrees.

ANCHOR SUB-PAGES (read before writing code):
- <list of anchor sub-pages for this PR from anchor_subpages[]>
- If your PR contradicts any anchor, STOP and surface — anchor violations are critical findings, not stylistic preferences.

DECISION RECORDS (read if your PR's scope keywords match):
- grep `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/decisions/` for keywords from your PR's scope
- If your PR contradicts an active DR, STOP and surface.

INSTRUCTIONS:
1. Implement exactly what the spec says — no scope additions, no "while we're here" refactors.
2. Self-test before declaring done:
   <lane-specific test commands — derived from manifest.lanes[].specialization_hints>
3. **Fallback test tiers** for tests requiring external systems:
   - **Tier 1 (preferred):** the test as specified in the spec
   - **Tier 2 (fallback):** equivalent test against local resources
   - **Tier 3 (last resort):** mark `NEEDS-INPUT` with a clear note about what's missing + suggested manual verification path. **Never silently pass a test that should have run.**
4. **Include a ROLLBACK PLAN in your report:**
   - For schema PRs: the down migration SQL or revert procedure
   - For code PRs: which files to revert + the prior commit SHA
   - Standard: "How would I undo this in 60 seconds if production breaks?"
5. **SEO Creator-specific guardrails:**
   - Multi-tenant: every new query or table access must scope by `tenant_id` / `workspace_id`. Run-time check: if your PR touches a query, paste it into the report — judge verifies tenant scoping.
   - Brand tokens: no hardcoded colors / fonts. All token-driven from BRAND.md / theme tokens.
6. If you encounter ambiguity in the spec — STOP and report. Do not improvise.
7. Return a structured report:
   - **Status:** COMPLETE | NEEDS-INPUT | BLOCKED
   - **Files added / modified:** explicit list
   - **Write-scope check:** files actually edited; flag any outside the declared manifest with reason
   - **Acceptance criteria:** each item with ✅ or ❌ + evidence (test output / diff / SQL result / link)
   - **Test results:** which tier was used per test; tier-3 NEEDS-INPUT items called out
   - **Tenant-scoping check:** any new query/table access listed with the workspace_id filter
   - **Rollback plan:** explicit, executable
   - **Any deviations from spec:** with reason
   - **Suggested commit message**
   - **Worktree path + branch name** (returned by the isolation: "worktree" execution)
```

<!-- ADAPTER:agent-spawn:start -->
Use `subagent_type: "<lane.subagent_type or general-purpose>"` for engineering work. **Always** with `isolation: "worktree"`.
<!-- ADAPTER:agent-spawn:end -->

Wait for ALL parallel agents to return before proceeding. Do not partial-progress to the judge phase.

## Phase 4 — Quality check via judge agent (sharded)

Update lock: `phase = "judging"`.

Spawn ONE Agent per lane in parallel (single message, multiple Agent tool calls) with the judge persona scoped to that lane.

Each shard prompt is the base `C:/Users/stone/Code/sagemark/.claude/skills/seo-creator-build/judge-prompt.md` PREPENDED with a per-shard scope + lane-specialization hint:

```
You are the <LANE> shard of the SEO Creator judge. Review ONLY:
- PR <id> (<lane>): <description>
- PR <id> (<lane>): <description>

Lane-specialization hints:
<from manifest.lanes[].specialization_hints>

<base judge prompt — identical across shards>
```


**No meta-judge.** Consolidation is *pure aggregation* by the orchestrator: weighted-average scores (weight by PR count), dedupe improvements, union escalations. A meta-judge re-introduces the single-bottleneck problem sharding was designed to solve.

**The judge returns a structured verdict:**

```
PER PR:
- PR <ID>: APPROVED | NEEDS-FIXES (with specific list)

PROCESS SCORE: 1-5 with one-sentence reason
PRODUCT SCORE: 1-5 with one-sentence reason

TOP IMPROVEMENTS FOR NEXT RUN:
1. ...
2. ...

ANY ESCALATIONS REQUIRING USER:
- ...
```

**If judge returns NEEDS-FIXES on any PR:**

- Spawn fix-agents **in parallel** (single message, one Agent call per failing PR), each receiving its specific issue list from its judge shard, working in the same worktree as the original agent
- After all fix-agents return, **re-shard the judge** with only the just-fixed PRs as scope
- Repeat at most 2 times — if still failing, mark the PR `BLOCKED`

The per-PR retry loop is independent per PR. Serializing fixes for N NEEDS-FIXES PRs costs N× the wall-clock for no benefit.

### Partial-batch handling (mixed APPROVED + BLOCKED)

Because Phase 3 spawns each agent with `isolation: "worktree"`, every PR's work lives in its own dedicated worktree on its own branch. Partial-batch handling is therefore **trivially clean** — there is nothing to revert, no file conflicts to detect:

- **All APPROVED:** proceed to Phase 5; commit each worktree sequentially.
- **All BLOCKED:** mark the whole run failed. STATE.md reflects no progress. Worktrees of BLOCKED PRs left intact for human inspection. Next run retries with a smaller batch + applied learnings.
- **Mix of APPROVED + BLOCKED:**
  - Proceed to Phase 5 with the **APPROVED worktrees only**
  - **Leave BLOCKED worktrees untouched** — they're isolated, they don't pollute anything
  - Mark each BLOCKED PR with status `BLOCKED` in STATE.md + document judge feedback in the cell + defer to next run
  - Document the BLOCKED worktree paths in the checkpoint so a human can inspect or the next run can resume

## Phase 5 — Commit (per-PR transactional)

Update lock: `phase = "creating_prs"`.

Once judge approval state is resolved (all APPROVED, OR mixed with BLOCKED extracted cleanly), **commit each approved PR's worktree separately and sequentially**. Track per-PR state explicitly — the commit workflow may succeed for some PRs and fail for others.

### Per-PR state machine

For each APPROVED PR, the state evolves: `APPROVED_NOT_COMMITTED` → (during commit) → `PR_CREATED` → (after merge) → `MERGED`. On failure: `PREVIEW_FAILED`. Update STATE.md on each transition (not at end of phase) so a crash mid-phase doesn't lose track.

### Sequential commit loop

For each APPROVED PR (in dependency order — earliest deps first):

1. Update lock file: `phase = "committing", current_pr = "<id>"`
2. Update STATE.md: PR `<id>` status = `APPROVED_NOT_COMMITTED`
3. `cd <agent's worktree path>` (each agent worked in its own isolated worktree from Phase 3)
4. Run final pre-commit verification (lane-appropriate typecheck / lint)
5. Invoke commit workflow:

<!-- ADAPTER:commit-workflow:start -->
   - Push: `git push -u origin <branch>`
   - Open PR: `gh pr create --base preview --title "<msg>" --body "<from agent report>"`
   - Capture PR URL
<!-- ADAPTER:commit-workflow:end -->

6. **On success:**
   - Capture PR URL + commit SHA
   - Update STATE.md: PR `<id>` status = `MERGED` (with run number, commit SHA, PR URL)
   - Continue to next PR in the loop
7. **On failure — classify before deciding what to do next:**
   - Capture failure output (lint, test, push reject, auth error, network error, etc.)
   - **Classify as systemic or PR-specific:**
     - **Systemic** = the failure cause will affect ALL remaining PRs identically: GitHub auth expired, network unreachable, commit skill broken, repo-wide lint config rejected, write permission denied, base branch protection misconfigured
     - **PR-specific** = the failure is local to this PR: this PR's tests failed, this PR's lint failed, this PR's diff conflicts
   - **If systemic:** STOP the loop immediately. Mark THIS PR as `PREVIEW_FAILED` with the systemic-failure reason. Mark each REMAINING approved PR as `APPROVED_NOT_COMMITTED` (they never tried commit). Surface the systemic problem to user.
   - **If PR-specific:** mark just this PR `PREVIEW_FAILED` with failure summary. Continue the loop with the next PR.

### After the loop

Survey the outcomes:

- **All MERGED / PR_CREATED:** ideal path. Proceed to Phase 5.5.
- **Mix of PR_CREATED and PREVIEW_FAILED:** acceptable partial success. Proceed with both states reflected.
- **All PREVIEW_FAILED:** something systemic wrong. Don't proceed — surface to user, mark all as PREVIEW_FAILED in STATE.md, leave worktrees intact for investigation.

## Phase 5.5 — Auto-merge (integration)

Update lock: `phase = "merging_prs"`.

### Auto-merge eligibility (the 5-criteria contract)

A PR auto-merges to `preview` if and only if ALL of these hold:

1. **Formal judge ran.** Phase 4 spawned the configured judge (lane-sharded mode) — not skipped, not Path-2 self-verify.
2. **Judge returned APPROVED.** Not `NEEDS-FIXES`, not `BLOCKED`.
3. **If a fix-pass happened, the re-judge after fix also returned APPROVED.** Skipping re-judge after a fix breaks the contract — that PR stays OPEN.
4. **GitHub reports `MERGEABLE` (or `UNSTABLE` due only to non-blocking CI).** Blocking failures → no merge. Verify via `gh pr view <URL> --json mergeable,mergeStateStatus,statusCheckRollup`.
5. **Agent did NOT flag `human-review-required`** in their structured report.

**Always-skip auto-merge (regardless of criteria above):**

- `A.NNN.X` audit-finding PRs — they exist precisely because the judge missed something
- PRs in a batch with a sibling that had a *systemic* PR-create failure (don't compound a degraded state)
- PRs touching production-critical paths (payment, auth, schema migration with rollback risk, tenant isolation)
- Runs explicitly launched with `no-merge`

Mark excluded PRs `REQUIRES_HUMAN_MERGE` and document the exclusion reason in the checkpoint. A PR that fails any criterion stays `PR_CREATED` and OPEN for human review.

### Per-PR auto-merge sequence

**Sequential, not parallel.** Within a single run, auto-merge calls run sequentially to avoid CONFLICTING races between sibling PRs that touch shared files. The first merges clean; subsequent rebase+merge if no conflict. If a conflict surfaces, that PR stays OPEN (per design — see Failure handling below).

For each eligible PR in dependency order:

```powershell
# 1. Verify mergeability immediately before merge (state may have changed since judge ran)
gh pr view <URL> --json mergeable,mergeStateStatus,statusCheckRollup

# 2. If still eligible, squash-merge with branch deletion
gh pr merge <URL> --squash --delete-branch

# 3. Confirm + capture merge commit
gh pr view <URL> --json state,mergeCommit

# 4. Update STATE.md row: PR_CREATED → MERGED with merge commit SHA
```

Use `--admin` flag only if branch protection requires a bypass; surface to user if needed (suggests protection rules need adjustment).

### Failure handling

- **`CONFLICTING`** (rebase storm with prior auto-merge this run): log; leave OPEN; flag for next-run rebase retry. Common when multiple PRs in this run touch shared-file hotspots flagged by Phase 2's conflict matrix.
- **Branch protection rejects merge**: log full output; leave OPEN; surface to user (likely requires `--admin` or rule adjustment).
- **Network / GitHub API failure**: same as Phase 5 systemic failure handling — leave PRs OPEN; surface to user; next-run resumes from Phase 5.5 retry.

Status transitions: `PR_CREATED` → `MERGED` (success) or stays `PR_CREATED` with documented exclusion reason (failure).

### Phase 5.6 — Re-sync local main after merges

After auto-merges land:

```powershell
git fetch
git pull --ff-only
```

So the next run's Phase 3.0 is a clean fast-forward.

## Phase 6 — Write checkpoint + update state + self-verify

Update lock: `phase = "verifying"`.

**Event-sourced state mode:** append events to `flywheel-events.jsonl` first (PR_APPROVED, PR_CREATED, PR_MERGED, RUN_COMPLETE), each with `event_id`, `run`, `type`, `pr_id`, `timestamp`, `actor`, `skill_version`, `judge_version`, `model`, `idempotency_key`. Then regenerate STATE.md / run-log.md / quality-log.md as views from the event stream.

Write three artifacts in order:

1. **`C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/checkpoints/run-NNN-YYYY-MM-DD.md`** — using `C:/Users/stone/Code/sagemark/.claude/skills/seo-creator-build/checkpoint-template.md`. Include: run #, date, duration, goal, concurrent agents (one row each), per-PR outcomes, quality verdict verbatim, commit SHAs + PR URLs, state-after summary, process improvements.

2. **`C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/STATE.md`** updated to reflect the new state:
   - Move newly-merged PRs from "in flight" → "merged" list (PR map status: `MERGED` with run number)
   - Recompute "next up" list (PRs whose deps are now satisfied)
   - Update phase-progress count
   - Add new "recent learnings" entries (max 5 most recent)
   - Partial-batch: BLOCKED PRs keep status `BLOCKED` + one-line note + worktree path
   - PREVIEW_FAILED PRs keep status + worktree path so next run skips engineering + judge and goes straight to commit retry

3. **`C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/run-log.md`** — append 1-screen run summary
4. **`C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/quality-log.md`** — append one row (process score, product score, top issue, top improvement)

5. **Drift-control artifacts:**
   - **`C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/anchors.json`** — for every anchor sub-page that any PR in this run referenced, refresh its `current_hash` via `git hash-object <path>` + bump `last_updated_run` + `last_updated_at`
   - **Decision records.** For each judge-flagged DR-NEEDED item in this run's verdict, spawn one quick DR-drafter sub-agent (subagent_type: `general-purpose`, NOT worktree-isolated — single-shot draft) per item. Each writes `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/decisions/DR-NNN-slug.md` from `C:/Users/stone/Code/sagemark/.claude/skills/seo-creator-build/decision-record-template.md` using the judge's flagged reason + the PR's engineering report. User reviews + commits before the next work-doing run.
   - **Trend signals.** Compute the 5-run rolling trends (judge slope, BLOCKED rate, re-judge rate) and write back into STATE.md's drift-watch-trend table so Phase 1.7 of the next run reads from a fresh state.

### Self-verification gate

Before releasing the lock and reporting to the user, **the orchestrator self-verifies state consistency**:

- [ ] Every PR marked `MERGED` in STATE.md has a corresponding commit SHA + PR URL captured during Phase 5
- [ ] Every PR marked `MERGED` is **actually merged on GitHub** — verify via `gh pr view <URL> --json state,mergedAt,mergeCommit` and check `state == "MERGED"`. **Do NOT use `git log --grep`** (weak — can match unrelated commits)
- [ ] Every `PR_CREATED` PR is verified open via `gh pr view <URL> --json state` returning `OPEN`
- [ ] Every `BLOCKED` PR has a one-line note + worktree path
- [ ] Every `PREVIEW_FAILED` PR has a worktree path recorded
- [ ] Quality-log row matches the judge's verdict
- [ ] Run-log entry's PR list matches the checkpoint's PR list
- [ ] PR status counts sum correctly
- [ ] No orphaned `IN_FLIGHT` entries
- [ ] Every state transition has an event with `skill_version`, `judge_version`, `model`, `idempotency_key`
- [ ] Regenerated STATE.md matches the event log AND verified GitHub reality
- [ ] `anchors.json` has fresh hashes for every anchor sub-page this run's PRs referenced
- [ ] Every judge "DR-NEEDED" item has a corresponding `decisions/DR-NNN-slug.md` file (or is explicitly queued for next run's Phase 1.7 review)
- [ ] STATE.md's "runs since last audit" counter incremented (or reset to 0 if this run was an audit run)
- [ ] `git status` is clean (no uncommitted state-file changes left behind)

**On any inconsistency:** do NOT release the lock. Surface the specific inconsistency, mark the run as `INCOMPLETE — state verification failed at Run #NNN`, and stop. The next run will see the lock + the unfinished checkpoint and recover.

### Rename IN_PROGRESS checkpoint to final

If self-verification passes:

1. Rename `checkpoints/run-NNN-IN_PROGRESS.md` → `run-NNN-YYYY-MM-DD.md`
2. Append the final run summary to the checkpoint (commit hashes, PR URLs, judge verbatim, self-verification ✅)


## Phase 6.5 — Land orchestrator state to `origin/preview` via single-PR flow

**Why this phase exists.** Phase 5.5 auto-merges *engineering* PRs that pass a *formal judge*. Orchestrator-owned files (STATE.md, run-log.md, quality-log.md, anchors.json, checkpoints/, decisions/, audits/) are never engineering work, never pass through a judge, and therefore have no entry into Phase 5.5's flow. Without an explicit landing step, those files commit to the orchestrator's branch and get stranded — every sibling worktree's rebase sees stale state and the flywheel's drift watch operates on stale data.

### Phase 6.5a — Stage the orchestrator-state commit

By the end of Phase 6, the orchestrator has written/modified some subset of:

- `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/STATE.md` (always)
- `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/run-log.md` (always)
- `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/quality-log.md` (always)
- `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/checkpoints/run-NNN-YYYY-MM-DD.md` (always)
- `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/anchors.json` (when anchor sub-pages referenced)
- `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/decisions/DR-NNN-*.md` (when judge-flagged DR-NEEDED items)
- `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/audits/audit-NNN-YYYY-MM-DD.md` (audit runs only)

Stage and commit these on the orchestrator's branch:

```powershell
git add C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/
git commit -m "build: Run #NNN — orchestrator state landing"
```

The commit message MUST start with `build:` so Phase 1.5b's prior-landing check can detect orchestrator-state commits via grep. Include in the body: the run number, what files were touched, and whether this is a work-doing or audit run.

### Phase 6.5b — Land via single-PR flow

**Always open a PR; never direct-push or force-push to base.** Direct-push risks clobbering base state if the orchestrator's branch diverged from base (which it inevitably will after engineering PRs landed via Phase 5.5). PR + auto-merge is safer, auditable, and recoverable.

```powershell
# Push the orchestrator branch
git push -u origin HEAD

# Open the orchestrator-state PR (touches only build_state_root paths)
gh pr create --base preview --head <orchestrator-branch> \
  --title "build: Run #NNN — orchestrator state landing" \
  --body "Orchestrator-owned state files from /seo-creator-build Run #NNN. No engineering changes, no judge required."
```

### Phase 6.5c — Auto-merge the state-landing PR

The orchestrator-state PR is **always auto-merge-eligible** because:

1. It contains ONLY orchestrator-owned files (verifiable via `gh pr view <URL> --json files`; every path must match `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/...`)
2. No engineering changes, no judge required (judges only evaluate code work)
3. By construction, it never conflicts with engineering PRs from this run (engineering PRs touch the lane write-scopes, never `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/`)

```powershell
gh pr merge <URL> --squash --delete-branch
gh pr view <URL> --json state,mergeCommit  # confirm MERGED
```

### Phase 6.5d — Self-verification

- [ ] Orchestrator-state PR `state == "MERGED"` with `mergeCommit.oid` set
- [ ] `git merge-base --is-ancestor <mergeCommit> origin/preview` returns YES
- [ ] On-disk STATE.md matches what the merged PR landed (sanity-check the contract)

### Phase 6.5e — Failure handling

- **Conflict against base** (rare by design): rebase the orchestrator branch onto `origin/preview` and retry. Append-only files (`quality-log.md`, `run-log.md`) usually concatenate cleanly; `STATE.md` is overwrite-only — the orchestrator's version IS the source of truth.
- **Branch protection rejects merge:** surface to user; orchestrator-state PRs should be exempt from "requires approval" rules (no engineering content).
- **Network / GitHub API failure:** mark run `INCOMPLETE — Phase 6.5 land-to-preview failed`. Do NOT delete the lock. Next run resumes from Phase 6.5 retry, skipping Phase 1-6 (engineering already shipped).


### Release the run lock

Delete `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/.run-lock.json`. The next `/seo-creator-build` invocation will see no lock and proceed normally.

## Phase 7 — Report to user

### Phase 7b — Brief end-of-turn message (4–6 lines max)

> Run #NNN complete. Merged PR `<id>` (<desc>) and PR `<id>` (<desc>) — PRs <#URL> and <#URL>.
> Process: N/5 (<one-sentence>).
> Product: N/5 (<one-sentence>).
> Next: PR `<id>` (<desc>) — eligible for run #N+1.
> Blockers: <none | list>.

### Phase 7c — Auto-loop continuation (only when this run was invoked with `auto`)

If `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/.auto-loop.json` exists with `active:true`, apply the **loop-back decision** (see "Autonomous loop + context management" above):

1. Recompute eligible work from the just-written `STATE.md`.
2. **Check the bounds — you MUST do this here.** In auto mode you loop Phase 7c→1 *without ending the turn*, and the Stop hook only fires when you actually try to end a turn. So between batches the hook is NOT running — **the in-loop bound is yours to enforce.** Read `.auto-loop.json` and STOP looping (go to step 3) if ANY of:
   - `iteration >= max_iterations` (max-loops reached), OR
   - `budget.max_wall_clock_hours` is set and `now − started_at` exceeds it (compute it; do not eyeball), OR
   - a hard-stop condition tripped (BLOCKED / REQUIRES_HUMAN_MERGE / self-verify inconsistency / abort), OR
   - no eligible work remains.
3. **Continue** (only if none of the above): bump `iteration` in `.auto-loop.json`, rewrite `RESUME.md` ("looping to run #N+1 — next batch: <ids>"), then **go back to Phase 1** and run the next batch now. (Do NOT end the turn. If context is tight, just continue — a compaction will fire and the hooks will bring you back here; that is expected and safe.) The Stop hook re-checks all of these independently as a backstop for the post-compaction case — but it is a backstop, not the in-loop guard.
4. **To stop the loop** (when step 2 says so): set `.auto-loop.json` `active:false` + `terminal_reason` (do NOT delete it — deletion races with PreCompact and can resurrect the loop). Make the Phase 7b message reflect the terminal reason — one of: *all eligible work depleted* · *max-loops (8) reached* · *budget ceiling* · *stalled (no progress)* · *hard-stop: <blocked PR / human-merge / inconsistency / abort>*. On a hard-stop, surface exactly what's stuck and how to unstick it.

When the loop is NOT active (a normal single-batch invocation), ignore this phase — exit after 7b as usual.

## Session persistence (running out of context)

If you sense context running tight mid-run:

1. **Don't start new agents** — finish what's in flight only
2. **Update STATE.md NOW** with whatever's done — partial wins matter
3. **If a PR is partial:** mark it `INTERRUPTED` in STATE.md with a note about what's missing
4. **If commit not yet done:** explicitly note the commit is pending; the next run will commit-then-continue
5. **Tell the user the session is ending and the next run will resume from STATE.md**

If a run is interrupted by anything (network failure, user Ctrl+C):
- The last STATE.md write is the recovery point
- Next `/seo-creator-build` invocation reads STATE.md and resumes correctly

**In `auto` mode this is different — context running tight is EXPECTED, not a reason to end.** Keep `STATE.md` and `RESUME.md` current at every phase (you already do), then just keep working. Claude Code will auto-compact when it needs to; the Stop / SessionStart hooks + CLAUDE.md Compact Instructions will bring the next turn right back here pointed at `RESUME.md`. Do NOT announce "the session is ending" or stop early in auto mode — only stop on the Phase 7c terminal conditions (work depleted, max-loops, budget, or a hard-stop). The whole point is that the loop survives compaction without your intervention.

## Anti-patterns

- ❌ **Skipping the judge phase to save time.** The judge is the quality floor. Always run.
- ❌ **Committing without the configured workflow.** Project convention.
- ❌ **Silently failing if a test fails.** Surface to user explicitly.
- ❌ **Modifying the plan or spec without user approval.** If a spec is wrong or unclear, FLAG IT — don't fix it silently.
- ❌ **Mixing engineering and non-engineering deliverables in one run.** Surface non-engineering items as blockers, don't try to do them.
- ❌ **Cross-phase work in one run.** Phase boundaries exist for trust gates.
- ❌ **Letting agents touch `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/` files.** Orchestrator-only. Judge enforces.
- ❌ **Letting any PR give the autonomous agent a direct publish tool — publish is host-only behind canPublish().**
- ❌ **Re-implementing the gate / scorers / FSM / persistence in the worker or in markdown instead of driving the /content/api kernel routes (markdown drift).**
- ❌ **Collapsing the drafter != verifier faithfulness invariant to "save a model".**
- ❌ **Letting a client sign-off populate the credentialed reviewer byline or satisfy a YMYL release.**
- ❌ **Grounding a medical/statistical YMYL claim on a client attributionSource alone.**
- ❌ **Auto-merging an A.NNN.X audit-finding PR (they exist because the judge missed something).**

## When the current phase is complete

When STATE.md shows all PRs in the current phase as `MERGED` and all non-engineering deliverables checked:

1. Do NOT auto-start the next phase
2. Update STATE.md: `Phase X complete. Awaiting user kickoff for Phase Y.`
3. Surface to user with a phase-completion summary
4. **Force a `/seo-creator-build audit` before declaring complete** — all critical findings must be resolved or explicitly deferred-to-next-phase as risks
   5. Wait for explicit user direction before proceeding

This is a trust gate — phase boundaries are where the human re-engages to verify direction before another N weeks of work commits to a path.

## When in doubt

Stop. Report state. Ask user. The flywheel only works if state stays honest — never paper over a problem to keep the cadence going.

## Reference orchestrators (do NOT copy code from these — read for shape only)

- Emma (4-cap, origin): `nextschool/.claude/skills/emma-build.md`
- VideoGen (4-cap, 7-lane): `flywheel-main/.claude/skills/videogen-build.md`
- AgeWise (floodgate + drift): `agewise/.claude/skills/agewise-build.md`
- Jarvis (floodgate-at-scale): `Jarvis/.claude/skills/jarvis-build.md`

This skill was compiled from `learnings/build-flywheel-blueprint/` v1.0 on 2026-06-25T17:30:00-04:00 by `build-flywheel` skill v1.0.0. Manifest of all compile decisions: `C:\Users\stone\Code\sagemark/build-flywheel-manifest.json`.
