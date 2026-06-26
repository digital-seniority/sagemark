# SEO Creator Build — Quality log

Trend table. One row per run. Diagnostic for judge calibration and process drift.

Process score = "did the agent follow the spec, declare scope, run tests with named tier, include rollback, stay in lane?"
Product score = "is the work itself correct, secure, fit-for-purpose, free of obvious regressions?"

These can diverge. Watch for declining slopes across 3+ rows — that's the Layer 1 drift watch trigger.

---

| Run | Date | PRs merged | Process | Product | Top issue | Top improvement | Checkpoint |
|---|---|---:|---:|---:|---|---|---|
<!-- Rows appended by /seo-creator-build Phase 6. -->
| 001 | 2026-06-25 | 1 | 4.5 | 4.0 | P0.W.1 spike needs a live Vercel Sandbox run no unattended agent can perform (human-gated; gates PR 006) | When a criterion says "fails the build," wire it to a real build/CI step, not just a unit-tested function | checkpoints/run-001-2026-06-25.md |
| 002 | 2026-06-25 | 2 | 5.0 | 4.5 | compose.ts (P0.E.2) pre-empts PR 003's seo-gate composer — must be absorbed not forked (DR-005) | Commit a drizzle meta/ baseline + wire rls-contract as a non-skippable CI gate (DR-006) | checkpoints/run-002-2026-06-25.md |
| 003 | 2026-06-25 | 1 | 5.0 | 4.0 | ymylSignals is a ~22-term substring lexicon — YMYL false-negative risk; needs RFC:458 golden-set change-control (DR-007) | Ship a DR + change-control binding when a net-new safety detector has no source equivalent | checkpoints/run-003-2026-06-25.md |
| 004 | 2026-06-25 | 2 | 5.0 | 4.75 | apps/seo build was RED (core strict-vs-relaxed tsconfig mismatch from DR-004) — per-lane judges missed it by only building the package, not the consuming app | Judges must run the CONSUMING APP build for source-consumed pkg changes; orchestrator pnpm install after dep-changing merges (DR-008) | checkpoints/run-004-2026-06-25.md |
| 006 | 4.5 | 4.5 | A.005.2 had 2 residual stale-fact lines (fixed pre-PR) | Commit agent work in-worktree before judge (both agents left work uncommitted) |
| 007 | 4.5 | 5.0 | host-context gate calls can BYOK-bypass the Gateway (DR-013 open policy) | Negatively assert "no provider key read in gate path" + an in-CI negative worker-env-lint test |
| 008 | 5.0 | 4.0 | host lease-reclaim watchdog built-as-library, not yet wired (DR-017); §C17 via env seam (DR-016) | Mark host-orchestrator-spanning acceptance halves "unit-proven, e2e deferred"; file seam deviations as DR in-report |
