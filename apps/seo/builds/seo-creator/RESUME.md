# RESUME cursor — autonomous audit+harden block

**Run:** #24 audit DONE → #25 harden · **phase:** harden · **updated:** 2026-06-27T04:11:31Z · **session:** d8b2ffa0-7c9b-4e83-beb5-6ed80422d749 · **budget:** 10h ceiling (hook-enforced)

## Context
v1 build COMPLETE. James-directed audit+harden block. audit-006 done (no Critical, go-live-ready). Phase 2/GA is OUT of scope (prd.md:714) — do NOT start it. Do NOT manufacture filler. Terminate honestly when A.006.x correctives are built.

## Cursor
- **DONE:** audit-006 (audits/audit-006-2026-06-27.md) + DR-040 + DR-041 + manifest check + STATE reconcile + events. Audit state landing = orchestrator PR (Run #24).
- **NOW (Run #25 harden):** build 4 correctives via floodgate worktree agents (disjoint files):
  - A.006.1 — wire recordCredentialedRelease into review→release route w/ pilot:isPilot() + unify defaultPublishEnabled. Files: apps/seo/src/app/content/api/publish/route.ts + the release/sign-off route + signoff.ts + test. **HOLD FOR HUMAN MERGE (production-critical/DR-037).**
  - A.006.2 — extend gate-path-lint to packages/core/src/ai/ (som-direct-runner forceGateway). Files: packages/core/src/gates/gate-path-lint.ts + ci.yml + test.
  - A.006.3 — cron route runtime/dynamic/maxDuration. Files: apps/seo/src/app/api/cron/{ingest-share-of-model,freshness-scan}/route.ts.
  - A.006.4 — docs: RFC §3.1 + PRD §3.4/§16 + 0039 comments + content.ts comment + live-adapter file headers (SoM hybrid channel; "wired creds-gated").
  - **ALL A.006.x NEVER auto-merge** — build → lane-sharded judge → open PRs → HOLD for human.
- **THEN:** state-land Run #25; set .auto-loop active:false terminal_reason "audit+harden complete; remainder human-gated/out-of-scope". Report.

## Next action
Land the Run #24 audit state PR, then spawn the 4 harden agents (worktree-isolated, floodgate).
