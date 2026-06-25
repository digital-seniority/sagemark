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
