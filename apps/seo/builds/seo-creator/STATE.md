# SEO Creator Build — Current State

**Last updated:** 2026-06-26 (post-Run #009 — P0.W.3 #19 + P0.W.4 #20 MERGED; worker capability-denial profile + SSE transport live on preview)
**Current build phase:** Phase 0 — Foundations
**Phase progress:** 8 / 23 engineering PRs merged (P0.E.1–4, P0.S.1, P0.W.2 #17, **P0.W.3 #19, P0.W.4 #20**) (+2 correctives C.004.1, C.008.1) · +1 spike (P0.W.1) · 4 audit fixes MERGED (#13–#16)
**Runs since last audit:** 4 (audit due before Run #011 — one more work-doing run is fine)
**Loop status:** **P0.W.3 + P0.W.4 MERGED** (Run #009, auto). Worker capability-denial profile (#19 `69650e4`) + worker↔apps/seo SSE transport with per-run bridge JWT (#20 `96da4ef`) are on preview; both judge-APPROVED 4/5·4/5, CI green, user-approved auto-merge. **P0.W.5 (PR 008) now dep-eligible** (PR 007 met). Bridge-token end-to-end enforcement deferred to a corrective ([[DR-018]]). DR-013 metering policy still DECIDED (Gateway-only). Auto-loop CONTINUING → Run #010.

## Currently in flight

_(none — Run #009 complete; P0.W.3 #19 + P0.W.4 #20 merged. Run-lock released at end of Phase 6.5; auto-loop active, looping to Run #010.)_

## Active items (human / deployment)

- **Deploy Stage A — DONE.** `apps/seo` host is live in production at **https://sagemark-seo.vercel.app** (Vercel project `digital-seniority/sagemark-seo`, `prj_wd0r52t`, rootDirectory=apps/seo, monorepo build green). `/api/health` 200; `/content/api/*` live (400 on empty body). `SUPABASE_SERVICE_ROLE_KEY` set (user); Vercel Deployment Protection DISABLED (user-approved); Gateway via OIDC. This is the worker's host-tool bridge URL.
- **Deploy Stage B/C — REMAINING (P0.W.2 live Tier-2/3).** Build the worker `Dockerfile` → Sandbox (snapshot, or the base-`node24` fallback path), provision it pointed at `sagemark-seo.vercel.app` with a per-run **bridge JWT** + the Gateway base URL, drive a real brief → assert serpFetch→runGate→persistPiece writes to Sagemark → teardown → state reloads, + the recycle/residue test. **Still needs:** the bridge-JWT signing secret configured on BOTH host + worker (new shared secret), the worker Gateway credential, and the Sandbox wiring. The Vercel token (Sandbox provisioning) is available.
- **DR-013 enforcement corrective (before PR 020 / the D4 ledger):** make the gate calls Gateway-only (force-Gateway resolution) + a CI assertion that the gate path can't resolve a raw-Anthropic provider. Decision recorded in [[DR-013]]; implementation queued (Medium).
- **Stale worktrees:** several merged-PR worktrees under `.claude/worktrees/` can be pruned (kaishi / `git worktree prune`).

## Next up (P0.W.3 + P0.W.4 merged)

- **P0.W.5** (PR 008 — wire `seo-blog-writer` suite skill into the worker (single-drafter slice) + golden-set regression harness) — dep **PR 007 ✓ (merged this run)**. NOW ELIGIBLE → Run #010's batch. Loads the real `SKILL.md` driving `/content/api/draft`; checks in the human-labeled golden corpus; the methodology-fidelity tripwire.
- **P0.S.2** (PR 009 — voice-spec hard stop + fail-closed publish endpoint) — schema-tenancy; RFC line 480 deps **PR 008** (+ PR 004 ✓). Eligible after P0.W.5 merges. (NOTE: STATE previously hinted P0.S.2 might be worker-independent; the engineering-rfc.md anchor explicitly lists PR 008 — DAG respected.)
- **DR-018 corrective:** wire `verifyBridgeToken` into the four `/content/api/*` kernel routes + an integration test that fails CI until every host tool invokes it — release gate before the worker goes near a live tenant. Can fold into P0.W.5 or a C.009.x.
- **Mediums (A.012.x):** core barrel `server-only` split, passive-voice regex drift, schema-flywheel in-package tests, console.* logging, dual route namespace — opportunistic.

## Blocked / awaiting input

_(none currently blocking — the P0.W.1 architecture gate is resolved.)_

- **PR P0.W.1 (PR 000 — capability-denial spike)** — **MERGED** at PR #3 (squash `54731a1`, 2026-06-25). Live Vercel Sandbox adversarial run CONFIRMED 4/4 PASS under the hardened profile; the two initial FAILs (egress MMDS, fs unconstrained shell) were remediated in-tree and re-verified. Decisions: **DR-010** (egress = networkPolicy + in-VM MMDS `iptables` block), **DR-011** (no-shell worker + workdir-scoped file tool).
  - **Worker-lane consequence:** **P0.W.2 (worker host) is now reachable** and must implement the hardened profile (DR-010 + DR-011); the spike's `_harness.ts` carries the reference `hardenSandbox` / `readViaWorkdirTool` / boot-refusal contract. P0.W.3/W.4/W.5/P0.S.2/P1.W.1 follow.
  - **Audit gate:** STATE flags an audit is due (4 runs since last; threshold 5) — the orchestrator runs it before the next work-doing run (P0.W.2).

## Audit-001 findings — disposition (all reachable ones now fixed; await human merge)

- **[Critical] A.005.1 anon tenancy-map leak** → **PR #13** (content_clients RLS, judge 5/5·5/5). **MERGED** (user-approved).
- **[High] A.005.2 governance spec contradiction** → **PR #14** (reconcile to D5/D9, judge 4/5·4/5). **MERGED** (user-approved). **Merge before P0.W.2.**
- **[High] A.005.3 model spend escapes the Gateway** → **PR #15** (gates via `resolveGatewayModel`, judge 5/5·5/5; [[DR-013]]). **MERGED** (user-approved). ⚠️ open policy: host-context BYOK can bypass metering — decide Gateway-only-for-gates before the D4 ledger (PR 020).
- **[High] A.005.4 no CI runs tests** → **PR #16** (GitHub Actions: typecheck/lint/test/build + node:test RLS + worker-env-lint, judge 4/5·5/5; [[DR-014]]). **MERGED** (user-approved).
- **[CLOSED] A.005.5 RLS behaviorally unproven** → `DATABASE_URL` secret set (Sagemark) + the C.008.1 anon-`SET ROLE` fix (#18); CI RLS Tier-2 now runs **17/17 green** against the live DB (anon=published-only + zero on internal tables, cross-tenant, FK, CHECK all pass). Behavioral tenant isolation is proven in CI.
- **Process (done):** event-log reconciled; judge `source-consumed-integration-build` check applied (`060b6b1`) — it gated A.005.1 + A.005.3.
- **Mediums (logged, not yet built):** core barrel re-exports `server-only` (A.012.1), passive-voice regex drift (A.012.2), schema-flywheel in-package tests / dual runner, console.* logging, dual route namespace. Pick up opportunistically.

## Recent learnings (last 5)

-1. **Worker streaming + confinement landed (Run #009, PRs #19/#20).** The capability-denial profile is now a named module (`apps/seo/src/worker/capability-profile.ts`) that `sandbox-launch.ts` applies-and-proves with fail-closed boot; the SSE transport (`/api/run` → `sse-relay`) mints a per-run bridge JWT scoped to (workspace,client,run) and resumes from a PERSISTED truth snapshot on reconnect (never worker memory). Two seams to close: (a) [[DR-018]] — `verifyBridgeToken` exists + is tested but the PR-005 `/content/api/*` routes don't call it yet (worker→host bridge auth is convention-only until wired; release gate before a live tenant); (b) the W.3 `modelToolAllowlist` boot-refusal path isn't exercised through `launchSandbox`, and `agent-worker.ts` hardcodes the tool literals instead of importing `WORKER_ALLOWED_TOOLS` (the "no-drift" claim is paper-only). Both logged for a hardening pass. [[DR-019]]: a PR adding a new test dir may append-only to `vitest.config.ts` `include`.
0. **P0.W.2 worker host built (Run #008, PR #17)** — the spike's proven controls (`hardenSandbox`/`networkPolicy`/`readViaWorkdirTool`/`assertControlsOrRefuse`) are now REAL in `apps/seo/src/worker/sandbox-launch.ts`; fail-closed boot, no-publish-tool model surface (`tools:[]` + 2-item allowlist), frozen per-run tenancy binding, host-side `session-store` (worker has no Supabase creds), worker model traffic via the Agent-SDK CLI env seam not `resolveGatewayModel` ([[DR-016]]), host lease-reclaim watchdog deferred ([[DR-017]]). 0034_worker_sessions migration added (needs applying to Sagemark). Tier-2/3 = live-Sandbox NEEDS-INPUT.
0a. **Supabase project = Sagemark/`rilaycjkksfosnxvenzt` (2026-06-26)** [[DR-015]], redirected from DSN (now orphaned). It's in a DIFFERENT org (`dbukahlorzsipthfpwda`) — the MCP token was re-scoped to reach it. `0030`–`0033` applied; RLS verified behaviorally as anon. Public conn vars (`NEXT_PUBLIC_SUPABASE_URL`/publishable key/`SUPABASE_PROJECT_REF`) wired in `.claude/settings.local.json`; service-role + `DATABASE_URL` are human/CI secrets (point the CI `DATABASE_URL` secret at THIS project). The pre-existing `rls_auto_enable()` event trigger had anon/authenticated EXECUTE revoked. Future migrations apply here. Supersedes the old "No Supabase wired" + DSN notes.
0b. **Audit-001 (Run #005): the moat is solid; the gaps are at the edges.** Deterministic kernel + host-side enforcement + tests are spec-faithful (zero hollow tests). Real risks: anon-RLS on `content_clients`, the Approach-B/D5-D9 spec contradiction, gates bypassing the metered Gateway, and NO CI executing any test. See [[audit-001]] + Active risks above.
1. **P0.W.1 gate CONFIRMED via live run + remediation (2026-06-25).** Vercel Sandbox is a viable worker runtime *with a hardened profile*: (a) egress = SDK `networkPolicy` allowlist + in-VM `iptables` DROP on `169.254.0.0/16` (the Firecracker MMDS is hypervisor-local and token-gated — the egress policy can't refuse it; the iptables block can) [[DR-010]]; (b) fs = **no-shell worker** + a workdir-scoped file tool — a VM shell jail is unachievable (non-root run, permissive image, no chroot), so the control lives at the tool layer [[DR-011]]. All 4 probes PASS. The `vercel-sandbox` run user is uid 1000 but can `sudo` and the base image is permissive. PR 006 must build this profile.
1. **Port sources live in `C:/Users/stone/Code/flywheel-main/`** (DR-001), not in sagemark. RFC `apps/trailhead`/`apps/agents` paths are relative to that sibling repo (read-only). Agents read them by absolute path.
2. **Spike PRs that need real infra** can't complete unattended — deliver the artifact + an honest Tier-3 NEEDS-INPUT, hold the PR open, gate the dependent host PR. Don't fabricate verdicts.
3. **`auth.ts` is a no-op placeholder seam** (DR-003) until a schema-tenancy PR fills it — studio surfaces are NOT actually access-controlled yet.
4. **`@sagemark/core` is source-consumed** (DR-004); `build = tsc --noEmit`; the turbo "no output files" warning is expected.
5. **AC#3 (worker-env CI lint "fails the build") is half-delivered** — the lint function exists + is unit-tested, but no CI/turbo step invokes it (no CI harness in the repo yet). Deferred to the worker-runtime lane / a CI-bootstrap PR. (escalation — see checkpoint)

## Files most recently touched

- `apps/seo/src/worker/capability-profile.ts` (NEW) + `sandbox-launch.ts` (apply-and-prove profile) + `test/worker/{capability-denial,egress-allowlist}.test.ts` (P0.W.3 / PR #19)
- `apps/seo/src/app/api/run/route.ts` + `src/lib/stream/{sse-relay,event-taxonomy}.ts` + `src/worker/emit.ts` + `test/stream/sse-relay.test.ts` + `vitest.config.ts` (P0.W.4 / PR #20)
- `apps/seo/src/worker/{agent-worker,sandbox-launch,host-tool-bridge,session-store,entry}.ts` + `Dockerfile` (P0.W.2 / PR #17)
- `packages/schema-flywheel/drizzle/0034_worker_sessions.sql` + drizzle schema
- `packages/core/src/gates/{faithfulness,voice}-gate.ts` (PR #15 — Gateway seam)
- `.github/workflows/ci.yml` (PR #16 — CI bootstrap)
- `apps/seo/test/tenancy/rls-contract.test.ts` (C.008.1 — in-band SET ROLE anon fix)

## Phase 0 — Foundations PR map

| ID | Title | Lane | Status | Run merged | Commit | PR |
|---|---|---|---|---|---|---|
| P0.W.1 | PR 000 — Phase-0 spike: prove Sandbox + Agent-SDK capability-denial is enforceable (architecture gate) | worker-runtime | **MERGED** (live run CONFIRMED 4/4 PASS, hardened profile) | post-#004 | 54731a1 | [#3](https://github.com/digital-seniority/sagemark/pull/3) |
| P0.E.1 | PR 001 — Scaffold apps/seo + port the provider seam into @sagemark/core | engine-port | MERGED | 1 | ec13f1c | [#2](https://github.com/digital-seniority/sagemark/pull/2) |
| P0.E.2 | PR 002 — Port the scorer library + faithfulness/voice gates into @sagemark/core | engine-port | MERGED | 2 | a74a1c7 | [#5](https://github.com/digital-seniority/sagemark/pull/5) |
| P0.E.3 | PR 003 — Port seo-gate + lifecycle-fsm + failure-codes into @sagemark/core | engine-port | MERGED | 3 | d44d7e9 | [#8](https://github.com/digital-seniority/sagemark/pull/8) |
| P0.S.1 | PR 004 — Supabase tenancy schema + release/signoff split + RLS + CI contract test | schema-tenancy | MERGED | 2 | 895507e | [#6](https://github.com/digital-seniority/sagemark/pull/6) |
| P0.E.4 | PR 005 — /content/api/{brief,draft,audit,publish} kernel route contract | engine-port | MERGED | 4 | ca776f0 | [#11](https://github.com/digital-seniority/sagemark/pull/11) |
| P0.W.2 | PR 006 — Agent-SDK worker on Vercel Sandbox (the autonomous loop host) | worker-runtime | **MERGED** (judge 5/5·4/5; live Tier-2/3 deferred to deploy) | Run #008 | 68ad820 | [#17](https://github.com/digital-seniority/sagemark/pull/17) |
| P0.W.3 | PR 006b — Worker runtime capability-denial profile + adversarial confinement tests | worker-runtime | **MERGED** (judge 4/5·4/5; Tier-2/3 live-Sandbox deferred) | Run #009 | 69650e4 | [#19](https://github.com/digital-seniority/sagemark/pull/19) |
| P0.W.4 | PR 007 — Worker <-> apps/seo SSE transport (the streaming hop) | worker-runtime | **MERGED** (judge 4/5·4/5; TENANCY PASS; AC6 wiring deferred [[DR-018]]) | Run #009 | 96da4ef | [#20](https://github.com/digital-seniority/sagemark/pull/20) |
| P0.W.5 | PR 008 — Wire the seo-blog-writer suite skill into the worker (single-drafter slice) + golden-set regression harness | worker-runtime | NOT_STARTED (now dep-eligible — PR 007 met) | — | — | — |
| P0.S.2 | PR 009 — Voice-spec hard stop + fail-closed publish endpoint (thinnest-slice close-out) | schema-tenancy | NOT_STARTED | — | — | — |

## Phase 1 — Pilot PR map

| ID | Title | Lane | Status | Run merged | Commit | PR |
|---|---|---|---|---|---|---|
| P1.U.1 | PR 010 — Three-zone agent canvas shell (reuse the existing apps/agents StudioCanvas) | agent-ui | NOT_STARTED | — | — | — |
| P1.U.2 | PR 011 — Live token streaming into the center editor + Inspector gate scorecard | agent-ui | NOT_STARTED | — | — | — |
| P1.U.3 | PR 012 — Conversational fine-tune: /api/edit bounded diff + full gate re-run + versioning | agent-ui | NOT_STARTED | — | — | — |
| P1.U.4 | PR 013 — Version hub: switch / name / compare + undeletable named sign-off | agent-ui | NOT_STARTED | — | — | — |
| P1.W.1 | PR 014 — Wire the remaining three suite skills into the worker (strategist / assistant / audit) — the full chain | worker-runtime | NOT_STARTED | — | — | — |
| P1.R.1 | PR 015 — Content-hub SSR render route + FAQ JSON-LD + placeholder stripping | render-geo | NOT_STARTED | — | — | — |
| P1.R.2 | PR 016 — CI reachability gate (sitemap == published-and-indexable set, both directions) | render-geo | NOT_STARTED | — | — | — |
| P1.R.3 | PR 017 — Generated resource-library homepage (D7) + imagegen hero resolution | render-geo | NOT_STARTED | — | — | — |
| P1.C.1 | PR 018 — Tokenized client-review preview + pinned comments + section verbs | client-review | NOT_STARTED | — | — | — |
| P1.C.2 | PR 019 — "Request changes" -> agent edit loop routing + named sign-off + approval-debt KPI | client-review | NOT_STARTED | — | — | — |
| P1.C.3 | PR 020 — Separate SEO cost ledger (AI Gateway) + share-of-model instrumentation | client-review | NOT_STARTED | — | — | — |
| P1.C.4 | PR 021 — Share-of-model citation-ingestion cron + freshness cron (the north-star feed) | client-review | NOT_STARTED | — | — | — |

## Drift-watch trend (5-run rolling)

| Run | Process | Product | BLOCKED rate | Re-judge rate |
|---|---|---|---|---|
| 001 | 4.5 | 4.0 | 0% | 0% |
| 002 | 5.0 | 4.5 | 0% | 0% |
| 003 | 5.0 | 4.0 | 0% | 0% |
| 004 | 5.0 | 4.75 | 0% | 0% |
| 005 | audit | audit | — | — |
| 006 | 4.5 | 4.5 | 0% | 0% |
| 007 | 4.5 | 5.0 | 0% | 0% |
| 008 | 5.0 | 4.0 | 0% | 0% |
| 009 | 4.0 | 4.0 | 0% | 0% |

## Status legend

- `NOT_STARTED` · `IN_FLIGHT` · `INTERRUPTED` · `APPROVED_NOT_COMMITTED` · `PR_CREATED` (open, awaiting merge) · `MERGED` · `PREVIEW_FAILED` · `BLOCKED` · `REQUIRES_HUMAN_MERGE`

---

*Run #009 complete · P0.W.3 [#19](https://github.com/digital-seniority/sagemark/pull/19) (69650e4) + P0.W.4 [#20](https://github.com/digital-seniority/sagemark/pull/20) (96da4ef) MERGED · judge 4/5·4/5 · CI green · worker capability-denial profile + SSE transport on preview · **P0.W.5 next** · auto-loop → Run #010*

> **Reachability note (post-Run #009):** P0.W.3 (#19) + P0.W.4 (#20) MERGED to preview (judge 4/5·4/5, CI green). Worker capability-denial profile + SSE transport + per-run bridge JWT now live on the integration trunk. **P0.W.5 (PR 008) is now dep-eligible** (PR 007 met) → the next batch; P0.S.2 (PR 009) follows P0.W.5 (RFC dep). Open seams: [[DR-018]] (wire `verifyBridgeToken` into the PR-005 kernel routes — release gate) + the W.3 boot-wiring/no-drift hardening. Stage B/C live-Sandbox Tier-2/3 still pending. Runs since last audit: 4 (audit due before Run #011 — one more work-doing run is fine). Next: auto-loop → Run #010 → P0.W.5.
