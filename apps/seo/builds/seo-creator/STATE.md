# SEO Creator Build — Current State

**Last updated:** 2026-06-25 (post-#004 manual remediation — P0.W.1 gate CONFIRMED, ready to merge + resume)
**Current build phase:** Phase 0 — Foundations
**Phase progress:** 5 / 23 engineering PRs merged (+1 corrective C.004.1)
**Runs since last audit:** 4 (audit threshold: 5 — audit due before the next work-doing run)
**Loop status:** was TERMINAL (depleted); P0.W.1 live run now COMPLETE + CONFIRMED (4/4 PASS, hardened profile). On human merge of PR #3, the worker lane unblocks and the loop can resume (`/seo-creator-build auto`) with P0.W.2 reachable.

## Currently in flight

_(none — loop terminated **depleted** after Run #004; P0.W.1 gate since CONFIRMED out-of-loop via the manual live Sandbox run + remediation. Next action is human merge of PR #3, then resume.)_

## Next up (dependencies satisfied)

- **PR P0.E.4** (PR 005 — /content/api/{brief,draft,audit,publish} kernel route contract) — deps [P0.E.3 ✓, P0.S.1 ✓] — engine-port. **The LAST autonomously-reachable PR** — after it, every remaining PR transitively needs the worker lane (gated on P0.W.1's live Sandbox run).

## Blocked / awaiting input

- **PR P0.W.1 (PR 000 — capability-denial spike)** — `PR_CREATED`, OPEN at PR #3. **Live Vercel Sandbox adversarial run COMPLETE (2026-06-25) — gate result: VERCEL SANDBOX CONFIRMED (hardened profile), 4/4 controls PASS.** A fresh team-scoped `VERCEL_TOKEN` cleared the prior `403 invalidToken` blocker; the two initial FAILs (egress MMDS, fs unconstrained shell) were **remediated in-tree and re-verified PASS** (commits `3771081`, `df1205f`). Decisions recorded: **DR-010** (egress = networkPolicy + in-VM MMDS `iptables` block) and **DR-011** (no-shell worker + workdir-scoped file tool). See PR #3 `RESULTS.md`.
  - **Remaining human action: ratify + MERGE PR #3.** Still human-gated per DR-002 (a human ratifies the confirmation + the hardened-profile architecture). On merge, the worker-runtime lane unblocks.
  - **Worker-lane consequence:** once P0.W.1 merges, **P0.W.2 (worker host) is reachable** and must implement the hardened profile (DR-010 + DR-011). P0.W.3/W.4/W.5/P0.S.2/P1.W.1 follow. Independent lanes (engine-port, schema-tenancy) were already complete for Phase 0's reachable set.

## Recent learnings (last 5)

0. **P0.W.1 gate CONFIRMED via live run + remediation (2026-06-25).** Vercel Sandbox is a viable worker runtime *with a hardened profile*: (a) egress = SDK `networkPolicy` allowlist + in-VM `iptables` DROP on `169.254.0.0/16` (the Firecracker MMDS is hypervisor-local and token-gated — the egress policy can't refuse it; the iptables block can) [[DR-010]]; (b) fs = **no-shell worker** + a workdir-scoped file tool — a VM shell jail is unachievable (non-root run, permissive image, no chroot), so the control lives at the tool layer [[DR-011]]. All 4 probes PASS. The `vercel-sandbox` run user is uid 1000 but can `sudo` and the base image is permissive. PR 006 must build this profile.
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
| P0.W.1 | PR 000 — Phase-0 spike: prove Sandbox + Agent-SDK capability-denial is enforceable (architecture gate) | worker-runtime | PR_CREATED (live run COMPLETE — **CONFIRMED 4/4 PASS**; awaiting human merge) | — | df1205f | [#3](https://github.com/digital-seniority/sagemark/pull/3) |
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

## Status legend

- `NOT_STARTED` · `IN_FLIGHT` · `INTERRUPTED` · `APPROVED_NOT_COMMITTED` · `PR_CREATED` (open, awaiting merge) · `MERGED` · `PREVIEW_FAILED` · `BLOCKED` · `REQUIRES_HUMAN_MERGE`

---

*Run #004 complete · 5/23 merged + 1 corrective · P0.W.1 live Sandbox run COMPLETE → **CONFIRMED 4/4 PASS** (hardened profile; DR-010 + DR-011) · next: human merge of PR #3 → resume loop (P0.W.2 reachable) · audit due (4 runs since last)*

> **Autonomous reachability note:** with the worker lane gated behind P0.W.1's live Sandbox run, the dependency-eligible-without-the-worker set is P0.E.3 → P0.E.4, after which everything remaining (P0.S.2, P0.W.2+, all of Phase 1) transitively needs the worker lane. The loop will run P0.E.3 + P0.E.4, then terminate "depleted" and surface that the rest needs the human Sandbox run + the worker host.
