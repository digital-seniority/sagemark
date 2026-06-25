# Checkpoint template

Per-run report. Written to `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/checkpoints/run-NNN-YYYY-MM-DD.md` at end of Phase 6 when self-verification passes. Written to `run-NNN-IN_PROGRESS.md` at end of Phase 2 (recovery anchor); renamed to final on success.

---

```markdown
# Run #NNN — YYYY-MM-DD

**Duration:** HH:MM (start) — HH:MM (end), N minutes
**Phase:** N (<phase name>)
**Branch / worktree:** <branch name>
**Trigger:** /seo-creator-build [args]
**Lock phases traversed:** preflight → agents_spawning → judging → committing → verifying

## Goal

<the run plan from Phase 2 of the skill, verbatim — what this run set out to accomplish>

## Concurrent agents spawned

| Lane | Agent task | Subagent type | Worktree | Returned |
|---|---|---|---|---|
| engine-port | PR <id> — <description> | general-purpose | <path> | COMPLETE / NEEDS-INPUT / BLOCKED |
| worker-runtime | PR <id> — <description> | general-purpose | <path> | COMPLETE / NEEDS-INPUT / BLOCKED |
| schema-tenancy | PR <id> — <description> | general-purpose | <path> | COMPLETE / NEEDS-INPUT / BLOCKED |
| agent-ui | PR <id> — <description> | general-purpose | <path> | COMPLETE / NEEDS-INPUT / BLOCKED |
| render-geo | PR <id> — <description> | general-purpose | <path> | COMPLETE / NEEDS-INPUT / BLOCKED |
| client-review | PR <id> — <description> | general-purpose | <path> | COMPLETE / NEEDS-INPUT / BLOCKED |
| Judge shard (engine-port) | Lane-scoped review | general-purpose | — | per-PR verdict |
| Judge shard (worker-runtime) | Lane-scoped review | general-purpose | — | per-PR verdict |
| Judge shard (schema-tenancy) | Lane-scoped review | general-purpose | — | per-PR verdict |
| Judge shard (agent-ui) | Lane-scoped review | general-purpose | — | per-PR verdict |
| Judge shard (render-geo) | Lane-scoped review | general-purpose | — | per-PR verdict |
| Judge shard (client-review) | Lane-scoped review | general-purpose | — | per-PR verdict |

## Per-PR outcomes

### PR <id> — <description>

**Spec:** prd.md §<section ref>
**Status:** MERGED | PARTIAL | INTERRUPTED | BLOCKED | PREVIEW_FAILED

**Files added:**
- <path>

**Files modified:**
- <path>

**Acceptance criteria:**
- ✅ <criterion 1> — <evidence>
- ✅ <criterion 2> — <evidence>
- ❌ <criterion 3> — <reason>; deferred to follow-up PR / run

**Tenant-scoping check:**
- Queries touched: <list with tenant_id / workspace_id filter; "n/a" if not applicable>

**Tests:**
- <Tier-1 test>: ✅ <evidence>
- <Tier-2 fallback>: <if used + why>
- <Tier-3 NEEDS-INPUT>: <if used + manual verification path>

**Deviations from spec:**
- <none | description with reason>

**Rollback plan (captured from agent report):**
- <commands / files to revert / migration to roll back>

**Commit:** <SHA> "<commit message>"
**PR:** <URL>
**Worktree:** <path> (preserved if BLOCKED / PREVIEW_FAILED; deleted on MERGED)

(Repeat for each PR in the batch)

## Quality check (judge verdict)

### Lane: <lane-name>

(Paste the lane's judge shard verdict verbatim)

(Repeat per lane / sub-shard)

### Aggregate (orchestrator-computed)

- **PROCESS SCORE:** N/5 (weighted by PR count across shards)
- **PRODUCT SCORE:** N/5 (weighted by PR count across shards)
- **Top improvements:** <deduped union from all shards>
- **Escalations:** <union from all shards>

## Outcomes

| Metric | Value |
|---|---|
| PRs merged | N |
| PRs PR_CREATED (auto-merge pending) | N |
| PRs partial / interrupted | N |
| PRs blocked | N |
| PRs preview-failed | N |
| Process score (judge) | N/5 |
| Product score (judge) | N/5 |
| Total token spend | $X.XX (if tracked) |
| Total run time | HH:MM |

## State after this run

**Phase X progress:** Y/Z engineering PRs MERGED (was W/Z before this run)

**New entries to "next up":**
- PR <id> (now eligible, dependencies satisfied)

**New blockers:**
- <none | description>

## Process improvements for next run

(From judge agent's "Top improvements" + your own observation)

1. <specific actionable improvement>
2. <specific actionable improvement>

## Escalations to user

(Anything requiring human decision before next run)

- <escalation> — <what user needs to decide>

## Drift watch (this run)

- Anchor hashes: <unchanged | drifted (list)>
- Trend signal: <green | recommend-audit (reason)>
- State sanity: <ok | mismatch (PR id)>
- Decisions captured: <complete | gap (judge flagged but no DR)>

## Self-verification

- [x] Every MERGED PR has commit SHA + PR URL
- [x] Every MERGED PR verified on GitHub via `gh pr view --json state`
- [x] Quality-log row matches judge verdict
- [x] Run-log entry matches checkpoint PR list
- [x] PR status counts sum correctly
- [x] Every state transition has an event with skill_version / judge_version / model / idempotency_key
- [x] Regenerated STATE.md matches event log + GitHub reality
- [x] `git status` clean; orchestrator state committed + pushed to `origin/preview`

## Notes / surprises

(Free-form — anything noteworthy that doesn't fit the structured sections)

---

*Auto-generated by /seo-creator-build · Run #NNN · YYYY-MM-DD HH:MM · skill version 1.0.0*
```
