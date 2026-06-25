---
name: SEO Creator PR map
version: 1.0
anchor_subpages_by_phase:
  Phase 0 — Foundations:
    - path: plans/seo-creator/flywheel/prd.md
      current_hash: 4dd82dfa9c9e72af4b26b1880d69e041a7e1e932
    - path: plans/seo-creator/flywheel/engineering-rfc.md
      current_hash: 16b799f895c74743eba162b6cfefe500ef7c32ef
    - path: plans/seo-creator/DECISIONS.md
      current_hash: 5188f9f1bcd3c88fa0491a2cb770bf396f2cd218
  Phase 1 — Pilot:
---

# SEO Creator — PR Map

The work-unit registry. Every PR the orchestrator will ever consume. Each row is one PR.

This file is read by `/seo-creator-build` every run. Updated by the orchestrator (status field flips during runs); rows can be added between runs by a human when the RFC grows.

Anti-pattern: editing a PR's `write_scope` or `acceptance_criteria` after the PR is `MERGED` — those fields should be append-only for completed PRs.

---

## Phase 0 — Foundations


### PR P0.W.1 — PR 000 — Phase-0 spike: prove Sandbox + Agent-SDK capability-denial is enforceable (architecture gate)

- **Lane:** worker-runtime
- **Status:** NOT_STARTED
- **Risk:** High
- **Dependencies:** none
- **Spec section:** engineering-rfc.md:### PR 000
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md, plans/seo-creator/flywheel/prd.md, plans/seo-creator/DECISIONS.md

**Write scope (judge cross-checks):**
- `apps/seo/spike/capability-enforcement/egress-probe.ts`
- `apps/seo/spike/capability-enforcement/env-scrub-probe.ts`
- `apps/seo/spike/capability-enforcement/fs-constraint-probe.ts`
- `apps/seo/spike/capability-enforcement/boot-refusal-probe.ts`
- `apps/seo/spike/capability-enforcement/RESULTS.md`

**Acceptance criteria:**
- Each of the four controls (egress allowlist, env scrub, constrained shell/file, boot-refusal) is exercised by a real adversarial run on Vercel Sandbox (not a mock) and its pass/fail recorded in RESULTS.md.
- If all controls are enforceable, RESULTS.md records "Vercel Sandbox confirmed" and PR 006/006b proceed as written.
- If any control is unenforceable, RESULTS.md records the specific failure and the adopted fallback runtime (egress proxy / isolated container service / no-shell-capable Agent-SDK worker in v1), and PR 006/006b are re-scoped against that fallback before the worker is built.
- The decision is made before PR 006 (the worker host) merges — this PR is an explicit architecture gate, not a parallel track.

**Test plan:**
- Tier 1 (preferred): The four probe scripts run locally against a Sandbox dev target.
- Tier 2 (local fallback): A CI/manual adversarial run on real Vercel Sandbox infra produces the recorded RESULTS.md.
- Tier 3 (NEEDS-INPUT): n/a (spike output is the decision doc, not a shipped surface).

**Rollback:** n/a (spike; produces a decision, ships no runtime).

**Resources:**

---

### PR P0.E.1 — PR 001 — Scaffold apps/seo + port the provider seam into @sagemark/core

- **Lane:** engine-port
- **Status:** NOT_STARTED
- **Risk:** Low
- **Dependencies:** none
- **Spec section:** engineering-rfc.md:### PR 001
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md, plans/seo-creator/flywheel/prd.md, plans/seo-creator/DECISIONS.md

**Write scope (judge cross-checks):**
- `apps/seo/package.json`
- `apps/seo/src/app/layout.tsx`
- `apps/seo/src/app/(studio)/page.tsx`
- `apps/seo/src/lib/auth.ts`
- `packages/core/package.json`
- `packages/core/src/ai/resolve-gateway-model.ts`
- `packages/core/src/ai/cost-accountant.ts`
- `pnpm-workspace.yaml`
- `turbo.json`

**Acceptance criteria:**
- pnpm --filter @sagemark/seo build and pnpm --filter @sagemark/core build both succeed via turbo.
- Worker invariant — all worker model traffic routes through the metered Gateway: resolveGatewayModel()'s direct-Anthropic provider branch is host/non-worker-only; a unit test asserts the 'worker' context can resolve only a Gateway provider and refuses a raw-Anthropic-endpoint provider even if ANTHROPIC_API_KEY is present in the ambient env.
- CI assertion — a CI env/config lint fails the build if any worker-bound env or Sandbox-provision config contains a raw Anthropic endpoint (api.anthropic.com) together with a provider API key; the worker's only model credential is the run-scoped Gateway base URL + bridge JWT.
- CostAccountant.reserve() throws CostCapExceededError once the per-run USD ceiling is exceeded (unit test).
- Model ids re-baselined off claude-sonnet-4.5 to claude-sonnet-4-6 (drafter) / claude-haiku-4-5 (verifier) / claude-opus-4-7 (judge); budget_tokens dropped for 4.6+/Opus.

**Test plan:**
- Tier 1 (preferred): Unit tests for the provider-seam branches + cost-cap abort.
- Tier 2 (local fallback): turbo build green across the two new workspaces.
- Tier 3 (NEEDS-INPUT): apps/seo boots locally and serves the placeholder route.

**Rollback:** Delete apps/seo + packages/core; revert pnpm-workspace.yaml/turbo.json. No runtime consumers yet.

**Resources:**

---

### PR P0.E.2 — PR 002 — Port the scorer library + faithfulness/voice gates into @sagemark/core

- **Lane:** engine-port
- **Status:** NOT_STARTED
- **Risk:** Low
- **Dependencies:** P0.E.1
- **Spec section:** engineering-rfc.md:### PR 002
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md

**Write scope (judge cross-checks):**
- `packages/core/src/scorers/flesch-kincaid.ts`
- `packages/core/src/scorers/keyword-density.ts`
- `packages/core/src/scorers/passive-voice.ts`
- `packages/core/src/scorers/content-score.ts`
- `packages/core/src/scorers/broken-chunk-linter.ts`
- `packages/core/src/scorers/banned-lexicon-linter.ts`
- `packages/core/src/scorers/geo-citation.ts`
- `packages/core/src/scorers/faq-schema-generator.ts`
- `packages/core/src/scorers/meta-tag-generator.ts`
- `packages/core/src/scorers/og-tag-generator.ts`
- `packages/core/src/gates/faithfulness-gate.ts`
- `packages/core/src/gates/voice-gate.ts`
- `packages/core/src/config/models.ts`
- `packages/core/src/scorers/*.test.ts`
- `packages/core/src/gates/*.test.ts`

**Acceptance criteria:**
- All ported scorer unit tests pass unmodified against @sagemark/core imports.
- Faithfulness gate carries the 12s timeout + 25-claim cap; voice gate carries the 3s timeout (asserted in tests).
- A unit test asserts config.drafterModel !== config.faithfulnessVerifierModel and fails the build if they collapse.
- A thrown scorer surfaces as a fail-closed error, never a silent pass (test injects a throw and asserts the gate composer would veto).

**Test plan:**
- Tier 1 (preferred): Full ported scorer + gate unit suite.
- Tier 2 (local fallback): drafter !== verifier invariant test in CI.
- Tier 3 (NEEDS-INPUT): none (no UI).

