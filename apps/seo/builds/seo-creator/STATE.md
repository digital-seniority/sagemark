# SEO Creator Build — Current State

**Last updated:** 2026-06-26 (UNATTENDED Run #23 — audit-005 discharged; **DR-026 live data-layer: READ adapter #66 MERGED (inert), WRITE adapter #67 OPEN for review (inert)**; M6 manifest check added; Phase 1: 11/12. Remaining = review-comments adapter (last data-layer gap) → then activation (human gate) + P1.C.4)
**Current build phase:** Phase 1 — Pilot (**audit-005 CLEAR — no Critical; HEALTHY. Only P1.C.4 (needs SoM prompt-set) + the A.005.x correctives remain to Phase-1 close**)
**Phase progress:** **21 / 23 mapped engineering PRs merged** — all 10 Phase-0 + **Phase 1: 11/12 merged** (P1.R.1 #31, P1.R.2 #34, P1.R.3 #47, P1.W.1 #32, P1.U.1 #35, P1.U.2 #37, P1.U.3 #39, P1.U.4 #41, P1.C.1 #50, **P1.C.2 #56, P1.C.3 #58**) · **only P1.C.4 (PR 021) remains** · +imagegen (#43/#45) (+6 correctives: C.020.1 #49, C.021.2 #52, C.022.3 #54, +A.005.2 #61 OPEN · +1 spike · 4 audit fixes · suite #24)
**Runs since last audit:** **0** (audit-005 done 2026-06-26 — `audits/audit-005-2026-06-26.md`, **no Critical**; 4 High → A.005.x correctives queued + [[DR-039]] + manifest check added).
**Sibling build:** `@sagemark/imagegen` BUILT OUT — Stage 1 #43 + Stage 2 #45 (engine + generateHeroImage + Supabase persistence; 0035 applied to Sagemark + private bucket; [[DR-032]]). Pexels key provisioned.
**Loop status:** **⏹ AUTO-LOOP ENDED (active:false) — Run #022 terminal.** Run #22 (James-directed `auto`, 6h budget from 2026-06-26T16:23Z): wired 4 structured judge checks into the manifest (process debt A.014.5 discharged), then a 3-agent floodgate batch → **C.020.1 #49 MERGED** (audit-004 F1 edit draft-guard; judge 5/5·5/5; CI green); **P1.C.1 #50 OPEN** held for human merge (High-risk public tenant-isolation review surface + new `0036` migration; judge security boundary APPROVED after a CI-wiring fix); **C.021.1 BLOCKED** (structural mis-scope — no live Drizzle adapter ([[DR-026]]) + no slug→generated_images linkage ([[DR-033]]); agent correctly refused to fabricate fail-open; → [[DR-035]]). **Terminal reason:** remaining mapped Phase-1 engineering (P1.C.2/3/4) blocked on NON-ENGINEERING (D6 credentialed reviewer; ≥3-engine share-of-model measurement) + C.021.1 blocked on a schema-tenancy prerequisite. **To resume:** (1) James merges #50 + applies `0036` to Sagemark Supabase; (2) land the schema-tenancy-lane live-Drizzle-adapter + asset-linkage PR (unblocks C.021.1 + P1.C.x); (3) provide the non-eng inputs (D6 reviewer, ≥3-engine SoM) for P1.C.2/3/4.

**⟳ POST-RUN-22 FOLLOW-UP (James-directed, 2026-06-26):** **#1 DONE** — P1.C.1 **#50 MERGED** (`94cde1f`); the `0036` migration still needs applying to Sagemark Supabase (James — no service-role/DATABASE_URL in Claude's env). **#2 DONE** — C.021.1 re-scoped + built as **C.021.2 [#52](https://github.com/digital-seniority/sagemark/pull/52) OPEN** (slug asset-linkage + live image-resolver adapter; judge APPROVED 5/5·5/5; REQUIRES_HUMAN_MERGE; applies `0037` on merge). **#3 DONE (decisions)** — D6 reviewer = seeded placeholder for the pilot ([[DR-037]]); share-of-model = ChatGPT·Claude·Gemini via AI Gateway direct-query ([[DR-038]]). **P1.C.2/3/4 now SPEC-UNBLOCKED.** Remaining human inputs (no rush): a **real credentialed reviewer before any live YMYL publish** (go-live guard blocks the placeholder); the **per-client SoM prompt-set** (P1.C.4 prerequisite); apply `0036`+`0037` to Supabase. Remaining eng prerequisite: the **[[DR-013]] Gateway-only-metering corrective** before P1.C.3 (PR 020) cost ledger.

## Currently in flight

_(⏵ UNATTENDED Run #23 (James-directed, 5h from 2026-06-26T20:22Z). **OPEN PR awaiting James:** [#67 DR-026 write adapter](https://github.com/digital-seniority/sagemark/pull/67) (inert, judge 5/5, mutations held for review). Iter 1: audit-005 discharged (#61/#63/#64). Iter 2: DR-026 read adapter #66 MERGED (inert). Iter 3: DR-026 write adapter #67 OPEN. M6 resolved. **Iter 4 NEXT: the `ReviewCommentDataAccess` live adapter** (last data-layer gap, inert). Then TERMINAL — remaining work is the ACTIVATION (human go-live gate) + non-eng (P1.C.4 SoM prompt-set, pilot-workspace seed, live-Sandbox Tier-2/3).)_

## Next up (post-follow-up)

- **James — review/merge the two open PRs:** [#56 (P1.C.2)](https://github.com/digital-seniority/sagemark/pull/56) + [#58 (P1.C.3)](https://github.com/digital-seniority/sagemark/pull/58). After each merges, Claude applies its migration (`0038` / `0039`) + the P1.C.2 pilot reviewer seed to Supabase (Claude now has `DATABASE_URL`).
- **P1.C.4 (PR 021) — the LAST mapped Phase-1 PR.** SoM defined (ChatGPT·Claude·Gemini via Gateway, [[DR-038]]); deps PR 020 (#58) + PR 017 ✓. **Needs the per-client SoM prompt-set** (Whispering Willows queries to test for citation) before the ingestion cron — the one remaining non-eng input. NOTE the RFC's measurement-feasibility caveat (≥3 legal/reliable channels — DR-038's Gateway-direct method satisfies it).
- **Before live YMYL publish:** swap the [[DR-037]] placeholder for a real credentialed reviewer; the live-publish wiring must pass `pilot:false`.
- **Still deferred (full live pipeline):** the broader [[DR-026]] `ContentDataAccess` → live-DB wiring (loadPiece / voice specs / version writes; + the live ledger writers) — C.021.2 wired only the image resolvers; P1.C.3 ships the ledger schema + logic but the live writer is NOT_WIRED.
- **✅ AUDIT DONE — audit-005** (`audits/audit-005-2026-06-26.md`, 5 auditors, no Critical, build HEALTHY). **3 correctives queued before P1.C.4** (never auto-merge): **A.005.2** (fix the `token-scope.test.ts` hollow Tier-2 now that `DATABASE_URL` is set — it passes vacuously; + glob-discover gate files in `gate-path-lint`); **A.005.1** (widen `PersistedAuthorization` with `granted_at`/`scope` per [[DR-039]] — §11.5 release predicate; + wire `recordCredentialedRelease` with `pilot:false`); **A.005.3** (spec-update RFC/PRD for gate_results-as-projection + `0039`/accumulator + 3-engine list; mount the two unmounted Inspector panels + smoke tests).

## Active items (human / deployment)

- **Deploy Stage A — DONE.** `apps/seo` host is live in production at **https://sagemark-seo.vercel.app** (Vercel project `digital-seniority/sagemark-seo`, `prj_wd0r52t`, rootDirectory=apps/seo, monorepo build green). `/api/health` 200; `/content/api/*` live (400 on empty body). `SUPABASE_SERVICE_ROLE_KEY` set (user); Vercel Deployment Protection DISABLED (user-approved); Gateway via OIDC. This is the worker's host-tool bridge URL.
- **Deploy Stage B/C — REMAINING (P0.W.2 live Tier-2/3).** Build the worker `Dockerfile` → Sandbox (snapshot, or the base-`node24` fallback path), provision it pointed at `sagemark-seo.vercel.app` with a per-run **bridge JWT** + the Gateway base URL, drive a real brief → assert serpFetch→runGate→persistPiece writes to Sagemark → teardown → state reloads, + the recycle/residue test. **Still needs:** the bridge-JWT signing secret configured on BOTH host + worker (new shared secret), the worker Gateway credential, and the Sandbox wiring. The Vercel token (Sandbox provisioning) is available.
- ~~**DR-013 enforcement corrective**~~ **DONE** (C.022.3, #54 `a7f03b7`, judge 5/5·5/5): the gates now resolve via `resolveGatewayModel(GATE_MODEL, "host", { forceGateway: true })` (skips the direct-Anthropic BYOK branch even with `ANTHROPIC_API_KEY` set) + a build-failing `gate-path-lint` CI step over both gate files + negative tests. **P1.C.3's Gateway-only-metering prerequisite is cleared.**
- **ALL migrations APPLIED (2026-06-26):** `0036` (comment_threads + review_tokens), `0037` (generated_images.slug), `0038` (byline_authorizations.placeholder), `0039` (seo_cost_ledger + seo_cost_run_budget + share_of_model) — applied to Sagemark Supabase via a Node `pg` script (James set `DATABASE_URL` in `.claude/settings.local.json`; gitignored). Verified each time: tables/columns/indexes present, **RLS enabled, no anon policy (fail-closed)**. See [[sagemark-supabase-migration-access]] memory for the recipe. **PENDING (operational):** the pilot reviewer **seed** (`drizzle/seed/0038_pilot_placeholder_reviewer.sql`) — applied to the pilot workspace ONLY, needs the pilot workspace/client/author/operator uuids (no pilot workspace provisioned yet).
- **⚠ Go-live safety ([[DR-037]]):** P1.C.2's `recordCredentialedRelease({pilot})` flag is caller-supplied — the eventual live-publish wiring (the DR-026 lane) MUST pass `pilot:false` in production so the placeholder reviewer can never satisfy a real YMYL release.
- **Stale worktrees:** several merged-PR worktrees under `.claude/worktrees/` can be pruned (kaishi / `git worktree prune`).

## Next up (auto-loop, unattended)

- **Run #013 → P0.S.2** (PR 009 — voice-spec hard stop + fail-closed publish endpoint) — **NOW ELIGIBLE** (RFC dep PR 008 ✓ merged #26). canPublish reads `credentialed_releases` (never `client_signoffs`); byline server-resolved; revoked/expired authorization blocks. **Fold in:** A.011.6 (rename FSM `NOT_PUBLISH_VERDICT`→`VERDICT_NOT_PUBLISH` per §9.1) + A.011.7 (bind `evalRan` to a persisted `gate_results` row, promote DR-009 open bullet).
- **Phase 1** opens after P0.S.2: P1.U.x (agent-ui), P1.R.x (render-geo), P1.W.1, P1.C.x (client-review) — many become dep-eligible.
- **Opportunistic correctives (audit-002):** A.011.4 (agent-worker/emit tests), A.011.5 (no-console posture), A.011.8 (schema-flywheel test), A.011.13 (alg check), live-infra verification pass (Tier-3), wire `build:worker` → `apps/seo/dist/` (so the Dockerfile COPY resolves).

## Active risks (audit-002 + Run #012 — High/Med; no Critical)

### audit-005 (2026-06-26) — ALL HIGH RESOLVED (Run #23 unattended)
- **✅ H1/H2 — RESOLVED:** A.005.1 [#63](https://github.com/digital-seniority/sagemark/pull/63) MERGED (`adab32d`) widened `PersistedAuthorization` (`granted_at`/`scope`) + scope-aware §11.5 predicate (fail-closed all degenerate inputs; read/write parity); A.005.3 [#64](https://github.com/digital-seniority/sagemark/pull/64) MERGED (`aa7bc47`) reconciled RFC/PRD to gate_results-as-projection ([[DR-039]]). **[[DR-025]] DISCHARGED** (obligation 3 done; table mandate superseded by DR-039).
- **✅ H3/H4 — RESOLVED:** A.005.2 [#61](https://github.com/digital-seniority/sagemark/pull/61) MERGED (`463240e`) — real anon-isolation Tier-2 (now runs live + PASSES in CI, proving review_tokens/comment_threads anon-zero-rows) + `gate-path-lint` glob-discovery + `gate-metering-lint-coverage-complete` manifest check. (CI race "tuple concurrently updated" fixed: serialized node:test + dropped redundant turbo passthrough.)
- **✅ M2 — RESOLVED:** A.005.3 mounted `CostLedgerPanel`/`ApprovalDebtPanel` (data-gated, degrade-safe) + smoke tests.
- **Remaining (non-blocking):** **[Med] M1** — the live `recordCredentialedRelease` persistence now EXISTS (DR-026 write adapter #67, `insertCredentialedRelease`, inert) but is not yet route-activated; final wiring (with `pilot:false`) is the **activation** step (human gate). **[Med] M6 — RESOLVED:** `worktree-base-freshness` manifest structured-check added (formalizes DR-036; STEP-0.5 in every agent). **[Low] — RESOLVED:** `sse-relay.ts` gate_results comments fixed in #66. 
- **DR-026 live data-layer (Run #23):** **READ adapter #66 MERGED** (`4aaeeec`, inert — 14 tenancy-scoped read methods, judge 5/5). **WRITE adapter #67 OPEN for review** (`worktree-agent-a75bd3478fd712b78`, inert — 6 writes + 2 fail-closed, judge 5/5, mutations held for human eyes). **Last gap: the `ReviewCommentDataAccess` seam (api/review/comments)** — a separate seam still NOT_WIRED; live adapter next. **THEN: ACTIVATION** (route-wiring the live adapters + service-role creds + `pilot:false` + publishEnabled) = the go-live human gate — NOT done autonomously.

- **DISCHARGED:** ~~A.011.1~~ (allowlist single-source — closed in P0.W.5 #26, asserted by test), ~~A.011.2~~ (RFC path reconciled), ~~A.011.9~~ (Dockerfile COPY + context).
- **[Med] A.011.6** FSM `NOT_PUBLISH_VERDICT` vs §9.1 `VERDICT_NOT_PUBLISH` → fold into P0.S.2. **[Med] A.011.7** `evalRan` from `verdict!==null` (DR-009) → fold into P0.S.2. **[Med] A.011.5** no-console dead directives. **[Med] A.011.8** schema-flywheel vacuous test.
- **[Med] Run#012 cross-lane ([[DR-024]]):** the canonical Whispering Willows demo prose is itself gate-vetoed for em-dash density (all 10 golden pieces `VETO_BANNED_LEXICON`) — demo-content vs banned-lexicon-threshold decision (content ↔ gate lane).
- **[Med] Run#012:** `apps/seo/dist/` worker build artifact has no producing build step — the Dockerfile is context-consistent but `docker build` fails at the `COPY apps/seo/dist/` layer until a `build:worker` compile is wired (pre-existing P0.W.2 follow-up).
- **[Low] A.011.12** worker bridge-JWT can POST /content/api/publish (FSM release-gate is the real, sound barrier — defense-in-depth). **[Low] A.011.13** alg header unchecked (not exploitable).
- Two draft structured checks for the judge: `tool-allowlist-single-source`, `worker-credential-publish-scope` (see audit-002).
- **Go-live blockers (worker undeployed):** live-Sandbox Tier-2/3 (skill load, adversarial re-run, SSE e2e), expert golden-label certification (DR-022/DR-024), the dist build wiring.

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

-4. **Run #022 — the orchestrator can mis-scope; the agent's refusal-to-fabricate IS the safety net.** C.021.1 ("wire the live Drizzle `resolveReferencedAssets`/`resolveHeroAssets`") was unbuildable as scoped: there is NO live Drizzle data-access adapter in `apps/seo` (only `NOT_WIRED` throw-stubs + in-memory fixtures — the [[DR-026]] deferral) and NO slug→`generated_images` linkage (no `slug` column / asset-ref table — exactly [[DR-033]]'s "Revisit if"). The agent STOPPED rather than fuzzy-match slug→`storage_key` (which would reopen the DR-033 fail-open). Parked → [[DR-035]]; the current fail-closed behavior (image bodies unpublishable, hero→placeholder) is the safe state, no regression. Two clean wins shipped alongside: **C.020.1** (#49, audit-004 F1 edit draft-guard, judge 5/5·5/5, auto-merged) and **P1.C.1** (#50, tokenized client-review preview, judge security-boundary APPROVED, held for human merge). Also: process debt A.014.5 discharged (4 structured judge checks wired into the manifest before the schema PR). **[[DR-036]]: `isolation:"worktree"` agents branched from the stale orchestrator-compile commit (`95d5486`, 65 behind preview), not preview HEAD — all 3 self-corrected via ff-to-preview; add a STEP 0.5 ff-guard to the agent template.**
-3. **Suite wired + golden harness (Run #012, P0.W.5 #26 `f52f4af`).** The real `seo-blog-writer` SKILL.md (vendored, DR-022) is loaded verbatim into the worker driving `/content/api/draft` (kernel-backed, identity-checked). Golden-set tripwire captures the real `@sagemark/core` kernel. **Judge caught a load-bearing defect:** the golden extraction normalized em-dashes BEFORE the gate, masking a real `VETO_BANNED_LEXICON` Stage-A veto — blinding the AI-slop drift class. Fixed: honest all-veto baseline ([[DR-024]]) + anti-masking meta-check ("no extraction transform changes a captured veto") + test-time clean-draft synthesis for Stage-B drift. Lesson: any "normalize input before the gate" step in a characterization harness must escalate to a DR. audit Highs A.011.1 (allowlist single-source), A.011.2 (RFC path), A.011.9 (Dockerfile COPY) discharged. Surfaced cross-lane tension: the canonical demo prose fails the org's own em-dash gate.
-2. **Bridge-auth enforced end-to-end (Run #010, C.009.1 #22 `2128791`, judge 5/5·5/5).** DR-018 discharged: the per-run bridge JWT (minted host-side, sent by the worker) is now verified at EVERY `/content/api/*` host tool — not just convention. Pattern: `authenticateBridgeRequest()` ([[DR-021]]) branches on `Authorization: Bearer` → token-as-credential (tenancy from claims, **reject if body.clientId ≠ token.cl** → no scope-widening, fail-closed); no bearer → unchanged operator path. Verifier extracted to `@/lib/auth/bridge-token`. Standing table-driven regression fails CI until every host tool authenticates. Cross-tenant fully closed; intra-tenant same-window run replay is by-design within ~90s ([[DR-020]] — harden when a run registry exists per [[DR-017]]). **P0.W.5 blocker discovered:** its golden corpus needs HUMAN labels (non-engineering) and the suite SKILL.md files live at `~/.claude/skills/seo-copywriter/`, not in-repo — `load-suite.ts` needs a vendoring/packaging decision.
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

- `apps/seo/src/lib/auth/bridge-token.ts` (NEW) + `src/lib/content/context.ts` (authenticateBridgeRequest) + `src/app/content/api/{brief,draft,audit,publish}/route.ts` + `src/app/api/run/route.ts` (re-export) + `test/content/bridge-auth.test.ts` (C.009.1 / PR #22)
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
| P0.W.5 | PR 008 — Wire the seo-blog-writer suite skill into the worker (single-drafter slice) + golden-set regression harness | worker-runtime | **MERGED** (judge NEEDS-FIXES→fixed→5/5·5/5; honest golden baseline [[DR-024]]; A.011.1/2/9 folded) | Run #012 | f52f4af | [#26](https://github.com/digital-seniority/sagemark/pull/26) |
| P0.S.2 | PR 009 — Voice-spec hard stop + fail-closed publish endpoint (thinnest-slice close-out) | schema-tenancy | **MERGED** (judge 5/5·5/5; YMYL byline-trust hole closed; A.011.6/A.011.7 folded; [[DR-025]]) | Run #013 | ea0fc0f | [#28](https://github.com/digital-seniority/sagemark/pull/28) |

## Phase 1 — Pilot PR map

| ID | Title | Lane | Status | Run merged | Commit | PR |
|---|---|---|---|---|---|---|
| P1.U.1 | PR 010 — Three-zone agent canvas shell (reuse the existing apps/agents StudioCanvas) | agent-ui | **MERGED** (judge 5/5·5/5 fit-for-shell; SSE-wired; DOM-test-runner gap flagged) | Run #016 | aef8fad | [#35](https://github.com/digital-seniority/sagemark/pull/35) |
| P1.U.2 | PR 011 — Live token streaming into the center editor + Inspector gate scorecard | agent-ui | **MERGED** (judge 5/5·5/5; scorecard-honesty + jsdom runner [[DR-028]]/[[DR-029]]) | Run #017 | 92192bd | [#37](https://github.com/digital-seniority/sagemark/pull/37) |
| P1.U.3 | PR 012 — Conversational fine-tune: /api/edit bounded diff + full gate re-run + versioning | agent-ui | **MERGED** (judge 5/5·5/5; ★Slice-1 close★; 409/429/403 guards; [[DR-030]]) | Run #018 | 13e409c | [#39](https://github.com/digital-seniority/sagemark/pull/39) |
| P1.U.4 | PR 013 — Version hub: switch / name / compare + undeletable named sign-off | agent-ui | **MERGED** (judge 5/5·5/5; sign-off immutable at the seam; [[DR-031]] DB follow-up) | Run #019 | 63c65e5 | [#41](https://github.com/digital-seniority/sagemark/pull/41) |
| P1.W.1 | PR 014 — Wire the remaining three suite skills into the worker (strategist / assistant / audit) — the full chain | worker-runtime | **MERGED** (judge 5/5·5/5; N=3 cap [[DR-027]]; A.014.1+A.014.5 folded) | Run #015 | 659b083 | [#32](https://github.com/digital-seniority/sagemark/pull/32) |
| P1.R.1 | PR 015 — Content-hub SSR render route + FAQ JSON-LD + placeholder stripping | render-geo | **MERGED** (judge NEEDS-FIXES→fixed→5/5·5/5; escape-first [[DR-026]]) | Run #015 | 6258732 | [#31](https://github.com/digital-seniority/sagemark/pull/31) |
| P1.R.2 | PR 016 — CI reachability gate (sitemap == published-and-indexable set, both directions) | render-geo | **MERGED** (judge 5/5·5/5; both-directions + failing-case proofs; ci.yml step) | Run #016 | 2232ee3 | [#34](https://github.com/digital-seniority/sagemark/pull/34) |
| P1.R.3 | PR 017 — Generated resource-library homepage (D7) + imagegen hero resolution | render-geo | **MERGED** (judge 5/5·5/5; +DR-033 publish image-license gate; hero async/Pexels-first/gated) | Run #021 | cd5a49c | [#47](https://github.com/digital-seniority/sagemark/pull/47) |
| P1.C.1 | PR 018 — Tokenized client-review preview + pinned comments + section verbs | client-review | **MERGED** (judge security-boundary APPROVED; [[DR-034]]; ⚠ apply `0036` to Sagemark Supabase) | Run #022 | 94cde1f | [#50](https://github.com/digital-seniority/sagemark/pull/50) |
| P1.C.2 | PR 019 — "Request changes" -> agent edit loop routing + named sign-off + approval-debt KPI | client-review | **MERGED** (judge 5/5·5/5; `0038` applied; pilot seed pending pilot-workspace ids; [[DR-037]]) | attended | cab8827 | [#56](https://github.com/digital-seniority/sagemark/pull/56) |
| P1.C.3 | PR 020 — Separate SEO cost ledger (AI Gateway) + share-of-model instrumentation | worker-runtime | **MERGED** (judge 5/5·5/5 after accumulator fix-pass; `0039` applied; rebased over #56; [[DR-038]]/[[DR-039]]) | attended | 9f58e62 | [#58](https://github.com/digital-seniority/sagemark/pull/58) |
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
| 010 | 5.0 | 5.0 | 0% | 0% |
| 011 | audit | audit | — | — |
| 012 | 5.0 | 5.0 | 0% | 100% (1/1, judge caught golden mask) |
| 013 | 5.0 | 5.0 | 0% | 0% |
| 014 | audit | audit | — | — |
| 015 | 5.0 | 5.0 | 0% | 50% (1/2, judge caught JSON-LD bug) |
| 016 | 5.0 | 5.0 | 0% | 0% |
| 017 | 5.0 | 5.0 | 0% | 0% |
| 018 | 5.0 | 5.0 | 0% | 0% |
| 019 | 5.0 | 5.0 | 0% | 0% |
| imagegen S1/S2 | 5.0 | 5.0 | 0% | 50% (1/2, CI storage-perms fix) |
| 020 | audit | audit | — | — |
| 021 | 5.0 | 5.0 | 0% | 0% |
| 022 | 4.5 | 5.0 | 33% (1/3 BLOCKED — orchestrator mis-scope) | 50% (1/2 re-judge, judge caught CI-wiring gap on the leak-test) |
| attended (C.021.2/C.022.3/P1.C.2/P1.C.3) | 5.0 | 5.0 | 0% | 33% (P1.C.3 accumulator-table fix-pass) |
| audit-005 | audit | audit | — | — |

## Status legend

- `NOT_STARTED` · `IN_FLIGHT` · `INTERRUPTED` · `APPROVED_NOT_COMMITTED` · `PR_CREATED` (open, awaiting merge) · `MERGED` · `PREVIEW_FAILED` · `BLOCKED` · `REQUIRES_HUMAN_MERGE`

---

*Attended (post-Run-22) · Phase 1 (9/12 merged): P1.C.1 #50 + C.021.2 #52 + C.020.1 #49 + C.022.3 #54 all MERGED · **0036+0037 APPLIED (RLS fail-closed)** · **P1.C.2 [#56](https://github.com/digital-seniority/sagemark/pull/56) + P1.C.3 [#58](https://github.com/digital-seniority/sagemark/pull/58) OPEN for review** (judge 5/5·5/5; +`0038`/`0039`) · DR-034..038. **Next: James merges #56/#58 → apply `0038`/`0039`+pilot seed → AUDIT (overdue) → P1.C.4 (needs SoM prompt-set) = last Phase-1 PR.***

> **Reachability note (post-Run #010):** C.009.1 (#22 `2128791`) MERGED — DR-018 discharged; the per-run bridge JWT is now enforced at every `/content/api/*` host tool (cross-tenant closed, fail-closed, standing CI regression). Worker host + SSE transport + capability-denial profile + bridge-auth are all on preview. **Audit is now DUE** (5 runs since last; threshold 5 — Phase 2 gate blocks the next work-doing run until `/seo-creator-build audit full` runs). **P0.W.5 (PR 008) is BLOCKED** on the human-labeled Whispering Willows golden corpus (non-engineering) + the suite-skill→Sandbox vendoring decision; P0.S.2 follows P0.W.5. Open hardening: W.3 boot-wiring/no-drift notes; [[DR-020]] intra-tenant run binding (when a run registry exists); Stage B/C live-Sandbox Tier-2/3. Next: run the audit, then unblock P0.W.5's golden corpus.
