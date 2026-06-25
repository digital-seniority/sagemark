# SEO Creator Build — Current State

**Last updated:** 2026-06-25 (Run #005 — AUDIT complete; audit-001 written; P0.W.1 merged)
**Current build phase:** Phase 0 — Foundations
**Phase progress:** 5 / 23 engineering PRs merged (+1 corrective C.004.1) · +6 spike (P0.W.1)
**Runs since last audit:** 0 (audit-001 ran this run — threshold 5)
**Loop status:** P0.W.1 MERGED (#3, hardened profile CONFIRMED). Audit-001 done → audit gate cleared. **Next work-doing run = P0.W.2 (worker host)** — but resolve **A.005.2** (spec reconcile) BEFORE handing P0.W.2 to an agent so it reads the correct topology. `.auto-loop.json` still `active:false`; resuming runs the next batch.

## Currently in flight

_(none — loop terminated **depleted** after Run #004; P0.W.1 gate since CONFIRMED out-of-loop via the manual live Sandbox run + remediation. Next action is human merge of PR #3, then resume.)_

## Next up (dependencies satisfied)

- **PR P0.W.2** (PR 006 — Agent-SDK worker on Vercel Sandbox, the autonomous loop host) — deps [P0.W.1 ✓ MERGED] — worker-runtime. **The next work-doing PR.** Must implement the hardened profile (DR-010 egress + DR-011 no-shell worker; reference impl in `apps/seo/spike/capability-enforcement/_harness.ts`). High-risk + production-critical → will be `REQUIRES_HUMAN_MERGE`. **Gate: resolve A.005.2 first** (the spec it would read still says "never self-host/Sandbox" — superseded by D5/D9).
- **Audit-finding PRs (A.005.x, never auto-merge):** A.005.1 (Critical — `content_clients` RLS), A.005.2 (High — reconcile Approach-B spec vs D5/D9, **do before P0.W.2**), A.005.3 (High — route faithfulness/voice gates through the metered Gateway + DR), A.005.4 (High — CI: run tests + wire `node:test` RLS + worker-env-lint). See `audits/audit-001-2026-06-25.md`.

## Blocked / awaiting input

_(none currently blocking — the P0.W.1 architecture gate is resolved.)_

- **PR P0.W.1 (PR 000 — capability-denial spike)** — **MERGED** at PR #3 (squash `54731a1`, 2026-06-25). Live Vercel Sandbox adversarial run CONFIRMED 4/4 PASS under the hardened profile; the two initial FAILs (egress MMDS, fs unconstrained shell) were remediated in-tree and re-verified. Decisions: **DR-010** (egress = networkPolicy + in-VM MMDS `iptables` block), **DR-011** (no-shell worker + workdir-scoped file tool).
  - **Worker-lane consequence:** **P0.W.2 (worker host) is now reachable** and must implement the hardened profile (DR-010 + DR-011); the spike's `_harness.ts` carries the reference `hardenSandbox` / `readViaWorkdirTool` / boot-refusal contract. P0.W.3/W.4/W.5/P0.S.2/P1.W.1 follow.
  - **Audit gate:** STATE flags an audit is due (4 runs since last; threshold 5) — the orchestrator runs it before the next work-doing run (P0.W.2).

## Active risks (from audit-001, 2026-06-25)

- **[Critical] Anon tenancy-map leak (A.005.1):** `content_clients` has no RLS → anon can read every workspace↔client map. Fix-PR queued; never auto-merges.
- **[High] Governance spec contradiction (A.005.2):** `01-architecture.md`/`00-vision` still say "Approach B, never self-host/Sandbox" — contradicts D5/D9 + shipped code. **Misdirects P0.W.2 — resolve first.**
- **[High] Model spend escapes the metered Gateway (A.005.3):** faithfulness/voice gates call OpenRouter directly → invisible to the D4 cost ledger. Re-route through `resolveGatewayModel` + DR.
- **[High] No CI runs the tests (A.005.4):** no workflow, no `turbo run test`; the `node:test` RLS suite is invoked by nothing; worker-env-lint never runs (AC#3).
- **[High] RLS behavioral assertions unproven (A.005.5):** Tier-2 RLS tests skip without Postgres → fold a PG harness into P0.S.2 + A.005.4.
- **Process:** `flywheel-events.jsonl` reconciled for the out-of-loop P0.W.1 resolution (done); judge `source-consumed-integration-build` check (DR-008 lesson) **drafted, PENDING your approval** — it edits the self-modifying `judge-prompt.md`; apply before P0.W.2's judge runs.

## Recent learnings (last 5)

0. **Audit-001 (Run #005): the moat is solid; the gaps are at the edges.** Deterministic kernel + host-side enforcement + tests are spec-faithful (zero hollow tests). Real risks: anon-RLS on `content_clients`, the Approach-B/D5-D9 spec contradiction, gates bypassing the metered Gateway, and NO CI executing any test. See [[audit-001]] + Active risks above.
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

## Status legend

- `NOT_STARTED` · `IN_FLIGHT` · `INTERRUPTED` · `APPROVED_NOT_COMMITTED` · `PR_CREATED` (open, awaiting merge) · `MERGED` · `PREVIEW_FAILED` · `BLOCKED` · `REQUIRES_HUMAN_MERGE`

---

*Run #005 (AUDIT) complete · audit-001 written (1 Critical + 4 High + 2 process fixes) · 5/23 merged + 1 corrective · P0.W.1 MERGED (#3) · audit gate cleared (0 runs since audit) · next work-doing run = P0.W.2 (after A.005.2 spec reconcile)*

> **Reachability note (post-gate):** P0.W.1 is merged, so the worker lane is open. Next dependency-eligible work: **P0.W.2** (worker host), then P0.W.3/W.4/W.5 + P0.S.2 + the Phase-1 lanes. The audit-finding PRs (A.005.x) are human-merge and should be triaged alongside — A.005.2 (spec reconcile) is a prerequisite for handing P0.W.2 to an agent with a correct topology spec.