**Rollback:** Remove packages/core/src/scorers + gates; no callers until PR 005.

**Resources:**

---

### PR P0.E.3 — PR 003 — Port seo-gate + lifecycle-fsm + failure-codes into @sagemark/core

- **Lane:** engine-port
- **Status:** NOT_STARTED
- **Risk:** Medium
- **Dependencies:** P0.E.2
- **Spec section:** engineering-rfc.md:### PR 003
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md, plans/seo-creator/flywheel/prd.md, plans/seo-creator/DECISIONS.md

**Write scope (judge cross-checks):**
- `packages/core/src/gate/seo-gate.ts`
- `packages/core/src/gate/failure-codes.ts`
- `packages/core/src/lifecycle/lifecycle-fsm.ts`
- `packages/core/src/gate/stage-b-weights.ts`
- `packages/core/src/gate/*.test.ts`
- `packages/core/src/lifecycle/*.test.ts`
- `packages/core/src/index.ts`

**Acceptance criteria:**
- Stage-A first veto short-circuits to REJECT/REVISE with score=null and Stage-B is never computed (test per veto code: VETO_BROKEN_CHUNK, VETO_UNSOURCED_STAT, VETO_KEYWORD_STUFF, VETO_YMYL_MISCLASSIFIED, VETO_YMYL_NO_BYLINE, VETO_THIN_CONTENT, VETO_BANNED_LEXICON, VETO_VOICE_FAIL, VETO_EVAL_FAILED). The Stage-A set has NO VETO_YMYL_NO_REVIEW — the credentialed-reviewer release is enforced separately in canPublish() on review->approved, not as a Stage-A veto.
- VETO_YMYL_MISCLASSIFIED fires when the ymylSignals detector finds medical-claim signals in a body whose is_ymyl=false (the YMYL false-negative guard).
- STAGE_B_WEIGHTS sum to exactly 1.0 and faithfulness is strictly the max weight (0.20) — asserted in a unit test.
- canPublish() returns true only when verdict==='PUBLISH' && evalRan===true && humanRelease===true && (!is_ymyl || namedCredentialedAuthor && citations); a skipped/thrown eval blocks (test). humanRelease is satisfied only by a credentialed_release, never a client_signoff — a unit test asserts a client_signoff-shaped input is rejected as NO_HUMAN_RELEASE.
- FSM rejects illegal edges with stable codes (ILLEGAL_EDGE, EVAL_DID_NOT_RUN, NO_HUMAN_RELEASE, YMYL_NO_BYLINE), never prose.

**Test plan:**
- Tier 1 (preferred): Exhaustive gate + FSM unit suite (ported).
- Tier 2 (local fallback): Stage-A ordering + canPublish truth-table coverage in CI.
- Tier 3 (NEEDS-INPUT): none.

**Rollback:** Remove gate/FSM modules; revert index.ts exports.

**Resources:**

---

### PR P0.S.1 — PR 004 — Supabase tenancy schema + release/signoff split + RLS + CI contract test

- **Lane:** schema-tenancy
- **Status:** NOT_STARTED
- **Risk:** Medium
- **Dependencies:** P0.E.1
- **Spec section:** engineering-rfc.md:### PR 004
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md, plans/seo-creator/flywheel/prd.md, plans/seo-creator/DECISIONS.md

**Write scope (judge cross-checks):**
- `packages/schema-flywheel/drizzle/0030_content_pieces.sql`
- `packages/schema-flywheel/drizzle/0031_cluster_funnel_columns.sql`
- `packages/schema-flywheel/drizzle/0032_release_records.sql`
- `packages/schema-flywheel/src/content.ts`
- `apps/seo/test/tenancy/rls-contract.test.ts`

**Acceptance criteria:**
- 0030+0031+0032 apply cleanly on a fresh Supabase branch; pnpm drizzle:generate produces no drift.
- Anon SELECT on content_pieces returns only status='published' rows; anon SELECT on voice_specs/content_piece_versions/review_comments/byline_authorizations/client_signoffs/credentialed_releases returns zero rows (contract test).
- An operator service-role query scoped to workspace A returns zero rows for a piece owned by workspace B (cross-tenant contract test).
- (client_id, slug) uniqueness enforced; cluster_role/funnel_stage CHECK constraints reject invalid enums.
- Release/signoff split is structurally distinct: client_signoffs has a release_type CHECK pinned to 'client_signoff' and carries no credential/authorization_id columns; credentialed_releases carries a non-null credential snapshot + authorization_id and a UNIQUE(piece_id,version). A schema test asserts a client_signoff row cannot carry reviewer credentials and that the two release types are separate tables (not a shared kind flag).
- byline_authorizations is the FK target for the release record: credentialed_releases.authorization_id is a non-null FK -> byline_authorizations(id) (ON DELETE RESTRICT); a schema test asserts a credentialed_release referencing a nonexistent authorization is rejected by the FK, and that byline_authorizations carries the scope CHECK + nullable expires_at/revoked_at.

**Test plan:**
- Tier 1 (preferred): Drizzle type-gen + enum/release_type CHECK unit assertions (incl. the client_signoff-has-no-credential assertion).
- Tier 2 (local fallback): rls-contract.test.ts runs against a Supabase branch in CI (both anon and cross-tenant directions, incl. the two release tables).
- Tier 3 (NEEDS-INPUT): Manual psql spot-check of a seeded two-tenant fixture.

**Rollback:** drizzle down-migration drops 0032 release tables (credentialed_releases -> client_signoffs -> byline_authorizations, in FK-dependency order) then 0031 columns/indexes; 0030 revert restores prior schema. No data in prod yet.

**Resources:**

---

### PR P0.E.4 — PR 005 — Stand up the /content/api/{brief,draft,audit,publish} kernel route contract (the agent-unreachable enforcement boundary the suite skills orchestrate)

- **Lane:** engine-port
- **Status:** NOT_STARTED
- **Risk:** Medium
- **Dependencies:** P0.E.3, P0.S.1
- **Spec section:** engineering-rfc.md:### PR 005
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md, plans/seo-creator/flywheel/prd.md, plans/seo-creator/DECISIONS.md

**Write scope (judge cross-checks):**
- `apps/seo/src/app/content/api/brief/route.ts`
- `apps/seo/src/app/content/api/draft/route.ts`
- `apps/seo/src/app/content/api/audit/route.ts`
- `apps/seo/src/app/content/api/publish/route.ts`
- `apps/seo/src/lib/content/serp-fetch.ts`
- `apps/seo/src/lib/content/context.ts`
- `apps/seo/test/content/*.test.ts`

