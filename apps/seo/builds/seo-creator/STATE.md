# SEO Creator Build — Current State

**Last updated:** 2026-06-26 (Run #007 — A.005.3 + A.005.4 PRs created; 4 audit-finding PRs now await human merge)
**Current build phase:** Phase 0 — Foundations
**Phase progress:** 5 / 23 engineering PRs merged (+1 corrective C.004.1) · +6 spike (P0.W.1) · **+4 audit-finding PRs OPEN** (A.005.1 #13, A.005.2 #14, A.005.3 #15, A.005.4 #16)
**Runs since last audit:** 2 (audit-001 was Run #005 — threshold 5)
**Loop status:** P0.W.1 MERGED; Supabase = **Sagemark/`rilaycjkksfosnxvenzt`** (DR-015, redirected from DSN). Runs #006–#007 built all reachable audit fixes (A.005.1–.4) as **human-merge PRs #13–#16**. **HARD-STOP: P0.W.2 gated on a human merging #14** (worker-host spec must read the reconciled topology) + #13. The remaining audit item A.005.5 is reduced to "set the CI `DATABASE_URL` secret." `.auto-loop.json` `active:false`.

## Currently in flight

_(none — loop terminated **depleted** after Run #004; P0.W.1 gate since CONFIRMED out-of-loop via the manual live Sandbox run + remediation. Next action is human merge of PR #3, then resume.)_

## Next up (dependencies satisfied)

- **PR P0.W.2** (PR 006 — Agent-SDK worker on Vercel Sandbox, the autonomous loop host) — deps [P0.W.1 ✓ MERGED] — worker-runtime. **The next work-doing PR.** Must implement the hardened profile (DR-010 egress + DR-011 no-shell worker; reference impl in `apps/seo/spike/capability-enforcement/_harness.ts`). High-risk + production-critical → will be `REQUIRES_HUMAN_MERGE`. **Gate: resolve A.005.2 first** (the spec it would read still says "never self-host/Sandbox" — superseded by D5/D9).
- **Audit-finding PRs — Run #006 created 2 (OPEN, human-merge):**
  - **A.005.1 (Critical) — [PR #13](https://github.com/digital-seniority/sagemark/pull/13)** — `content_clients` RLS. Judge APPROVED 5/5·5/5. `PR_CREATED` / `REQUIRES_HUMAN_MERGE`.
  - **A.005.2 (High) — [PR #14](https://github.com/digital-seniority/sagemark/pull/14)** — reconcile Approach-B spec vs D5/D9. Judge APPROVED 4/5·4/5 (residual lines fixed). `PR_CREATED` / `REQUIRES_HUMAN_MERGE`. **Merge before P0.W.2.**
  - **Still queued (not yet built):** A.005.3 (High — route faithfulness/voice gates through the metered Gateway + DR), A.005.4 (High — CI: run tests + wire `node:test` RLS + worker-env-lint), A.005.5 (High — PG harness for Tier-2 RLS, fold into P0.S.2). See `audits/audit-001-2026-06-25.md`.

## Blocked / awaiting input

_(none currently blocking — the P0.W.1 architecture gate is resolved.)_

- **PR P0.W.1 (PR 000 — capability-denial spike)** — **MERGED** at PR #3 (squash `54731a1`, 2026-06-25). Live Vercel Sandbox adversarial run CONFIRMED 4/4 PASS under the hardened profile; the two initial FAILs (egress MMDS, fs unconstrained shell) were remediated in-tree and re-verified. Decisions: **DR-010** (egress = networkPolicy + in-VM MMDS `iptables` block), **DR-011** (no-shell worker + workdir-scoped file tool).
  - **Worker-lane consequence:** **P0.W.2 (worker host) is now reachable** and must implement the hardened profile (DR-010 + DR-011); the spike's `_harness.ts` carries the reference `hardenSandbox` / `readViaWorkdirTool` / boot-refusal contract. P0.W.3/W.4/W.5/P0.S.2/P1.W.1 follow.
  - **Audit gate:** STATE flags an audit is due (4 runs since last; threshold 5) — the orchestrator runs it before the next work-doing run (P0.W.2).

## Audit-001 findings — disposition (all reachable ones now fixed; await human merge)

- **[Critical] A.005.1 anon tenancy-map leak** → **PR #13** (content_clients RLS, judge 5/5·5/5). `PR_CREATED` / human-merge.
- **[High] A.005.2 governance spec contradiction** → **PR #14** (reconcile to D5/D9, judge 4/5·4/5). `PR_CREATED` / human-merge. **Merge before P0.W.2.**
- **[High] A.005.3 model spend escapes the Gateway** → **PR #15** (gates via `resolveGatewayModel`, judge 5/5·5/5; [[DR-013]]). `PR_CREATED` / human-merge. ⚠️ open policy: host-context BYOK can bypass metering — decide Gateway-only-for-gates before the D4 ledger (PR 020).
- **[High] A.005.4 no CI runs tests** → **PR #16** (GitHub Actions: typecheck/lint/test/build + node:test RLS + worker-env-lint, judge 4/5·5/5; [[DR-014]]). `PR_CREATED` / human-merge.
- **[High→nearly closed] A.005.5 RLS behaviorally unproven** → schema applied to **Sagemark/`rilaycjkksfosnxvenzt`** + RLS verified as anon ([[DR-015]]); CI Tier-2 wired in PR #16. **Remaining: a human sets the GitHub `DATABASE_URL` secret** (→ the Sagemark project) so Tier-2 runs in CI.
- **Process (done):** event-log reconciled; judge `source-consumed-integration-build` check applied (`060b6b1`) — it gated A.005.1 + A.005.3.
- **Mediums (logged, not yet built):** core barrel re-exports `server-only` (A.012.1), passive-voice regex drift (A.012.2), schema-flywheel in-package tests / dual runner, console.* logging, dual route namespace. Pick up opportunistically.

## Recent learnings (last 5)

0. **Supabase project = Sagemark/`rilaycjkksfosnxvenzt` (2026-06-26)** [[DR-015]], redirected from DSN (now orphaned). It's in a DIFFERENT org (`dbukahlorzsipthfpwda`) — the MCP token was re-scoped to reach it. `0030`–`0033` applied; RLS verified behaviorally as anon. Public conn vars (`NEXT_PUBLIC_SUPABASE_URL`/publishable key/`SUPABASE_PROJECT_REF`) wired in `.claude/settings.local.json`; service-role + `DATABASE_URL` are human/CI secrets (point the CI `DATABASE_URL` secret at THIS project). The pre-existing `rls_auto_enable()` event trigger had anon/authenticated EXECUTE revoked. Future migrations apply here. Supersedes the old "No Supabase wired" + DSN notes.
0b. **Audit-001 (Run #005): the moat is solid; the gaps are at the edges.** Deterministic kernel + host-side enforcement + tests are spec-faithful (zero hollow tests). Real risks: anon-RLS on `content_clients`, the Approach-B/D5-D9 spec contradiction, gates bypassing the metered Gateway, and NO CI executing any test. See [[audit-001]] + Active risks above.
1. **P0.W.1 gate CONFIRMED via live run + remediation (2026-06-25).** Vercel Sandbox is a viable worker runtime *with a hardened profile*: (a) egress = SDK `networkPolicy` allowlist + in-VM `iptables` DROP on `169.254.0.0/16` (the Firecracker MMDS is hypervisor-local and token-gated — the egress policy can't refuse it; the iptables block can) [[DR-010]]; (b) fs = **no-shell worker** + a workdir-scoped file tool — a VM shell jail is unachievable (non-root run, permissive image, no chroot), so the control lives at the tool layer [[DR-011]]. All 4 probes PASS. The `vercel-sandbox` run user is uid 1000 but can `sudo` and the base image is permissive. PR 006 must build this profile.
1. **Port sources live in `C:/Users/stone/Code/flywheel-main/`** (DR-001), not in sagemark. RFC `apps/trailhead`/`apps/agents` paths are relative to that sibling repo (read-only). Agents read them by absolute path.
2. **Spike PRs that need real infra** can't complete unattended — deliver the artifact + an honest Tier-3 NEEDS-INPUT, hold the PR open, gate the dependent host PR. Don't fabricate verdicts.
3. **`auth.ts` is a no-op placeholder seam** (DR-003) until a schema-tenancy PR fills it — studio surfaces are NOT actually access-controlled yet.
4. **`@sagemark/core` is source-consumed** (DR-004); `build = tsc --noEmit`; the turbo "no output files" warning is expected.
5. **AC#3 (worker-env CI lint "fails the build") is half-delivered** — the lint function exists + is unit-tested, but no CI/turbo step invokes it (no CI harness in the repo yet). Deferred to the worker-runtime lane / a CI-bootstrap PR. (escalation — see checkpoint)

## Files most recently touched

- `packages/core/src/ai/{resolve-gateway-model,cost-accountant,worker-env-lint}.ts` (+tests)
- `apps/seo/src/app/(studio)/page.tsx`, `apps/seo/src/lib/auth.ts`
- `apps/seo/spike/capability-enforcement/*` (spike, PR #3 open)
- `packages/core/{package.json,src/index.ts}`, `turbo.json`

## Phase 0 — Foundations PR map

| ID | Title | Lane | Status | Run merged | Commit | PR |
|---|---|---|---|---|---|---|
| P0.W.1 | PR 000 — Phase-0 spike: prove Sandbox + Agent-SDK capability-denial is enforceable (architecture gate) | worker-runtime | **MERGED** (live run CONFIRMED 4/4 PASS, hardened profile) | post-#004 | 54731a1 | [#3](https://github.com/digital-seniority/sagemark/pull/3) |
| P0.E.1 | PR 001 — Scaffold apps/seo + port the provider seam into @sagemark/core | engine-port | MERGED | 1 | ec13f1c | [#2](https://github.com/digital-seniority/sagemark/pull/2) |
| P0.E.2 | PR 002 — Port the scorer library + faithfulness/voice gates into @sagemark/core | engine-port | MERGED | 2 | a74a1c7 | [#5](https://github.com/digital-seniority/sagemark/pull/5) |
| P0.E.3 | PR 003 — Port seo-gate + lifecycle-fsm + failure-codes into @sagemark/core | engine-port | MERGED | 3 | d44d7e9 | [#8](https://github.com/digital-seniority/sagemark/pull/8) |
| P0.S.1 | PR 004 — Supabase tenancy schema + release/signoff split + RLS + CI contract test | schema-tenancy | MERGED | 2 | 895507e | [#6](https://github.com/digital-seniority/sagemark/pull/6) |
| P0.E.4 | PR 005 — /content/api/{brief,draft,audit,publish} kernel route contract | engine-port | MERGED | 4 | ca776f0 | [#11](https://github.com/digital-seniority/sagemark/pull/11) |
| P0.W.2 | PR 006 — Agent-SDK worker on Vercel Sandbox (the autonomous loop host) | worker-runtime | NOT_STARTED (GATED by P0.W.1 live run) | — | — | — |
| P0.W.3 | PR 006b — Worker runtime capability-denial profile + adversarial confinement tests | worker-runtime | NOT_STARTED | — | — | — |
| P0.W.4 | PR 007 — Worker <-> apps/seo SSE transport (the streaming hop) | worker-runtime | NOT_STARTED | — | — | — |
| P0.W.5 | PR 008 — Wire the seo-blog-writer suite skill into the worker (single-drafter slice) + golden-set regression harness | worker-runtime | NOT_STARTED | — | — | — |
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

## Status legend

- `NOT_STARTED` · `IN_FLIGHT` · `INTERRUPTED` · `APPROVED_NOT_COMMITTED` · `PR_CREATED` (open, awaiting merge) · `MERGED` · `PREVIEW_FAILED` · `BLOCKED` · `REQUIRES_HUMAN_MERGE`

---

*Run #007 complete · A.005.3 (#15, gates→Gateway) + A.005.4 (#16, CI) created — human-merge · judge 4.5/5.0 · all reachable audit fixes done (PRs #13–#16) · HARD-STOP: P0.W.2 gated on human merge of #14 (+#13)*

> **Reachability note:** P0.W.1 merged → worker lane open; Supabase = Sagemark/`rilaycjkksfosnxvenzt` (DR-015, redirected from DSN). Runs #006–#007 built every audit fix that didn't need the worker lane: A.005.1 (#13), A.005.2 (#14), A.005.3 (#15, DR-013), A.005.4 (#16, DR-014). **The loop is HARD-STOPPED on REQUIRES_HUMAN_MERGE — there is no autonomously-reachable engineering work left until a human acts:** (1) merge PRs #13–#16 (review the 4 audit fixes); (2) merging #14 (+#13) unblocks **P0.W.2** (worker host) as the next work-doing run; (3) set the GitHub `DATABASE_URL` secret so CI RLS Tier-2 runs (closes A.005.5); (4) decide the DR-013 host-context metering policy before the D4 ledger. Mediums (A.012.x) queue opportunistically.
