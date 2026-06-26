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
| 009 | 2026-06-26 | 2 | 4.0 | 4.0 | AC6 worker→host bridge auth not enforced end-to-end (verifier built, PR-005 routes don't call it yet — DR-018) | Surface cross-PR enforcement seams as DRs at plan time + add an integration test that fails CI until every host tool invokes verifyBridgeToken | checkpoints/run-009-2026-06-26.md |
| 010 | 2026-06-26 | 1 | 5.0 | 5.0 | (corrective — DR-018 bridge-auth seam closed; no issue) | Audit due before next work-doing run (5 runs since last); P0.W.5 needs the human-labeled golden corpus | checkpoints/run-010-2026-06-26.md |
| 011 | 2026-06-26 | 0 (audit) | audit | audit | audit-002: no Critical; A.011.1 allowlist single-source + A.011.2 RFC path the top Highs | Fold A.011.1/A.011.2/A.011.9 into P0.W.5; add the 2 structured judge checks | audits/audit-002-2026-06-26.md |
| 012 | 2026-06-26 | 1 | 5.0 | 5.0 | judge caught em-dash mask blinding the golden tripwire (fixed; honest all-veto baseline DR-024) | Any "normalize input before the gate" step in a characterization harness must auto-escalate to a DR | checkpoints/run-012-2026-06-26.md |
| 013 | 2026-06-26 | 1 | 5.0 | 5.0 | (none — fail-closed publish close-out; PHASE 0 COMPLETE) | Phase-close audit before Phase 1; PR 020 must wire gate_results + widen authorization projection | checkpoints/run-013-2026-06-26.md |
| 014 | 2026-06-26 | 0 (phase-close audit) | audit | audit | audit-003: no Critical/High; Phase-0 DoD PASS; CLEAR to Phase 1 | A.014.1 funnel-enum pre-PR017; build Slice-1 floor (P1.R.1) first; promote 3 structured judge checks | audits/audit-003-2026-06-26.md |
| 015 | 2026-06-26 | 2 | 5.0 | 5.0 | judge caught invalid-JSON <!-- escape in FAQ JSON-LD (fixed) | render route needs a "no client component in this public route" structural guard (body-in-HTML can't regress) | checkpoints/run-015-2026-06-26.md |
| 016 | 2026-06-26 | 2 | 5.0 | 5.0 | apps/seo has no DOM test runner (UI interaction untested, Tier-3) | UI lane: add jsdom/@testing-library or Playwright CT before PR 011 (live editor streaming) | checkpoints/run-016-2026-06-26.md |
| 017 | 2026-06-26 | 1 | 5.0 | 5.0 | (none — scorecard honesty + build-safety both PASS) | DR-028 subpath imports + DR-029 jsdom now standing UI-lane conventions | checkpoints/run-017-2026-06-26.md |