**Acceptance criteria:**
- /content/api/audit (the runScorers/runGate path) is read-only: it returns a verdict + Stage-A/Stage-B detail but cannot mutate status; a test asserts no DB write occurs.
- /content/api/draft rejects any payload whose workspace_id/client_id does not match the bound request context (403), and refuses creation when the client has no approved_at voice spec (hard stop).
- Kernel-host-unreachable is a hard, non-silent failure: a suite step that cannot reach a /content/api/* route surfaces a clear 'kernel host unreachable' error (naming the route + base URL) and stops — it never fabricates a brief/draft, never skips the gate, never silently no-ops (test).
- /content/api/brief blocks private/loopback/link-local IPs and non-http(s) schemes (SSRF test) and caps fetched content; fetched page text is treated as untrusted (never executed, never re-injected as a tool result verbatim into a privileged path).
- Source-quality layer: each brief.sources entry captures canonical URL + domain + fetched-at + an authority class — (a) medical/statistical authority, (b) client-fact authority (voice_specs.attributionSources[]), or (c) low-authority/unknown; robots.txt/ToS honored and near-duplicate/spam snippets filtered. A test asserts the class is assigned (a plain attributionSources[] entry classifies as (b), not (a)) and that duplicates are dropped.
- Neither a low-quality scraped DDG snippet NOR a client attributionSources[] entry can, by itself, satisfy a medical claim's sourcing: for an is_ymyl piece, a numeric/medical claim grounded only in a class-(b) or class-(c) source is treated as unsourced and does NOT clear VETO_UNSOURCED_STAT; only a class-(a) medical/statistical authority satisfies it (two tests assert the veto still fires; a class-(b) source still validly grounds a client-specific fact).
- Every /content/api/* call is keyed to exactly one (workspace_id, client_id); a cross-tenant call returns zero rows / 403.
- Each route's request/response JSON schema carries a contract version; a contract-version test asserts the worker (suite skills) and host agree on the schema version and fails the build on a mismatch.

**Test plan:**
- Tier 1 (preferred): Unit tests per route (audit read-only invariant, tenancy binding, SSRF guard, voice-spec hard stop, kernel-host-unreachable hard-stop) + the JSON-schema contract-version assertion.
- Tier 2 (local fallback): The content-route endpoints authenticate the worker and reject an unbound/cross-tenant context.
- Tier 3 (NEEDS-INPUT): none yet (no worker caller until PR 006).

**Rollback:** Remove the content-route contract + endpoints; no callers until PR 006.

**Resources:**

---

### PR P0.W.2 — PR 006 — Agent-SDK worker on Vercel Sandbox (the autonomous loop host)

- **Lane:** worker-runtime
- **Status:** NOT_STARTED
- **Risk:** High
- **Dependencies:** P0.E.4, P0.W.1
- **Spec section:** engineering-rfc.md:### PR 006
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md, plans/seo-creator/flywheel/prd.md, plans/seo-creator/DECISIONS.md

**Write scope (judge cross-checks):**
- `apps/seo/src/worker/agent-worker.ts`
- `apps/seo/src/worker/sandbox-launch.ts`
- `apps/seo/src/worker/host-tool-bridge.ts`
- `apps/seo/src/worker/session-store.ts`
- `apps/seo/src/worker/Dockerfile`
- `apps/seo/test/worker/session-store.test.ts`

**Acceptance criteria:**
- A Sandbox microVM provisions, runs the loop with the existing seo-blog-writer suite skill loaded (driving the /content/api/draft route — the thinnest-slice single-drafter path; the full chain wires in PR 014), and tears down; the run's session/agent state is fully reconstructable from Supabase after teardown (test reloads a persisted run).
- The worker's only mutation path is the host persistPiece tool; the Sandbox has no Supabase write credentials of its own (verified by attempting a direct write and asserting it fails).
- A worker run keyed to client A cannot call host tools bound to client B (the bearer token scopes one (workspace_id, client_id, run_id)).
- A wedged/timed-out Sandbox emits a terminal error event and releases its lease within the configured ceiling (no indefinite zombie microVM).
- A recycled warm-pool VM carries no prior-run residue: an idle pooled VM holds no tenant binding, and on lease handoff the working dir is wiped + the claude subprocess restarted. A test runs client A on a pooled VM, returns it, leases it for client B, and asserts client B cannot read client A's working-dir files or session state (cross-tenant compute-residue test).
- The Sandbox boots under a fail-closed capability profile (enforcing tests in PR 006b): network egress allowlisted to Claude API/Gateway + the apps/seo host-tool bridge URL only; the worker env carries no ambient secrets beyond the run-scoped bridge JWT; the claude subprocess's general-purpose shell/file/network tools are disabled or constrained to the working dir; the FS mount is the ephemeral working dir only. The bootstrap asserts this profile is applied and refuses to start the loop if any control is missing (fail-closed).

**Test plan:**
- Tier 1 (preferred): session-store round-trip unit test; tenancy-scoping of the host-tool bridge token; warm-VM working-dir-wipe-on-handoff assertion; capability-profile-applied assertion (refuses to boot if a control is absent).
- Tier 2 (local fallback): An integration run against a Sandbox that exercises one serpFetch->runScorers->runGate->persistPiece loop, plus a recycle-then-release residue check.
- Tier 3 (NEEDS-INPUT): Manual run in the Vercel Sandbox environment with a real brief, confirming microVM provision + teardown + Supabase state.

**Rollback:** Disable the worker behind a feature flag; apps/seo falls back to a 'worker offline' error state. Sandbox provisioning is per-run, so nothing leaks on revert.

**Resources:**

---

### PR P0.W.3 — PR 006b — Worker runtime capability-denial profile + adversarial confinement tests

- **Lane:** worker-runtime
- **Status:** NOT_STARTED
- **Risk:** High
- **Dependencies:** P0.W.2, P0.W.1
- **Spec section:** engineering-rfc.md:### PR 006b
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md, plans/seo-creator/flywheel/prd.md, plans/seo-creator/DECISIONS.md

**Write scope (judge cross-checks):**
- `apps/seo/src/worker/capability-profile.ts`
- `apps/seo/src/worker/sandbox-launch.ts`
- `apps/seo/test/worker/capability-denial.test.ts`
- `apps/seo/test/worker/egress-allowlist.test.ts`

**Acceptance criteria:**
- Network egress allowlist: the worker can reach only the Claude API/Gateway endpoint(s) and the apps/seo host-tool bridge URL; a direct connection to any other host (incl. 169.254.169.254 cloud metadata, a private range, or an arbitrary public host) is refused at the network layer, not just by tool absence. A test drives a curl/fetch from inside the worker to a non-allowlisted host and asserts it fails.
- No ambient secrets in the worker env: the worker env contains no Supabase service-role key, no provider API key, and no cloud credentials — only the per-run bridge JWT (scoped (workspace_id, client_id, run_id), expiring at the run-budget ceiling). A test enumerates the worker process env and asserts no secret-shaped value is present beyond the run JWT.
- Shell/file tools disabled or constrained: the claude subprocess's general-purpose Bash/file/web tools are disabled or constrained to the ephemeral working dir; the FS mount policy exposes only that working dir. A test asserts a tool-call to read outside the working dir or to a sibling run's path fails.
- Adversarial brief/prompt suite — all four attacks fail: a malicious brief and a malicious fetched-source string that instruct the agent to (a) raw-curl an external host, (b) dump environment variables, (c) read another run's working-dir files, and (d) write Supabase/the Claude API directly (bypassing persistPiece/the Gateway) are each blocked; the run continues to completion or terminates cleanly, and no attack succeeds. persistPiece and runGate remain the worker's only state-touching paths.
- Fail-closed bootstrap: if any capability control fails to apply, sandbox-launch refuses to start the loop rather than running with a weaker profile.

**Test plan:**
- Tier 1 (preferred): capability-profile unit tests (env scrub, allowlist construction, boot-refusal on missing control).
- Tier 2 (local fallback): capability-denial.test.ts runs the four adversarial attacks against a Sandbox worker and asserts each fails; egress-allowlist.test.ts asserts a non-allowlisted connection is refused.
- Tier 3 (NEEDS-INPUT): Manual run in the Vercel Sandbox with a deliberately hostile brief, confirming no egress / no env leak / no cross-run read.

**Rollback:** Tighten to a 'worker offline' state behind the PR 006 feature flag; the loop does not run without the profile applied (fail-closed by construction).

**Resources:**

---

### PR P0.W.4 — PR 007 — Worker <-> apps/seo SSE transport (the streaming hop)

- **Lane:** worker-runtime
- **Status:** NOT_STARTED
- **Risk:** Medium
- **Dependencies:** P0.W.2
- **Spec section:** engineering-rfc.md:### PR 007
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md, plans/seo-creator/flywheel/prd.md, plans/seo-creator/DECISIONS.md

**Write scope (judge cross-checks):**
- `apps/seo/src/app/api/run/route.ts`
- `apps/seo/src/lib/stream/sse-relay.ts`
- `apps/seo/src/lib/stream/event-taxonomy.ts`
- `apps/seo/src/worker/emit.ts`
- `apps/seo/test/stream/sse-relay.test.ts`

**Acceptance criteria:**
- POST /api/run streams >=1 token-delta event within 3s of dispatch and ultimately persists a content_piece row via persistPiece.
- Tool-use events arrive as stable taxonomy-coded rows (serpFetch, runFaithfulnessGate, runGate.stageA, runGate.stageB), never raw model prose re-piped into the loop.
- CostAccountant.reserve() runs pre-flight; a request over the per-run cap returns a cost error before any worker dispatch.
- A worker-side error surfaces as a terminal SSE error event with a stable code, not a hung stream (heartbeat/timeout enforced).
- On a last_event_id reconnect, the relay re-reads the persisted content_pieces + gate_results rows as the truth snapshot and resumes streaming only the deltas after the cursor — never replaying from worker memory; a test drops the stream mid-run and asserts the reconnect emits the persisted artifact + scorecard then resumes without duplication or loss.
- The worker->host bridge token is a per-run JWT minted by /api/run, scoped to exactly (workspace_id, client_id, run_id) and expiring at the run-budget ceiling (~90s); a test asserts an expired or cross-run token is rejected by every host tool.

**Test plan:**
- Tier 1 (preferred): sse-relay unit test (event ordering, heartbeat, terminal error, last_event_id truth-snapshot resume).
- Tier 2 (local fallback): Integration: POST /api/run -> worker -> SSE -> assert first delta < 3s + a persisted draft row.
- Tier 3 (NEEDS-INPUT): Manual run streamed to a curl client.

**Rollback:** Revert /api/run to a synchronous non-streamed error; disable relay. Worker stays behind its flag.

**Resources:**

---

### PR P0.W.5 — PR 008 — Wire the seo-blog-writer suite skill into the worker (single-drafter slice) + golden-set regression harness

- **Lane:** worker-runtime
- **Status:** NOT_STARTED
- **Risk:** Medium
- **Dependencies:** P0.W.4
- **Spec section:** engineering-rfc.md:### PR 008
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md

**Write scope (judge cross-checks):**
- `apps/seo/src/worker/skills/load-suite.ts`
- `apps/seo/golden/whispering-willows/pillar.json`
- `apps/seo/golden/whispering-willows/spoke-*.json`
- `apps/seo/golden/whispering-willows/faq.json`
- `apps/seo/golden/whispering-willows/checklist.json`
- `apps/seo/test/golden/regression.test.ts`
- `apps/seo/test/acceptance/gate-spec.ts`

**Acceptance criteria:**
- The golden corpus (pillar + ~8 spokes + homepage labels) is checked in with human labels before the suite skill is exercised against it.
- The worker loads the real seo-blog-writer SKILL.md (not a re-authored copy) and it drives the /content/api/draft route; a test asserts the skill orchestrates the kernel route rather than re-implementing scoring/persistence in markdown.
- Generating against the golden brief reproduces the expected Stage-A clean/veto for each golden piece (within the documented tolerance band on Stage-B dimensions).
- gate-spec.ts enumerates every Stage-A veto code and the Stage-B verdict bands (PUBLISH>=85 / REVIEW / REVISE / REJECT).
- A deliberately weakened skill-config/model variant regresses below tolerance and the harness fails (proving the tripwire catches methodology drift).
- Gate-adjudication protocol (PRD §4.4): a disputed gate result is recorded as a labeled {veto_code, claimed_outcome, resolution} row, and a unit test asserts a dispute does not flip the verdict to publishable — the only way to clear the veto is to fix the underlying evidence. The labeled disputes feed the per-veto-code false-positive/false-negative metric (PR 020).
- Medical/YMYL-detector change control: a CI guard flags any diff to the ymylSignals detector, the faithfulness check, or the YMYL byline/review vetoes as release-blocking (requires the golden-set re-regression to pass), so a medical-detector change cannot ship as a quiet config tweak.

**Test plan:**
- Tier 1 (preferred): gate-spec.ts band assertions.
- Tier 2 (local fallback): Golden regression run in CI against the labeled corpus (the methodology-fidelity tripwire).
- Tier 3 (NEEDS-INPUT): Manual side-by-side of one generated piece vs its golden reference.

**Rollback:** Unregister the suite skill from the worker; the harness + golden corpus stay (they are pure test infra).

**Resources:**

---

### PR P0.S.2 — PR 009 — Voice-spec hard stop + fail-closed publish endpoint (thinnest-slice close-out)

- **Lane:** schema-tenancy
- **Status:** NOT_STARTED
- **Risk:** Medium
- **Dependencies:** P0.W.5, P0.S.1
- **Spec section:** engineering-rfc.md:### PR 009
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md, plans/seo-creator/flywheel/prd.md, plans/seo-creator/DECISIONS.md

**Write scope (judge cross-checks):**
- `apps/seo/src/app/(studio)/voice/VoiceSpecEditor.tsx`
- `apps/seo/src/app/api/publish/route.ts`
- `apps/seo/src/lib/byline/resolve-author.ts`
- `apps/seo/src/lib/release/read-credentialed-release.ts`
- `apps/seo/src/lib/release/authorization-active.ts`
- `apps/seo/src/app/(studio)/DraftResult.tsx`
- `apps/seo/test/publish/can-publish.test.ts`

**Acceptance criteria:**
- Creating a piece for a client whose voice spec has approved_at IS NULL is refused with an explicit 'no approved voice spec' reason; the composer/route is disabled, not silently defaulted.
- POST /api/publish resolves the byline from content_pieces.author_id -> voice_specs.authors[] server-side; request.author is never trusted (test asserts a forged request.author is ignored).
- A YMYL piece cannot reach published unless verdict==='PUBLISH' AND evalRan AND a recorded human release (a credentialed_releases row, NOT a client_signoffs row) AND a named credentialed author + citations resolve; any failed precondition returns a stable FSM code.
- canPublish() reads credentialed_releases as the source of truth and a client_signoff can NEVER satisfy a YMYL release: a test seeds a piece with a client_signoff only and asserts canPublish() returns NO_HUMAN_RELEASE; a second seeds a credentialed_release (with credential snapshot + authorization_id) and asserts release is permitted and the byline resolves from that record.
- A PUBLISH verdict alone still leaves the piece at draft until a recorded credentialed_release exists (no autopilot).
- Fail-closed byline authorization (§11.5): a credentialed_release whose authorization_id resolves to a revoked (revoked_at set), expired (expires_at in the past), or otherwise inactive byline_authorizations row is rejected — publish is blocked (stable NO_HUMAN_RELEASE/authorization-inactive code), and the byline is never resolved from an inactive authorization. A test seeds (a) revoked, (b) expired, (c) inactive and asserts each blocks, while an active authorization permits it — fail-closed, never default-allow.

**Test plan:**
- Tier 1 (preferred): can-publish.test.ts truth table (incl. client_signoff-only ⇒ NO_HUMAN_RELEASE, credentialed_release ⇒ permitted, and the revoked/expired/inactive-authorization ⇒ blocked cases); voice-spec hard-stop unit test; byline-resolution test (forged author ignored, byline sourced from the credentialed_release credential snapshot).
- Tier 2 (local fallback): End-to-end: brief -> worker draft -> gate -> persist draft -> attempt publish -> blocked without a credentialed_release, allowed with one + credentialed author.
- Tier 3 (NEEDS-INPUT): Manual operator walk: generate a YMYL piece, watch a Stage-A veto block it with score=null, fix the brief, see it pass to Stage-B, confirm it still sits at draft until a credentialed release is recorded.

**Rollback:** Disable /api/publish (pieces stay at draft); revert the voice editor. Generation still works.

**Resources:**

---

## Phase 1 — Pilot


### PR P1.U.1 — PR 010 — Three-zone agent canvas shell (reuse the existing apps/agents StudioCanvas)

- **Lane:** agent-ui
- **Status:** NOT_STARTED
- **Risk:** Low
- **Dependencies:** P0.W.4
- **Spec section:** engineering-rfc.md:### PR 010
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md

**Write scope (judge cross-checks):**
- `apps/seo/src/app/(studio)/SeoStudioCanvas.tsx`
- `apps/seo/src/app/(studio)/agent/AgentPanel.tsx`
- `apps/seo/src/app/(studio)/agent/AgentMessageStream.tsx`
- `apps/seo/src/app/(studio)/agent/ThinkingDelta.tsx`
- `apps/seo/src/app/(studio)/agent/ToolUseRow.tsx`
- `apps/seo/src/app/(studio)/artifact/ArtifactZone.tsx`
- `apps/seo/src/app/(studio)/artifact/BriefCard.tsx`
- `apps/seo/src/app/(studio)/artifact/ModeTabs.tsx`
- `apps/seo/src/components/ScoreSignalDot.tsx`
- `apps/seo/src/lib/stream/use-ui-message-stream.ts`

**Acceptance criteria:**
- The canvas renders three zones; LEFT appends taxonomy-coded ToolUseRows (spinner->check) as SSE tool-use events arrive; thinking deltas render as muted italic rows.
- CENTER opens on an editable BriefCard (observed intent, clusterRole/funnelStage, entities, is_ymyl); body streaming is gated on the human approving the brief.
- ScoreSignalDot is a single shared component consumed by the canvas (the 4x duplication is removed).
- An SSR mount-guard protects any localStorage-touching component (no hydration mismatch).

**Test plan:**
- Tier 1 (preferred): Component unit/render tests (ToolUseRow states, BriefCard validation gating 'Generate').
- Tier 2 (local fallback): The canvas consumes a mocked SSE stream and renders the brief->generating->done state sequence.
- Tier 3 (NEEDS-INPUT): Manual: run a real brief and watch the canvas materialize.

**Rollback:** Route the studio path back to the PR 009 DraftResult operator view; remove the canvas shell.

**Resources:**

---

### PR P1.U.2 — PR 011 — Live token streaming into the center editor + Inspector gate scorecard

- **Lane:** agent-ui
- **Status:** NOT_STARTED
- **Risk:** Low
- **Dependencies:** P1.U.1
- **Spec section:** engineering-rfc.md:### PR 011
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md

**Write scope (judge cross-checks):**
- `apps/seo/src/app/(studio)/artifact/MarkdownEditor.tsx`
- `apps/seo/src/app/(studio)/inspector/InspectorPanel.tsx`
- `apps/seo/src/app/(studio)/inspector/GateScorecard.tsx`
- `apps/seo/src/app/(studio)/inspector/StageAVetoes.tsx`
- `apps/seo/src/app/(studio)/inspector/StageBBars.tsx`
- `apps/seo/src/app/(studio)/inspector/VerdictBand.tsx`
- `apps/seo/src/app/(studio)/inspector/PieceStatusRow.tsx`
- `apps/seo/src/app/(studio)/inspector/use-client-scorers.ts`

**Acceptance criteria:**
- The body types in live token-by-token via readUIMessageStream; the editor is read-only during generating and editable at done.
- When a Stage-A veto fired, the scorecard shows the specific veto chip, the composite reads score=null ('no composite — Stage-A veto'), and the verdict band reads REJECT/REVISE.
- When Stage-A is clean, 8 dimension bars render 0–100 with the verdict band (PUBLISH>=85 / REVIEW / REVISE / REJECT); faithfulness is visually weighted heaviest.
- Client-side deterministic scorers (flesch-kincaid, keyword-density, passive-voice) run via useMemo with zero LLM/credit cost for the live editor heuristics.

**Test plan:**
- Tier 1 (preferred): GateScorecard render tests (veto chips, score=null state, band thresholds).
- Tier 2 (local fallback): Stream a mocked generation and assert the editor materializes + the scorecard fills.
- Tier 3 (NEEDS-INPUT): Manual: generate a piece that trips a veto, confirm the chip + null composite render honestly.

**Rollback:** Render a static last-frame body + a plain verdict line instead of the live editor/scorecard.

**Resources:**

---

### PR P1.U.3 — PR 012 — Conversational fine-tune: /api/edit bounded diff + full gate re-run + versioning

- **Lane:** agent-ui
- **Status:** NOT_STARTED
- **Risk:** Medium
- **Dependencies:** P0.S.2, P1.U.2
- **Spec section:** engineering-rfc.md:### PR 012
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md, plans/seo-creator/flywheel/prd.md, plans/seo-creator/DECISIONS.md

**Write scope (judge cross-checks):**
- `apps/seo/src/app/api/edit/route.ts`
- `apps/seo/src/lib/edit/constrained-edit-contract.ts`
- `apps/seo/src/worker/prompts/seo-edit.system.md`
- `apps/seo/src/lib/edit/version-write.ts`
- `apps/seo/src/app/(studio)/agent/ActivityFeed.tsx`
- `apps/seo/test/edit/guards.test.ts`

**Acceptance criteria:**
- An accepted edit writes an append-only content_piece_versions snapshot, bumps version, and re-runs the full gate before the verdict updates.
- A fine-tune instruction that breaks faithfulness (or trips any Stage-A veto) is recorded as a version but the verdict gates release — it cannot advance toward publish (test: 'drop the citations' edit -> faithfulness veto -> blocked).
- SHA-256 stale-edit guard returns 409; per-tenant rate limit (30 auto-versions/hr) returns 429; workspace-ownership mismatch returns 403; missing key returns 503.
- No instruction text, LLM prose, or body is logged — only ids, counts, wall-clock (PII discipline test).

**Test plan:**
- Tier 1 (preferred): guards.test.ts (409/429/403/503 + PII discipline).
- Tier 2 (local fallback): End-to-end edit turn: instruction -> diff -> version -> re-gated verdict; a faithfulness-breaking edit is blocked.
- Tier 3 (NEEDS-INPUT): Manual: 'tighten the intro' lands a bounded diff + new version + re-run gate + summary.

**Rollback:** Disable /api/edit; pieces remain generate-only with no fine-tune.

**Resources:**

---

### PR P1.U.4 — PR 013 — Version hub: switch / name / compare + undeletable named sign-off

- **Lane:** agent-ui
- **Status:** NOT_STARTED
- **Risk:** Low
- **Dependencies:** P1.U.3
- **Spec section:** engineering-rfc.md:### PR 013
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md

**Write scope (judge cross-checks):**
- `apps/seo/src/app/(studio)/inspector/VersionHub.tsx`
- `apps/seo/src/app/(studio)/inspector/VersionDiff.tsx`
- `apps/seo/src/app/api/versions/[id]/route.ts`
- `apps/seo/test/versions/named-undeletable.test.ts`

**Acceptance criteria:**
- Every accepted edit appears as an auto=true version row (append-only, never destructive).
- 'Switch' restores a target version's body as a new auto-version (zero re-generate, fully reversible).
- 'Name' flips auto=false; a delete attempt on a named version returns 409 (API defends the invariant).
- VersionDiff renders before/after for any two versions ('what changed since your last review').

**Test plan:**
- Tier 1 (preferred): named-undeletable.test.ts (409 on named-delete, auto-vs-named invariant).
- Tier 2 (local fallback): Switch/restore round-trip writes a new auto-version.
- Tier 3 (NEEDS-INPUT): Manual diff walk.

**Rollback:** Hide the version hub; versions still persist (PR 012 writes them) but are not switchable in UI.

**Resources:**

---

### PR P1.W.1 — PR 014 — Wire the remaining three suite skills into the worker (strategist / assistant / audit) — the full chain

- **Lane:** worker-runtime
- **Status:** NOT_STARTED
- **Risk:** Medium
- **Dependencies:** P0.W.5
- **Spec section:** engineering-rfc.md:### PR 014
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md

**Write scope (judge cross-checks):**
- `apps/seo/src/worker/skills/load-suite.ts`
- `apps/seo/src/worker/loop/revise-cap.ts`
- `apps/seo/test/golden/suite-chain.test.ts`

**Acceptance criteria:**
- All four suite skills (the real SKILL.md files, run directly) pass golden regression within tolerance (extends PR 008's harness to the full chain) and each orchestrates its kernel route rather than re-implementing the kernel in markdown.
- The strategist emits an operator-approved ContentStrategy cluster map with explicit spoke->pillar link edges and per-spoke clusterRole/funnelStage (consumed by PR 017's homepage); roadmap items enter the chain at seo-assistant, not as off-strategy one-offs (absent a recorded operator override).
- The typed handoff chain holds end-to-end (ContentStrategy -> ContentBrief -> ContentDraft -> AuditResult); no stage is skipped and no artifact is fabricated for a missing stage.
- The 4th failed re-audit holds the piece at review (forcedToHumanReview) instead of looping forever.

**Test plan:**
- Tier 1 (preferred): revise-cap unit test (4th failure holds).
- Tier 2 (local fallback): suite-chain.test.ts golden regression across all four suite skills + typed-handoff assertions.
- Tier 3 (NEEDS-INPUT): Manual cluster generation producing a pillar + >=3 funnel-staged spokes from an approved strategy.

**Rollback:** Unregister the three suite skills; the writer-only path (PR 008) still functions.

**Resources:**

---

### PR P1.R.1 — PR 015 — Content-hub SSR render route + FAQ JSON-LD + placeholder stripping

- **Lane:** render-geo
- **Status:** NOT_STARTED
- **Risk:** Medium
- **Dependencies:** P0.S.2
- **Spec section:** engineering-rfc.md:### PR 015
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md, plans/seo-creator/flywheel/prd.md

**Write scope (judge cross-checks):**
- `apps/seo/src/app/clients/[client]/blog/[slug]/page.tsx`
- `apps/seo/src/lib/render/client-blog.ts`
- `apps/seo/src/lib/render/build-faq-jsonld.ts`
- `apps/seo/src/lib/render/resolve-placeholders.ts`
- `apps/seo/src/app/clients/[client]/sitemap.xml/route.ts`
- `apps/seo/src/app/clients/[client]/robots.txt/route.ts`
- `apps/seo/vitest.config.ts`
- `apps/seo/test/render/ssr-body.test.ts`
- `apps/seo/test/render/faq-jsonld.test.ts`
- `apps/seo/test/render/placeholder-strip.test.ts`
- `apps/seo/test/render/status-filter.test.ts`

**Acceptance criteria:**
- The full article body is present in the initial server HTML (no client-side fetch) — asserted by parsing the SSR response, not the hydrated DOM.
- faq_data emits valid schema.org FAQPage JSON-LD (schema-validated in test).
- Unresolved [photo:slug]/[cta:type] tokens are stripped, never leaked as literal text.
- A slug belonging to another client resolves to null and 404s; only status='published' rows render (cross-namespace + status-filter tests).

**Test plan:**
- Tier 1 (preferred): Render unit tests (body-in-HTML, JSON-LD validity, placeholder strip, 404 on cross-client slug).
- Tier 2 (local fallback): SSR response snapshot asserts body presence + JSON-LD block.
- Tier 3 (NEEDS-INPUT): Manual fetch of a published piece + curl of the JSON-LD.

**Rollback:** Route published pieces to a minimal body-only template; disable sitemap/robots routes.

**Resources:**

---

### PR P1.R.2 — PR 016 — CI reachability gate (sitemap == published-and-indexable set, both directions)

- **Lane:** render-geo
- **Status:** NOT_STARTED
- **Risk:** Low
- **Dependencies:** P1.R.1
- **Spec section:** engineering-rfc.md:### PR 016
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md

**Write scope (judge cross-checks):**
- `apps/seo/test/render/reachability-gate.test.ts`
- `apps/seo/src/lib/render/indexable-set.ts`
- `.github/workflows/seo.yml`

**Acceptance criteria:**
- A published piece missing from the sitemap fails the gate (orphan direction).
- A sitemap entry for a non-published/noindex piece fails the gate (stale direction).
- A noindex piece co-existing with a robots.txt Disallow on the same path fails a lint (the contradictory-signal guard).

**Test plan:**
- Tier 1 (preferred): Reachability unit test (both directions + the noindex/Disallow lint).
- Tier 2 (local fallback): The gate runs in CI against a seeded multi-piece fixture.
- Tier 3 (NEEDS-INPUT): Manual sitemap diff against the published set.

**Rollback:** Demote the gate to a warning; render still works.

**Resources:**

---

### PR P1.R.3 — PR 017 — Generated resource-library homepage (D7) + imagegen hero resolution

- **Lane:** render-geo
- **Status:** NOT_STARTED
- **Risk:** Medium
- **Dependencies:** P1.W.1, P1.R.1
- **Spec section:** engineering-rfc.md:### PR 017
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md, plans/seo-creator/flywheel/prd.md, plans/seo-creator/DECISIONS.md

**Write scope (judge cross-checks):**
- `apps/seo/src/app/clients/[client]/page.tsx`
- `apps/seo/src/lib/render/hub-homepage.ts`
- `apps/seo/src/lib/tools/hero-image.ts`
- `apps/seo/test/render/homepage.test.ts`
- `apps/seo/test/tools/hero-provenance.test.ts`

**Acceptance criteria:**
- The homepage queries pieces by client_id and groups them by funnel_stage with cluster_role labels (driven by the first-class columns, not brief_snapshot jsonb).
- Each spoke card links to its piece; the pillar links out to every spoke (no orphan spoke by construction).
- A generated hero image carries a recorded license/provenance record; an asset with no provenance is blocked from rendering.
- Only [photo:slug] placeholders with empty stock trigger generation; resolved placeholders pass through; image generation is async/job-wrapped (never synchronous blocking the render).

**Test plan:**
- Tier 1 (preferred): Homepage grouping + orphan-detection unit test; hero-provenance.test.ts (no-provenance asset blocked).
- Tier 2 (local fallback): Render the full Whispering Willows hub homepage from a seeded cluster.
- Tier 3 (NEEDS-INPUT): Manual visual diff of the generated homepage vs the golden demo.

**Rollback:** Serve a flat published-pieces list instead of the homepage; disable hero generation (placeholders strip).

**Resources:**

---

### PR P1.C.1 — PR 018 — Tokenized client-review preview + pinned comments + section verbs

- **Lane:** client-review
- **Status:** NOT_STARTED
- **Risk:** High
- **Dependencies:** P1.R.1, P1.R.3
- **Spec section:** engineering-rfc.md:### PR 018
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md, plans/seo-creator/flywheel/prd.md, plans/seo-creator/DECISIONS.md

**Write scope (judge cross-checks):**
- `apps/seo/src/app/review/[token]/page.tsx`
- `apps/seo/src/lib/review/resolve-token.ts`
- `apps/seo/src/app/review/[token]/PinOverlay.tsx`
- `apps/seo/src/app/review/[token]/PreviewClickHandler.tsx`
- `apps/seo/src/app/review/[token]/hooks/useIframePinDrop.ts`
- `apps/seo/src/app/review/[token]/SectionApprovalBeat.tsx`
- `apps/seo/src/app/review/[token]/SerpPreview.tsx`
- `apps/seo/src/app/api/review/comments/route.ts`
- `apps/seo/test/review/token-scope.test.ts`

**Acceptance criteria:**
- A review token grants read of exactly one (client_id, piece_id, version); a request for another client's piece or another version under the same token returns 404/zero rows (the agency-ending-leak test, both directions).
- The client surface never renders the gate scorecard, credits, cost, model, or raw markdown export (asserted absent in the rendered tree).
- A pinned comment persists with normalized 0..1 coords + elementHint + version_left_on, scoped by workspace_id/client_id; the iframe message is origin/source/finite-coord validated.
- Section Approve / Request-changes verbs persist a review_comments row with the correct kind (section-approve | request-changes); approval is recorded but does not itself release a YMYL piece.

**Test plan:**
- Tier 1 (preferred): token-scope.test.ts (one-tuple scope, cross-tenant/cross-version denial); client-surface-exposure test (no scorecard/credits leaked).
- Tier 2 (local fallback): Drop a pin via a validated iframe message and assert the persisted anchor.
- Tier 3 (NEEDS-INPUT): Manual: open a review token, pin a comment, approve a section.

**Rollback:** Disable the /review/[token] route; clients review over a shared screen with the operator instead.

**Resources:**

---

### PR P1.C.2 — PR 019 — "Request changes" -> agent edit loop routing + named sign-off + approval-debt KPI

- **Lane:** client-review
- **Status:** NOT_STARTED
- **Risk:** Medium
- **Dependencies:** P1.U.3, P1.C.1, P0.S.1, P0.S.2
- **Spec section:** engineering-rfc.md:### PR 019
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md, plans/seo-creator/flywheel/prd.md, plans/seo-creator/DECISIONS.md

**Write scope (judge cross-checks):**
- `apps/seo/src/app/api/review/route-to-edit/route.ts`
- `apps/seo/src/lib/review/comment-to-instruction.ts`
- `apps/seo/src/lib/review/signoff.ts`
- `apps/seo/src/lib/metrics/approval-debt.ts`
- `apps/seo/src/app/(studio)/inspector/ApprovalDebtPanel.tsx`
- `apps/seo/test/review/route-to-edit.test.ts`

**Acceptance criteria:**
- A 'Request changes' comment, once an operator triages it, becomes a bounded /api/edit instruction anchored to the commented region; the comment thread updates to 'addressed in vN — see diff.'
- client_signoffs and credentialed_releases are separate persisted tables (PR 004 0032) with separate actors, permissions, timestamps, and UI labels. A client 'Approve' writes only a client_signoffs row (advisory) and can NEVER release or supply reviewer credentials — canPublish() reads credentialed_releases as the source of truth and accepts only a credentialed_release as the human release for a YMYL piece (test asserts a client_signoffs row alone leaves the piece unreleasable and never populates the byline).
- Only a credentialed_releases row (by the credentialed reviewer, D6) writes the named, undeletable release version recording the reviewer's identity + credential snapshot + authorization_id; that record is the sole source of the YMYL 'Reviewed by [Name, Credential]' byline — a client_signoffs row carries no credential/authorization_id and is structurally incapable of supplying reviewer credentials.
- The release write requires an active byline authorization (§11.5, fail-closed): signoff.ts writes a credentialed_releases row only when its authorization_id resolves to an active byline_authorizations row (granted, not revoked, not expired); an attempt to release against a revoked/expired/inactive authorization is refused (no release written, publish stays blocked) — a test asserts the three inactive cases are blocked at write time and an active one succeeds.
- Approval-cycle time (link-sent -> client_signoffs row, and draft->review -> credentialed_releases row) and open-thread count are computed per client and surfaced in the operator panel.

**Test plan:**
- Tier 1 (preferred): comment-to-instruction scoping test; client-approve-does-not-release test; approval-debt computation test.
- Tier 2 (local fallback): End-to-end: client requests changes -> operator routes -> agent edits -> new re-gated version -> thread resolves.
- Tier 3 (NEEDS-INPUT): Manual full review cycle on a Whispering Willows piece.

**Rollback:** Disable routing (comments stay advisory); operators apply edits manually via the studio canvas.

**Resources:**

---

### PR P1.C.3 — PR 020 — Separate SEO cost ledger (AI Gateway) + share-of-model instrumentation

- **Lane:** client-review
- **Status:** NOT_STARTED
- **Risk:** Medium
- **Dependencies:** P0.W.4, P1.R.1, P0.W.3
- **Spec section:** engineering-rfc.md:### PR 020
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md, plans/seo-creator/flywheel/prd.md, plans/seo-creator/DECISIONS.md

**Write scope (judge cross-checks):**
- `apps/seo/src/lib/ledger/seo-cost-ledger.ts`
- `apps/seo/src/lib/ledger/reserve-conditional.ts`
- `packages/schema-flywheel/drizzle/0033_seo_cost_ledger.sql`
- `apps/seo/src/lib/metrics/share-of-model.ts`
- `apps/seo/src/app/(studio)/inspector/CostLedgerPanel.tsx`
- `apps/seo/test/ledger/reserve.test.ts`

**Acceptance criteria:**
- Cost is reserved pre-flight via a lock-row conditional UPDATE (a concurrent over-cap run is rejected, not silently over-spent) — concurrency test.
- Per-stage actual_usd + latency_ms are recorded from Gateway usage; a per-piece cost is measured (not estimated) and compared against the <=$2 target.
- Gateway-disabled ⇒ no model call: a worker run launched with the Gateway base URL absent/disabled (and no fallback provider key) makes zero model calls — it fails fast with a stable 'no model seam' error, and a network attempt to the raw Anthropic endpoint is refused by the PR 006b egress allowlist (test).
- Per-run reconciliation: the ledger's per-run_id token/cost records reconcile against the Gateway's reported usage for that run (within tolerance); an unreconciled gap (a call that escaped the seam) fails the check.
- The gate-block-by-sourcing rate (VETO_UNSOURCED_STAT + low-faithfulness-from-thin-sources share) is computed — the D3 reversal trigger (instrumenting the D2xD3 tension).
- Share-of-model citation checks persist per (client_id, engine, query) and roll up to a per-hub citation rate.

**Test plan:**
- Tier 1 (preferred): reserve.test.ts (conditional-UPDATE concurrency, over-cap rejection); sourcing-block-rate computation test.
- Tier 2 (local fallback): A full run writes per-stage ledger rows summing to a measured per-piece cost.
- Tier 3 (NEEDS-INPUT): Manual: run a cluster, read the measured cost-per-piece and the gate-block-by-sourcing rate from the ledger.

**Rollback:** Drop 0033; fall back to CostAccountant in-memory reservation only (no persisted ledger, no share-of-model rollup).

**Resources:**

---

### PR P1.C.4 — PR 021 — Share-of-model citation-ingestion cron + freshness cron (the north-star feed)

- **Lane:** client-review
- **Status:** NOT_STARTED
- **Risk:** Medium
- **Dependencies:** P1.C.3, P1.R.3
- **Spec section:** engineering-rfc.md:### PR 021
- **Anchors honored:** plans/seo-creator/flywheel/engineering-rfc.md, plans/seo-creator/flywheel/prd.md, plans/seo-creator/DECISIONS.md

**Write scope (judge cross-checks):**
- `apps/seo/src/cron/ingest-share-of-model.ts`
- `apps/seo/src/cron/freshness-scan.ts`
- `apps/seo/src/lib/metrics/query-bank.ts`
- `apps/seo/src/lib/metrics/som-adapters/chatgpt.ts`
- `apps/seo/src/lib/metrics/som-adapters/perplexity.ts`
- `apps/seo/src/lib/metrics/som-adapters/claude.ts`
- `apps/seo/src/lib/metrics/som-adapters/google-aio.ts`
- `apps/seo/src/lib/metrics/som-adapters/types.ts`
- `apps/seo/src/lib/metrics/som-parse.ts`
- `apps/seo/vercel.json`
- `apps/seo/test/cron/som-ingest.test.ts`
- `apps/seo/test/cron/freshness.test.ts`
- `apps/seo/test/metrics/som-adapters.test.ts`

**Acceptance criteria:**
- Measurement-feasibility spike FIRST (gates the rest of this PR): before building the adapters, a feasibility spike proves >=3 legal/reliable citation-measurement channels actually exist — naming candidate sanctioned APIs/providers per engine and recording, for each, its quota and per-run cost. The spike output is a one-page channel matrix {engine, channel, sanctioned?, quota, per-run $, citation-signal reliability}. If fewer than 3 engines expose a legal/reliable channel, the degraded v1 metric ships instead.
- Gated on real credentials / a contracted vendor, not mocks: PR 021's DoD is auditable rows landing from real adapter credentials or a contracted measurement vendor for the channels the spike confirmed — a fully-mocked adapter suite is not sufficient to close this PR (mocks remain valid for Tier-1/Tier-2 tests).
- Degraded v1 metric defined: if only 1–2 engines expose reliable citation behavior, share-of-model ships as a single-/dual-engine metric explicitly labeled as such (rows record which engines are covered; per-hub rate qualified 'citation rate across {covered engines}', never reported as universal), and uncovered engines are recorded as a known gap with their blocking reason.
- The SoM ingestion cron poses the per-client query bank to >=3 answer engines (or the degraded set) via provider-specific adapters and populates share_of_model with {client_id, piece_id, engine, query, cited, position, captured_at} durable rows plus the stored normalized prompt + raw response + parser-confidence + locale/device profile.
- Each adapter honors a per-engine rate-limit budget and ToS; an over-budget or ToS-restricted engine falls back to the sanctioned vendor API (or logs a heartbeat miss) behind the same interface, never crashing the cron or scraping past a ban.
- Queries are normalized before probing so week-over-week trends compare like-for-like; a sampled fraction of citations is flagged for manual audit and parser confidence is recorded per row.
- Share-of-model is a derived ratio (citations won / queries posed) trendable per client and per piece off the persisted rows, qualified by the recorded geo/device profile.
- The freshness cron emits a refresh draft for a stale published piece and never flips a row to published — the refreshed draft re-runs the full gate and still requires a recorded human release.
- Both crons emit a heartbeat; a missed heartbeat raises an alert (no silent stall).

**Test plan:**
- Tier 1 (preferred): query-bank construction + prompt-normalization + per-adapter parse/confidence unit tests; rate-limit-budget + ToS-fallback unit test; share_of_model row-write (incl. stored prompt/response) test; freshness-cron emits-draft-never-publishes test.
- Tier 2 (local fallback): A scheduled run populates share_of_model against a mocked multi-engine set (one engine forced to its API fallback) and a per-hub citation rate rolls up.
- Tier 3 (NEEDS-INPUT): Manual cron trigger reading real citation rows + a manual-audit spot-check of stored prompts/responses for the Whispering Willows hub.

**Rollback:** Disable both crons (no share_of_model ingestion, no freshness drafts); the rest of the build is unaffected.

**Resources:**

---


## Status legend

See `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/STATE.md` §"Status legend" for the canonical state machine.

## Adding a new PR (between runs)

1. Append a row in the appropriate phase section above
2. Update `dependencies[]` to reference existing PRs by ID
3. Validate the dependency DAG by running `/seo-creator-build status` — should report the new PR as `NOT_STARTED` and either `eligible` or `blocked-on-<deps>`
4. If this PR is a correction (`C.NNN.X`) or audit-finding (`A.NNN.X`), note the origin in the PR's notes

## When a PR is MERGED

The orchestrator updates `status` to MERGED with the run number + commit SHA + PR URL. The row becomes append-only — no further edits to `write_scope` or `acceptance_criteria`.
