# Engineering RFC — SEO Creator

> **Status:** Final v1 · **Companion to:** SEO Creator PRD (same date) · **Date:** 2026-06-25
> **Manifest:** `C:/Users/stone/Code/sagemark/plans/seo-creator/flywheel/flywheel.manifest.json`
> **Authority:** This RFC honors `DECISIONS.md` (D1–D9) over the analysis docs 00–06 wherever they conflict. In particular D5/D9 **override** the docs' recommended in-process AI SDK runtime: the autonomous loop runs in a **self-hosted Claude Agent SDK worker on Vercel Sandbox**, and `apps/seo` is a thin UI + orchestration API. Every reuse claim ("ported from origin/preview") is preserved verbatim from the docs.

---

## 1 · Goal & non-goals

**Goal (engineering specificity).** Stand up `apps/seo` (Next.js 16 / React 19 / Tailwind v4, pnpm+turbo) as a thin orchestration + UI tier, plus a long-lived **Claude Agent SDK worker on Vercel Sandbox**, that together produce and govern a Whispering-Willows-grade SEO/GEO **content hub** (one pillar + ~8 funnel-staged E-E-A-T guides + a generated resource-library homepage). The autonomous loop self-directs `brief → fetch → outline → draft → verify → revise → gate` (D1); the deterministic engine — 22 scorers, cross-model faithfulness gate, non-compensatory `seo-gate`, fail-closed `lifecycle-fsm`, `content_pieces` schema, `voice-spec-*` — is **ported verbatim from flywheel-main origin/preview (PRs #1668–1684)** into `@sagemark/core` and exposed to the worker as **host-side tools the agent cannot reason past** (D2). All durable state lives in Supabase; the Sandbox is compute-only (D9).

**In-scope v1 (Phases 0–3, pilot-ready):**
- `@sagemark/core` port: scorers, faithfulness gate (`drafter ≠ verifier` invariant), `seo-gate` Stage-A→Stage-B, `lifecycle-fsm` `canPublish()`, `CostAccountant`, provider seam.
- Schema port `0030_content_pieces` + additive `0031` promoting `clusterRole`/`funnelStage` to first-class columns (D7); per-tenant `workspace_id`+`client_id` with fail-closed RLS.
- Agent-SDK worker on Vercel Sandbox running the autonomous loop, calling host-side tools (`runScorers`, `runGate`, `serpFetch`, `persistPiece`, `heroImage`) over an authenticated tool bridge.
- SSE relay worker → `apps/seo` → browser three-zone canvas (Agent | editor | Inspector).
- SSR render surface (`/clients/[client]/blog/[slug]` + sitemap/robots + FAQPage JSON-LD) and the **generated hub homepage** (D7).
- Conversational fine-tune (bounded body diff, full gate re-run), tokenized fail-closed client-review preview (D8), server-resolved YMYL byline.

**Explicit non-goals (v1):**
- **No autopilot publish.** Publish is always a recorded human release; `canPublish()` gates it (D2). No scheduled auto-publish; the Phase-4 freshness cron emits drafts only.
- **No funding a SERP/retrieval API.** D3 keeps free DuckDuckGo scraping; the D2×D3 sourcing-block rate is instrumented as the reversal trigger, not pre-funded.
- **No Managed Agents beta / no Anthropic-only lock-in assumptions.** The SDK worker is self-hosted (D5); the loop must tolerate a Bedrock-routed model.
- **No file-export critical path.** The deliverable is the rendered hub; markdown/HTML/print are secondary surfaces.
- **No brochure site, no per-piece PDF artifact type, no CMS write-back** in v1.
- **No second deploy target beyond `apps/seo` + the Sandbox worker.** Imagegen is an in-process function call, never an HTTP service.

**Performance budgets (hard caps unless flagged soft):**

| Budget | Target | Enforcement |
|---|---|---|
| First-token stream latency (operator submit → first SSE delta in browser) | **≤ 4 s p95** (worker cold-start amortized via warm-pool, §7) | SSE relay timestamp + worker boot probe; cold-start excluded from p95 only if warm-pool hit |
| Full single-piece generation (brief → gated `draft`) | **≤ 90 s p95**, ≤ 180 s p99 | per-stage latency in the cost ledger; `DurableAgent`/checkpoint if a stage outgrows it |
| Cost-per-piece (editorial, ex-imagery) | **≤ $2.00 hard cap** | `CostAccountant.reserve()` pre-flight; fail-closed `CostCapExceededError` aborts the run |
| Gate latency (full Stage-A + Stage-B as a tool call) | **≤ 15 s p95** (faithfulness 12 s timeout + 25-claim cap is the floor) | gate-as-tool span metric; a timed-out faithfulness gate is a **hard block** for YMYL, never a pass |
| Fine-tune turn (instruction → diff → re-gate → version) | **≤ 30 s p95** | edit-route span; SHA-256 stale-guard 409 / rate-limit 429 enforced before work |

*References: ch. 01 (bible v1.0.0, sha: 2c02fe80), ch. 09 (bible v1.0.0, sha: 2c02fe80)*

---

## 2 · Architecture overview

```
 ┌──────────────────────────────────────────────────────────────────────────────────────┐
 │ BROWSER  — three-zone canvas (Next 16 / React 19 / Tailwind v4)                        │
 │   LEFT: Agent chat (token deltas + tool-use traces)                                    │
 │   CENTER: markdown editor ⇄ SSR preview     RIGHT: Inspector (Stage-A chips, B bars)   │
 └───────────────────────────────┬───────────────────────────────▲────────────────────────┘
                                  │ POST /api/run·/api/edit·/api/publish   │ SSE (token deltas,
                                  ▼ (auth → workspace → client RLS)        │ tool events, scorecard)
 ┌──────────────────────────────────────────────────────────────────────┴────────────────┐
 │ apps/seo  ON VERCEL  — THIN UI + ORCHESTRATION API (Node/Fluid routes)                  │
 │   • authenticates, resolves workspace_id/client_id, reserves cost pre-flight            │
 │   • dispatches a RUN to the worker; holds the SSE relay (worker events → browser)       │
 │   • exposes HOST-SIDE TOOLS over an authed tool-bridge (the worker calls back in)        │
 └───────┬───────────────────────────────────────────────▲────────────────────────────────┘
         │ start run (run_id, brief, scoped ctx)          │ tool calls: runGate / runScorers /
         ▼  + stream worker events                        │ serpFetch / persistPiece / heroImage
 ┌──────────────────────────────────────────────────────────────────────────────────────┐
 │ AGENT-SDK WORKER  ON VERCEL SANDBOX  (ephemeral Firecracker microVM, D9)               │
 │   @anthropic-ai/claude-agent-sdk → spawns `claude` CLI subprocess (long-lived loop)    │
 │   autonomous loop (D1): brief→fetch→outline→draft→verify→revise→gate                    │
 │   RUNS the existing 4-skill seo-copywriter suite DIRECTLY:                               │
 │   seo-strategist→seo-assistant→seo-blog-writer→seo-audit (real SKILL.md, not re-authored)│
 │   kernel-backed via apps/seo /content/api/{brief,draft,audit,publish}; +hooks +compaction│
 │   ── NO durable state on the Sandbox FS; everything persists via host tools ──          │
 └───────┬──────────────────────────────────────┬─────────────────────────────────────────┘
         │ model calls                           │ DDG HTML fetch (D3, SSRF-guarded host tool)
         ▼                                       ▼
 ┌────────────────────────┐          ┌────────────────────────┐
 │ Claude API / Gateway   │          │ DuckDuckGo (3 pages ×   │
 │ sonnet-4-6 drafter     │          │ 2000 chars) → grounding │
 │ haiku-4-5 faithfulness │          └────────────────────────┘
 │ opus-4-7 judge         │
 └────────────────────────┘
                                  ┌──────────────────────────────────────────────┐
 host tools (runGate/persist) ───▶│ @sagemark/core (HOST-SIDE, agent-unreachable)  │
                                  │  22 scorers · faithfulness gate (sonnet≠haiku) │
                                  │  seo-gate A→B · lifecycle-fsm canPublish()      │
                                  │  CostAccountant · resolveGatewayModel           │
                                  └───────────────────────┬────────────────────────┘
                                                          ▼
                                  ┌──────────────────────────────────────────────┐
                                  │ Supabase Postgres (RLS workspace+client)       │
                                  │ content_clients · content_pieces(+cluster/    │
                                  │ funnel) · content_piece_versions · voice_specs │
                                  │ comment_threads · seo_cost_ledger ·             │
                                  │ seo_cost_run_budget · share_of_model            │
                                  │ (gate_results = seam projection, no table)      │
                                  │                   ── SYSTEM OF RECORD ──        │
                                  └───────────────────────┬────────────────────────┘
                                          status='published'│  (in-process call, not HTTP)
                                                          ▼  ┌────────────────────────────┐
                                  apps/seo SSR   ◀───────────│ packages/videogen/imagegen │
                                  /clients/[client]/blog/... │ hero images (async/job) +  │
                                  + generated hub homepage   │ license/provenance record  │
                                  + sitemap/robots/JSON-LD   └────────────────────────────┘
```

**Narrative.** The operator works in a three-zone canvas served by `apps/seo` on Vercel. Submitting/refining a typed **brief** is the load-bearing human checkpoint — get the brief right and the draft is bookkeeping. `apps/seo` authenticates the request, resolves `workspace_id`/`client_id`, reserves cost via `CostAccountant`, and **dispatches a run to the Agent-SDK worker** running on a Vercel Sandbox microVM (D5/D9). The worker — the real Claude Code harness as a library — **loads and runs the existing four-skill `seo-copywriter` suite directly** (`seo-strategist` → `seo-assistant` → `seo-blog-writer` → `seo-audit`, the real `SKILL.md` skills, **not re-authored prompts**) and runs the autonomous loop (D1): it self-directs fetching grounding sources, outlining, grounded drafting, self-checking faithfulness, and revising. The skills are **kernel-backed**: each orchestrates the content kernel via the `apps/seo` HTTP routes `/content/api/{brief,draft,audit,publish}` (backed by the ported `seo-gate` / `lifecycle-fsm` / `content-store` / scorers). The worker holds **no durable state**: every read/write goes back through these host-side content routes over an authenticated tool bridge — they *are* the host-side tools the worker exposes to the agent, which is how the gate stays host-enforced (the agent can reach publish only through the fail-closed `/content/api/{audit,publish}` routes). Stage-A vetoes and `canPublish()` execute in `@sagemark/core` host code behind those routes **the agent can never reason past** (D2). A kernel-backed step that cannot reach the `apps/seo` host **stops with a hard `kernel host unreachable` error** (naming route + base URL) — never a fabricated brief/draft, never a skipped gate. The worker emits SDK events; `apps/seo` relays them to the browser as SSE, spanning the worker→Vercel→browser hop. On a recorded human release that satisfies `canPublish()`, the row flips to `published` and the `apps/seo` SSR routes render the crawlable piece + the generated hub homepage. Because the Sandbox is ephemeral, Supabase is the only system of record — a microVM dying mid-run loses no committed state and a run is resumable from the last persisted snapshot.

**Key technical decisions.**

| Concern | Choice | Why (per PRD §4.1) |
|---|---|---|
| Runtime | **Claude Agent SDK self-hosted worker on Vercel Sandbox** (D5/D9), **running the existing four-skill `seo-copywriter` suite directly** | D5 override: keep the real harness (loop + subagents + hooks + skills). The worker **loads and runs the real `seo-strategist`/`seo-assistant`/`seo-blog-writer`/`seo-audit` `SKILL.md` skills** — not re-authored prompts — kernel-backed via the `apps/seo` `/content/api/{brief,draft,audit,publish}` routes. The SDK spawns a `claude` CLI subprocess and is non-serverless, so it cannot run in a Vercel function — it gets its own Sandbox microVM. *ch. 01* |
| Kernel contract | **`apps/seo` stands up the `/content/api/{brief,draft,audit,publish}` route contract** (ported `seo-gate`/`lifecycle-fsm`/`content-store`/scorers behind it); the worker's **kernel-host base URL points at `apps/seo`** | The suite skills orchestrate these routes — they never re-implement the gate/FSM/persistence in markdown ("the agentic path and the operator-console path must never fork"). The content routes are the host-side tools the worker exposes; kernel-host-unreachable is a hard, non-silent failure. *ch. 14, ch. 16* |
| Model | Claude via the Agent SDK; `resolveGatewayModel()` seam. **The direct-Anthropic BYOK branch is host/non-worker-only** — the SEO Creator *worker runtime* always routes through the metered Gateway and never holds a raw provider key (the BYOK branch exists for host/CI contexts only, or is removed from the worker path; a CI assertion (PR 001) fails the build if any worker env/config carries a raw Anthropic endpoint + provider key). `sonnet-4-6` drafter / `haiku-4-5` faithfulness verifier / `opus-4-7` judge; `drafter ≠ verifier` is a config invariant. **Control point:** the seam is the worker's *injected* model config — `/api/run` provisions the Sandbox with the Gateway base URL + per-run bridge JWT as the worker's only model credential (no raw provider key), so the SDK's own model calls can only exit through the metered Gateway, enforced by the §3.4-layer-5 / capability egress allowlist (PR 006b), not by a code path the worker chooses | Cross-model faithfulness, not self-consistency; every model call is accounted because the worker has no un-metered egress. *ch. 02, ch. 16* |
| Storage | Supabase Postgres + Drizzle (`@sagemark/core` writes, RLS-scoped). Sandbox FS is scratch-only | Ephemeral compute ⇒ Supabase is the system of record (D9). *ch. 09* |
| Queue / transport | Synchronous run-dispatch + **SSE relay** (worker SDK events → `apps/seo` → browser). Tool calls flow worker→host over an authed bridge | Streaming spans a hop the docs' in-process design didn't (D5 consequence). *ch. 13* |
| Observability | AI-Gateway **cost ledger** (per-stage cost/latency) + **gate metrics** (Stage-A block reasons, Stage-B distribution, sourcing-block rate for the D3 trigger) | Margin input + the D2×D3 reversal signal. *ch. 13, ch. 17* |

*References: ch. 01 (bible v1.0.0, sha: 2c02fe80), ch. 06 (bible v1.0.0, sha: 2c02fe80), ch. 13 (bible v1.0.0, sha: 2c02fe80)*

---

## 3 · Data model

### 3.1 Tables

All tables carry `workspace_id` + `client_id` and run under **fail-closed RLS**: the only anon policy anywhere is `content_pieces_public_read` (`FOR SELECT TO anon USING (status='published')`). Everything else (drafts, scorecards, voice, comments, cost, metrics, and the `client_signoffs` / `credentialed_releases` / `byline_authorizations` release/authorization records) has **no anon policy at all**; operator access is service-role scoped in application code.

| Table | Role | Key columns | Indices |
|---|---|---|---|
| `content_clients` | tenant root (≠ accounting `clients`) | `id`, `name`, `blog_slug` UNIQUE, `workspace_id` | UNIQUE(`blog_slug`); idx(`workspace_id`) |
| `content_pieces` | the artifact unit | `id`, `client_id` FK ON DELETE RESTRICT, `slug`, `title`, `body` md, `excerpt`, `meta_description`, `status` (draft·review·approved·published·archived), `version`, `is_ymyl`, `author_id`, `eval_score` (null on Stage-A veto), `verdict` (PUBLISH·REVIEW·REVISE·REJECT), `dimensions` jsonb, `faq_data` jsonb, `brief_snapshot` jsonb, `published_at`, **`cluster_role`** (pillar·cornerstone·spoke·faq·checklist), **`funnel_stage`** (awareness·consideration·decision·retention) | UNIQUE(`client_id`,`slug`); idx(`client_id`,`status`); idx(`client_id`,`cluster_role`); idx(`client_id`,`funnel_stage`) |
| `content_piece_versions` | immutable forward-move snapshots | `piece_id`, `client_id` (denormalized for future tenant-RLS), `version`, `body`, `dimensions`, `verdict`, `snapshot_at` | idx(`piece_id`,`version`) UNIQUE |
| `client_signoffs` | **advisory** client/agency-contact approval (never a release) | `id`, `piece_id`, `client_id`, `version`, `release_type` const `'client_signoff'`, `actor_id` (the client/agency contact), `release_scope` (piece·section), `released_at`; **no `credential`, no `authorization_id`** (structurally cannot release or supply a byline) | idx(`piece_id`,`version`); idx(`client_id`) |
| `credentialed_releases` | the **only** record that satisfies `canPublish()`'s human-release precondition (D6 credentialed reviewer) | `id`, `piece_id`, `client_id`, `version`, `release_type` const `'credentialed_release'`, `actor_id` (the credentialed reviewer), `credential` jsonb (snapshot of `{name, credentials}` at release — the "Reviewed by [Name, Credential]" byline evidence), `authorization_id` **FK → `byline_authorizations`** (the §11.5 record), `release_scope`, `released_at` | idx(`piece_id`,`version`) UNIQUE; idx(`client_id`); idx(`authorization_id`) |
| `byline_authorizations` | the first-class consent/authorization record backing every published byline (§11.5) — a clinician/author is attachable only while an **active** authorization exists | `id`, `client_id` FK content_clients (tenant-scoped) ON DELETE RESTRICT, `author_id` (→ `voice_specs.authors[]` entry), `credential` jsonb (snapshot of `{name, credentials}` at grant), `scope` (client·cluster·piece), `granted_at`, `expires_at` (nullable), `revoked_at` (nullable), `authorized_by` (operator). A missing/revoked/expired authorization blocks the credentialed release (and thus publish). | idx(`client_id`); idx(`author_id`); idx(`client_id`,`revoked_at`,`expires_at`) — active-authorization lookup |
| `voice_specs` | per-client approved voice + author registry | `client_id`, `spec` jsonb (`tone[]`, `bannedLexicon[]`, `authors[]`=`{id,name,credentials}`, `attributionSources[]`, `samplePassages[]`, `pillarLinks[]`, `internalLinks[]`), `approved_at` (NULL = draft = HARD STOP) | idx(`client_id`) where `approved_at IS NOT NULL` |
| `gate_results` | **SEAM PROJECTION in v1 — NOT a persisted table** ([[DR-039]], reconciled to shipped reality per audit-005). The D3 gate-block-by-sourcing reversal metric is computed from existing gate-result data through the data-access seam (`getGateResult` → `PersistedGateResult.sourcingBlocked`, `src/lib/content/context.ts`); the `0039` migration adds NO `gate_results` table. **Revisit if a queryable audit row becomes required** (e.g. cross-run sourcing-veto analytics) — the column set below is the deferred design. | (projection) `piece_id`, `client_id`, `version`, `stage_a_veto_code`, `stage_b_score` (null on veto), `verdict`, `eval_ran`, `sourcing_blocked` | — (no table; metric computed at the seam) |
| `comment_threads` | client review (pin threads + section verbs) | `id`, `piece_id`, `version`, `client_id`, `anchor` (normalized 0..1 + `elementHint`), `body`, `author`, `status` (open·resolved), `kind` (pin·section-approve·request-changes) | idx(`piece_id`,`version`,`status`) |
| `seo_cost_ledger` | separate SEO AI-Gateway ledger (D4); one row per (`run_id`,`stage`), `reserved_usd` written pre-flight then reconciled with the Gateway-reported `actual_usd`+`latency_ms`+`model` | `id`, `run_id`, `client_id`, `stage`, `model`, `reserved_usd`, `actual_usd`, `latency_ms`, `created_at` | idx(`client_id`,`created_at`); idx(`run_id`) |
| `seo_cost_run_budget` | **per-run accumulator / conditional-UPDATE lock-row** — the single row the reservation SQL targets (one per `run_id`); `reserved_usd` is atomically incremented under the DB row lock with the `reserved_usd + cost <= cap_usd` guard, so a concurrent over-cap reservation is rejected by the predicate (no sum-then-check race). **This accumulator is what makes the AC1 atomicity guarantee runnable on the live schema** (not just the in-memory model). | `id`, `run_id` UNIQUE, `client_id`, `cap_usd`, `reserved_usd` | UNIQUE(`run_id`) |
| `share_of_model` | north-star share-of-model / citation telemetry (a measurement subsystem — PR 021) | `id`, `client_id`, `piece_id` nullable, `engine` free-text (chatgpt·claude·gemini — [[DR-038]], reconciled to shipped reality per audit-005; Perplexity = deferred 4th, Gemini-via-Gateway replaces google-aio), `query` (normalized prompt), `cited` bool, `position` int nullable, `raw_response`, `parser_conf`, `audit_sampled` bool, **`source_channel`** (HYBRID 3-channel set per [[DR-038]] addendum: `direct-citation`·`direct-proxy`·`vendor`), `locale`, `device_profile`, `captured_at`. **Load-bearing reporting rule (proxy ≠ citation):** `direct-citation` (Claude + web-search tool → a REAL cited source) and `vendor` (contracted GEO-tracker, deferred) are summable as a **citation rate**; `direct-proxy` (ChatGPT/Gemini model-API answer) is a **model-answer MENTION only**, rolled up as **"API-answer mention rate (proxy)"** and **NEVER summed as a citation**. Column is free-text + defaults `'direct'` (legacy sentinel); the live store writes the hybrid labels. | idx(`client_id`,`engine`,`captured_at`) |

### 3.2 Relationships

```
workspaces (apps/agents convention)
   └─1:N─ content_clients
            ├─1:1─ voice_specs            (approved_at NULL ⇒ generation refused)
            ├─1:N─ byline_authorizations  (consent/authorization per author; active = granted ∧ ¬revoked ∧ ¬expired)
            └─1:N─ content_pieces
                     ├─1:N─ content_piece_versions   (snapshot before every forward FSM move)
                     ├ (gate_results — SEAM PROJECTION in v1, no table; DR-039)
                     ├─1:N─ comment_threads          (client review, per version)
                     ├─1:N─ client_signoffs          (ADVISORY only — never satisfies canPublish())
                     ├─1:N─ credentialed_releases    (the ONLY human release canPublish() accepts; D6 reviewer)
                     └─N:1─ author_id ──soft-ref──▶ voice_specs.spec.authors[]  (server-resolved byline)
byline_authorizations.author_id ──soft-ref──▶ voice_specs.spec.authors[]  (the authorized clinician/author)
credentialed_releases.authorization_id ──FK──▶ byline_authorizations  (§11.5: who authorized, scope, dates; missing/revoked/expired ⇒ release blocked ⇒ publish blocked)
canPublish() human-release precondition ──reads──▶ credentialed_releases (NEVER client_signoffs)  ── source of truth
content_pieces.cluster_role + funnel_stage  ──drive──▶  generated hub homepage + related-guides nav (D7)
runs ─1:N─ seo_cost_ledger   runs ─1:1─ seo_cost_run_budget (per-run cap accumulator)   share_of_model ─N:1─ content_pieces (north-star KPI)
```

### 3.3 Migration plan

1. **PORT** `origin/preview` Drizzle `0030_content_pieces.sql` verbatim into `packages/schema-flywheel/drizzle/` (local tree stops at `0029_videogen_image_generations_provenance.sql`; the engine is **not** local — Phase 0 `git fetch origin preview` is a precondition). This brings `content_clients`/`content_pieces`/`content_piece_versions`/`voice_specs` + their RLS policies.
2. **`0031_content_cluster_columns.sql` (additive, D7):** add `cluster_role`, `funnel_stage` as first-class columns + their indices; backfill from `brief_snapshot` jsonb for any ported rows. This is a **Phase-1** migration (not a Phase-3 deferral) because it drives the generated homepage and related-guides nav.
3. **`0032_release_records.sql` (net-new, authored in PR 004):** the persisted authorization + release/signoff records — **`byline_authorizations`** (the §11.5 consent/authorization record, created **first** so the FK target exists), `client_signoffs` (advisory), and `credentialed_releases` (the only record `canPublish()` reads as the human-release source of truth, carrying `release_type`/`actor_id`/`credential` snapshot/`authorization_id`/`released_at`/`release_scope`, with `authorization_id` an **FK → `byline_authorizations`**). Lands in Phase-1 **before PR 009** because `canPublish()` reads `credentialed_releases`. RLS: no anon policy on any of the three.
4. **`0039_seo_cost_ledger.sql` (the net-new aux migration, authored in PR 020 — reconciled to shipped reality per audit-005 / DR-038 / DR-039):** creates **THREE** net-new tables — `seo_cost_ledger`, **`seo_cost_run_budget`** (the per-run accumulator / conditional-UPDATE lock-row: `run_id` UNIQUE, `cap_usd`, `reserved_usd` — the row that makes the AC1 atomicity guarantee runnable on the live schema), and `share_of_model`. It does **NOT** add a `gate_results` table ([[DR-039]]: that stays a seam-level projection in v1). The `comment_threads` rename/extension (the ported `review_comments` shape with `kind`/`anchor`) shipped separately in `0036_comment_threads.sql`. RLS: no anon policy on any of these.
5. **Tenancy hardening:** confirm every table has `workspace_id`+`client_id`, RLS enabled, and that `content_piece_versions` keeps its denormalized `client_id` (keeps a future per-tenant RLS path open). A migration test asserts a cross-workspace `SELECT` of a draft returns zero rows.

### 3.4 Multi-tenancy enforcement (5 layers)

| Layer | Mechanism | What it stops | Fail mode |
|---|---|---|---|
| **1 · Database RLS** | RLS enabled on all tables; sole anon policy = `content_pieces_public_read` (`status='published'`). No anon policy on `voice_specs`/`content_piece_versions`/`comment_threads`/`seo_cost_ledger`/`seo_cost_run_budget`/`share_of_model` (no `gate_results` table — DR-039) | Public reads of drafts, scorecards, brand voice | Fail-closed — absent policy = deny |
| **2 · Application scope** | Every operator query runs service-role and filters `workspace_id`+`client_id`; the SSR route resolves `<client>`→`blog_slug`→`client_id` and 404s a foreign slug | Operator code reading the wrong tenant; rendering under a wrong namespace | 404 / zero rows |
| **3 · Host-tool binding** | Worker tools (`runScorers`/`runGate`/`serpFetch`/`persistPiece`/`heroImage`) are constructed per-run keyed to exactly one `workspace_id`/`client_id`; the agent never receives a tenant id it can vary | Agent widening retrieval/persisting across clients (voice bleed — the #1 agency-ending risk) | Tool rejects mismatched ctx |
| **4 · Review-token scope** | The tokenized client preview is scoped to exactly one piece + one version, fail-closed RLS; no credits, no markdown, no Improve-Draft on that surface | A review link leaking sibling pieces or other clients' content | Token resolves to one row or 404 |
| **5 · Compute-substrate isolation** | A warm-pool Sandbox VM holds no tenant binding while idle; on lease it gets per-run scoped tools + the per-run JWT, and the working dir is wiped + the `claude` subprocess restarted on handoff | A recycled microVM exposing the prior run's working-dir / session state to the next tenant (compute-side voice bleed) | Recycled VM is indistinguishable from cold boot; PR-006 residue test fails the build if not |

*References: ch. 03 (bible v1.0.0, sha: 2c02fe80), ch. 09 (bible v1.0.0, sha: 2c02fe80), ch. 14 (bible v1.0.0, sha: 2c02fe80)*

## 4 · PR slices

The build is sliced so the **thinnest end-to-end vertical** lands first and proves every load-bearing decision at once. **Canonical Slice-1 definition of done (identical everywhere — PRD §0, PRD §12, RFC §7):** brief → a **single worker-hosted drafter call** → **host-enforced gate (the `/content/api/audit` route)** → a **MINIMAL SSR render** → **one bounded edit → re-gate** → a **gated version**. Concretely, Slice 1 is **PR 001–009 + a minimal render + one bounded edit pulled forward**: PR 001–009 (gate, FSM, scorers, schema, tenancy, worker, SSE, the single-drafter `seo-blog-writer` wiring + golden harness, fail-closed publish) **plus a minimal body-only SSR render (the Slice-1 render floor, delivered by PR 015 scoped to body-in-HTML only) and one bounded edit + re-gate + gated version (the Slice-1 single-edit floor, delivered by PR 012 scoped to one bounded re-gate)**. The slice that is declared *green* therefore includes render + one edit. What Slice 1 deliberately **excludes** is the **full self-revising autonomous loop/canvas** (the three-zone canvas, live streaming, the multi-turn conversational fine-tune, versioning UI), the hub homepage, imagegen, the multi-piece cluster, and client review — those add the *surface* and arrive in **Slice 2** (PR 010–011, PR 013–014 + the homepage/client-review PRs 016–021). (Dependencies are repointed so PR 012's minimal bounded edit and PR 015's minimal render slot into Slice 1 ahead of the full canvas; the full fine-tune loop and full render/homepage widen them in Slice 2.) The deterministic moat (`seo-gate`, `lifecycle-fsm`, 22 scorers, `content_pieces` schema) is **ported from flywheel-main `origin/preview` (PRs #1668–1684), not reinvented**, and the four-skill `seo-copywriter` suite (`seo-strategist`/`seo-assistant`/`seo-blog-writer`/`seo-audit`) is **run directly, not re-authored**; the only net-new IP is **wiring the existing suite into the worker + standing up the `/content/api/{brief,draft,audit,publish}` kernel route contract in `apps/seo`**, the worker runtime + transport, and the hub homepage/client-review surfaces. Per the locked D5/D9 topology, the autonomous loop runs on a **Claude Agent SDK worker on Vercel Sandbox**; `apps/seo` on Vercel is a thin UI + orchestration API; the gate/scorers/DB are exposed to the worker **as the `/content/api/*` kernel routes the suite skills orchestrate — host-side, the agent cannot reason past them**; streaming spans **worker → apps/seo → browser (SSE)**. Lanes: `engine-port` · `worker-runtime` · `schema-tenancy` · `agent-ui` · `render-geo` · `client-review`.

Ordering rule: **PR 000 (the Phase-0 capability-enforcement spike) runs first and gates the worker architecture** — it proves the Vercel Sandbox + Claude Agent SDK can actually enforce each runtime control (egress allowlist, env scrub, constrained shell/file, boot-refusal) with a real adversarial run *before* PR 006/006b lock the worker topology; if any control proves unenforceable, the fallback runtime it defines (see PR 000) is adopted before the loop is built on the assumption. PR 001–009 (plus the worker-safety PR 006b) **plus the Slice-1 minimal render (PR 015 scoped to body-only) and one bounded edit (PR 012 scoped to a single re-gate)** then deliver the thinnest green slice — brief → single drafter call → host-enforced gate → minimal SSR render → one bounded edit/re-gate → gated version — with **no full self-revising canvas, no hub homepage, no client review** (those are Slice 2). 006b is in-slice because the worker's runtime capability-denial profile is load-bearing safety, not a later widening. PR 010–011 + PR 013–014 add the full agent canvas, live streaming, the multi-turn fine-tune, versioning UI, and the full four-skill suite chain. PR 016–021 add the full hub render/homepage/client-review/ledger/instrumentation + the SoM-ingestion and freshness crons. Every PR is 1–3 engineer-days.

---

### PR 000 — Phase-0 spike: prove Sandbox + Agent-SDK capability-denial is enforceable (architecture gate)
- **Lane:** worker-runtime
- **Scope:** Before the worker architecture (PR 006/006b) locks, **prove with a real adversarial run** that Vercel Sandbox + the Claude Agent SDK can actually enforce each runtime control the safety model depends on — this is a de-risking spike, not production code. The unvalidated platform assumption is that the Sandbox + SDK combination *can* deny these capabilities; this spike falsifies or confirms it on real infra. For each control, run a deliberately hostile probe and record pass/fail: (1) **network egress allowlist** — a `curl`/`fetch` from inside the running `claude` subprocess to a non-allowlisted host (incl. `169.254.169.254`, a private range, an arbitrary public host) is refused at the network layer; (2) **env scrub** — the worker process env carries no secret-shaped value beyond a placeholder run JWT; (3) **constrained shell/file** — a shell/file tool call to read outside the ephemeral working dir or a sibling run's path fails; (4) **boot-refusal** — if a control fails to apply, `sandbox-launch` refuses to start the loop rather than running degraded. **Define the fallback runtime** for any control that proves unenforceable on Vercel Sandbox: an egress proxy in front of the Sandbox, an isolated container service (e.g. a Firecracker/microVM host that exposes the controls), or a **no-shell-capable Agent-SDK worker in v1** (disable the general-purpose shell entirely and run the loop with only the typed host tools). The chosen runtime/fallback is recorded as a one-page decision that PR 006/006b build against.
- **Files added/modified:** `apps/seo/spike/capability-enforcement/{egress-probe,env-scrub-probe,fs-constraint-probe,boot-refusal-probe}.ts`, `apps/seo/spike/capability-enforcement/RESULTS.md` (per-control pass/fail on real Sandbox infra + the chosen runtime/fallback decision).
- **Acceptance criteria:**
  - [ ] Each of the four controls (egress allowlist, env scrub, constrained shell/file, boot-refusal) is exercised by a **real adversarial run on Vercel Sandbox** (not a mock) and its pass/fail recorded in `RESULTS.md`.
  - [ ] If **all** controls are enforceable, `RESULTS.md` records "Vercel Sandbox confirmed" and PR 006/006b proceed as written.
  - [ ] If **any** control is unenforceable, `RESULTS.md` records the specific failure **and** the adopted fallback runtime (egress proxy / isolated container service / no-shell-capable Agent-SDK worker in v1), and PR 006/006b are re-scoped against that fallback before the worker is built.
  - [ ] The decision is made **before** PR 006 (the worker host) merges — this PR is an explicit architecture gate, not a parallel track.
- **Test plan:** Tier 1 — the four probe scripts run locally against a Sandbox dev target. Tier 2 — a CI/manual adversarial run on real Vercel Sandbox infra produces the recorded `RESULTS.md`. Tier 3 — n/a (spike output is the decision doc, not a shipped surface).
- **Dependencies:** none (Phase-0; gates PR 006/006b)
- **Risk:** High — this is the validation of the platform assumption the entire worker safety model rests on; discovering an unenforceable control *after* PR 006 would mean rebuilding the worker runtime.
- **Rollback:** n/a (spike; produces a decision, ships no runtime).

*References: ch. 03 (bible v1.0.0, sha: 2c02fe80), ch. 10 (bible v1.0.0, sha: 2c02fe80), ch. 16 (bible v1.0.0, sha: 2c02fe80)*

---

### PR 001 — Scaffold `apps/seo` + port the provider seam into `@sagemark/core`
- **Lane:** engine-port
- **Scope:** Stand up the empty `apps/seo` Next.js 16 service (page convention mirroring `apps/agents`, Tailwind v4 tokens, auth guard) and create the `@sagemark/core` package, seeding it with the provider seam copied verbatim from `apps/trailhead/src/lib/ai.ts`.
- **Files added/modified:** `apps/seo/package.json`, `apps/seo/src/app/layout.tsx`, `apps/seo/src/app/(studio)/page.tsx` (placeholder), `apps/seo/src/lib/auth.ts` (re-export of `apps/agents/src/lib/auth`), `packages/core/package.json`, `packages/core/src/ai/resolve-gateway-model.ts`, `packages/core/src/ai/cost-accountant.ts`, `pnpm-workspace.yaml`, `turbo.json` (env passthrough for `ANTHROPIC_API_KEY`/Gateway).
- **Acceptance criteria:**
  - [ ] `pnpm --filter @sagemark/seo build` and `pnpm --filter @sagemark/core build` both succeed via turbo.
  - [ ] **Worker invariant — all worker model traffic routes through the metered Gateway.** `resolveGatewayModel()`'s direct-Anthropic provider branch is **host/non-worker-only**: it may resolve a direct-Anthropic provider only in a host/CI context, never in the SEO Creator worker runtime. The worker is always provisioned with the Gateway base URL + per-run bridge JWT as its only model credential (per RFC §2 / PRD §9.3); the function exposes a `context: 'host' | 'worker'` parameter (or equivalent) and a unit test asserts the `'worker'` context can resolve **only** a Gateway provider and refuses to return a raw-Anthropic-endpoint provider even if `ANTHROPIC_API_KEY` is present in the ambient env.
  - [ ] **CI assertion — no worker env/config carries a raw Anthropic endpoint + provider key.** A CI check (env/config lint) fails the build if any worker-bound env or Sandbox-provision config contains a raw Anthropic endpoint (`api.anthropic.com`) together with a provider API key — the worker's only model credential is the run-scoped Gateway base URL + bridge JWT. This reconciles with the PR 020 / PR 006b **"Gateway-disabled ⇒ zero model calls"** test: with no direct provider branch reachable from the worker and no raw key in its env, a worker launched without the Gateway seam can make no model call at all (it fails fast), rather than silently falling back to the raw Anthropic endpoint.
  - [ ] `CostAccountant.reserve()` throws `CostCapExceededError` once the per-run USD ceiling is exceeded (unit test).
  - [ ] Model ids re-baselined off `claude-sonnet-4.5` to `claude-sonnet-4-6` (drafter) / `claude-haiku-4-5` (verifier) / `claude-opus-4-7` (judge); `budget_tokens` dropped for 4.6+/Opus.
- **Test plan:** Tier 1 — unit tests for the provider-seam branches + cost-cap abort. Tier 2 — `turbo build` green across the two new workspaces. Tier 3 — `apps/seo` boots locally and serves the placeholder route.
- **Dependencies:** none
- **Risk:** Low
- **Rollback:** Delete `apps/seo` + `packages/core`; revert `pnpm-workspace.yaml`/`turbo.json`. No runtime consumers yet.

*References: ch. 01 (bible v1.0.0, sha: 2c02fe80), ch. 07 (bible v1.0.0, sha: 2c02fe80)*

---

### PR 002 — Port the scorer library + faithfulness/voice gates into `@sagemark/core`
- **Lane:** engine-port
- **Scope:** Port the 22 deterministic scorers and the cross-model faithfulness/voice gates verbatim from `apps/agents/src/lib/content/*` (and `origin/preview` where local stops at `0029`), preserving their production bug-fix scars and the `drafter !== verifier` invariant.
- **Files added/modified:** `packages/core/src/scorers/{flesch-kincaid,keyword-density,passive-voice,content-score,broken-chunk-linter,banned-lexicon-linter,geo-citation,faq-schema-generator,meta-tag-generator,og-tag-generator,...}.ts`, `packages/core/src/gates/faithfulness-gate.ts`, `packages/core/src/gates/voice-gate.ts`, `packages/core/src/config/models.ts`, plus their ported `*.test.ts`.
- **Acceptance criteria:**
  - [ ] All ported scorer unit tests pass unmodified against `@sagemark/core` imports.
  - [ ] Faithfulness gate carries the 12s timeout + 25-claim cap; voice gate carries the 3s timeout (asserted in tests).
  - [ ] A unit test asserts `config.drafterModel !== config.faithfulnessVerifierModel` and fails the build if they collapse.
  - [ ] A thrown scorer surfaces as a fail-closed error, never a silent pass (test injects a throw and asserts the gate composer would veto).
- **Test plan:** Tier 1 — full ported scorer + gate unit suite. Tier 2 — `drafter !== verifier` invariant test in CI. Tier 3 — none (no UI).
- **Dependencies:** PR 001
- **Risk:** Low
- **Rollback:** Remove `packages/core/src/scorers` + `gates`; no callers until PR 005.

*References: ch. 15 (bible v1.0.0, sha: 2c02fe80), ch. 10 (bible v1.0.0, sha: 2c02fe80)*

---

### PR 003 — Port `seo-gate` + `lifecycle-fsm` + `failure-codes` into `@sagemark/core`
- **Lane:** engine-port
- **Scope:** Port the non-compensatory two-stage `seo-gate` (Stage-A ordered vetoes → Stage-B 8-dim composite) and the fail-closed `lifecycle-fsm` (`canPublish`/`canTransition`/`requiresSnapshot`) from `origin/preview` into host-side `@sagemark/core`. These are the product.
- **Files added/modified:** `packages/core/src/gate/seo-gate.ts`, `packages/core/src/gate/failure-codes.ts`, `packages/core/src/lifecycle/lifecycle-fsm.ts`, `packages/core/src/gate/stage-b-weights.ts`, ported `*.test.ts`, `packages/core/src/index.ts` (public surface).
- **Acceptance criteria:**
  - [ ] Stage-A first veto short-circuits to REJECT/REVISE with `score=null` and Stage-B is never computed (test per veto code: `VETO_BROKEN_CHUNK`, `VETO_UNSOURCED_STAT`, `VETO_KEYWORD_STUFF`, `VETO_YMYL_MISCLASSIFIED`, `VETO_YMYL_NO_BYLINE`, `VETO_THIN_CONTENT`, `VETO_BANNED_LEXICON`, `VETO_VOICE_FAIL`, `VETO_EVAL_FAILED`). **The Stage-A set has NO `VETO_YMYL_NO_REVIEW`** — the draft-eligibility gate (`draft→review`) checks byline *presence* and faithfulness only; requiring a recorded review to enter review is circular. The credentialed-reviewer release is enforced separately in `canPublish()` on `review→approved` (the `NO_HUMAN_RELEASE` precondition below), not as a Stage-A veto.
  - [ ] `VETO_YMYL_MISCLASSIFIED` fires when the `ymylSignals` detector finds medical-claim signals in a body whose `is_ymyl=false` (the YMYL false-negative guard — a misclassified piece cannot reach Stage-B or dodge the YMYL byline/review vetoes).
  - [ ] `STAGE_B_WEIGHTS` sum to exactly 1.0 and faithfulness is strictly the max weight (0.20) — asserted in a unit test.
  - [ ] `canPublish()` returns true only when `verdict==='PUBLISH' && evalRan===true && humanRelease===true && (!is_ymyl || namedCredentialedAuthor && citations)`; a skipped/thrown eval blocks (test). **`humanRelease` is satisfied only by a `credentialed_release` (the §3.1 `credentialed_releases` record), never a `client_signoff` — `canPublish()` takes the release input as a typed `credentialed_release` and a unit test asserts a `client_signoff`-shaped input is rejected as `NO_HUMAN_RELEASE`, so a `client_signoff` can never satisfy a YMYL release.**
  - [ ] FSM rejects illegal edges with stable codes (`ILLEGAL_EDGE`, `EVAL_DID_NOT_RUN`, `NO_HUMAN_RELEASE`, `YMYL_NO_BYLINE`), never prose.
- **Test plan:** Tier 1 — exhaustive gate + FSM unit suite (ported). Tier 2 — Stage-A ordering + `canPublish` truth-table coverage in CI. Tier 3 — none.
- **Dependencies:** PR 002
- **Risk:** Med — the FSM `canPublish` is the publish chokepoint; a porting slip is agency-level. Mitigated by the ported exhaustive test suite.
- **Rollback:** Remove gate/FSM modules; revert `index.ts` exports.

*References: ch. 09 (bible v1.0.0, sha: 2c02fe80), ch. 15 (bible v1.0.0, sha: 2c02fe80)*

---

### PR 004 — Supabase tenancy schema + release/signoff split + RLS + CI contract test
- **Lane:** schema-tenancy
- **Scope:** Port the `content_clients` / `content_pieces` / `content_piece_versions` / `voice_specs` / `review_comments` Drizzle schema from `origin/preview` into `packages/schema-flywheel/drizzle/0030+`, promote `cluster_role` + `funnel_stage` to first-class columns (D7), **persist the byline-authorization record + the release/signoff split as three distinct tables — `byline_authorizations` (the §11.5 consent record, created first as the FK target), `client_signoffs` (advisory), and `credentialed_releases` (the only record `canPublish()` accepts; its `authorization_id` is an FK → `byline_authorizations`) — so PR 009's `canPublish()` reads `credentialed_releases` as the source of truth and a missing/revoked/expired authorization blocks the release** (§9.1, §11.5), enable fail-closed RLS, and add a CI contract test that asserts cross-tenant reads return zero rows.
- **Files added/modified:** `packages/schema-flywheel/drizzle/0030_content_pieces.sql`, `packages/schema-flywheel/drizzle/0031_cluster_funnel_columns.sql`, `packages/schema-flywheel/drizzle/0032_release_records.sql` (the net-new `byline_authorizations` + `client_signoffs` / `credentialed_releases` split), `packages/schema-flywheel/src/content.ts` (Drizzle table defs incl. the authorization + two release tables), `apps/seo/test/tenancy/rls-contract.test.ts`.
- **Migration SQL (inline, `0031`):**
  ```sql
  -- 0031_cluster_funnel_columns.sql
  ALTER TABLE content_pieces
    ADD COLUMN cluster_role text
      CHECK (cluster_role IN ('pillar','cornerstone','spoke','faq','checklist')),
    ADD COLUMN funnel_stage text
      CHECK (funnel_stage IN ('awareness','consideration','decision','retention'));
  CREATE INDEX content_pieces_cluster_idx
    ON content_pieces (client_id, cluster_role, funnel_stage);

  -- Fail-closed RLS (ported from 0030, re-asserted here for the contract test)
  ALTER TABLE content_pieces       ENABLE ROW LEVEL SECURITY;
  ALTER TABLE content_piece_versions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE voice_specs          ENABLE ROW LEVEL SECURITY;
  ALTER TABLE review_comments      ENABLE ROW LEVEL SECURITY;
  -- the ONLY anon policy: published pieces, nothing else
  CREATE POLICY content_pieces_public_read ON content_pieces
    FOR SELECT TO anon USING (status = 'published');
  -- voice_specs / versions / review_comments: NO anon policy at all
  ```
- **Migration SQL (inline, `0032` — byline authorization + the release/signoff split):**
  ```sql
  -- 0032_release_records.sql
  -- FIRST: the consent/authorization record backing every published byline (§11.5).
  -- Created BEFORE credentialed_releases so the authorization_id FK target exists.
  -- A byline is attachable only while an ACTIVE authorization exists
  -- (granted_at set, revoked_at IS NULL, expires_at NULL or in the future).
  CREATE TABLE byline_authorizations (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL,
    client_id     uuid NOT NULL REFERENCES content_clients(id) ON DELETE RESTRICT,
    author_id     uuid NOT NULL,                                -- → voice_specs.authors[] entry
    credential    jsonb NOT NULL,                               -- snapshot {name, credentials} at grant
    scope         text NOT NULL CHECK (scope IN ('client','cluster','piece')),
    granted_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz,                                  -- nullable: no expiry
    revoked_at    timestamptz,                                  -- nullable: revocation is a new state, never a delete
    authorized_by uuid NOT NULL                                 -- the operator who recorded the authorization
  );
  CREATE INDEX byline_authorizations_client_idx ON byline_authorizations (client_id);
  CREATE INDEX byline_authorizations_author_idx ON byline_authorizations (author_id);
  -- active-authorization lookup (granted ∧ ¬revoked ∧ ¬expired)
  CREATE INDEX byline_authorizations_active_idx ON byline_authorizations (client_id, author_id, revoked_at, expires_at);
  ALTER TABLE byline_authorizations ENABLE ROW LEVEL SECURITY;  -- no anon policy

  -- ADVISORY client/agency-contact approval — can NEVER release or supply a byline
  CREATE TABLE client_signoffs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL,
    client_id     uuid NOT NULL REFERENCES content_clients(id) ON DELETE RESTRICT,
    piece_id      uuid NOT NULL REFERENCES content_pieces(id)  ON DELETE RESTRICT,
    version       integer NOT NULL,
    release_type  text NOT NULL DEFAULT 'client_signoff'
                    CHECK (release_type = 'client_signoff'),   -- structurally fixed
    actor_id      uuid NOT NULL,                                -- the client/agency contact
    release_scope text NOT NULL CHECK (release_scope IN ('piece','section')),
    released_at   timestamptz NOT NULL DEFAULT now()
    -- NOTE: deliberately NO credential, NO authorization_id —
    -- a client_signoff cannot satisfy canPublish() nor populate a byline.
  );
  CREATE INDEX client_signoffs_piece_idx  ON client_signoffs (piece_id, version);
  CREATE INDEX client_signoffs_client_idx ON client_signoffs (client_id);
  ALTER TABLE client_signoffs ENABLE ROW LEVEL SECURITY;  -- no anon policy

  -- The ONLY record that satisfies canPublish()'s human-release precondition (D6 reviewer)
  CREATE TABLE credentialed_releases (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    uuid NOT NULL,
    client_id       uuid NOT NULL REFERENCES content_clients(id) ON DELETE RESTRICT,
    piece_id        uuid NOT NULL REFERENCES content_pieces(id)  ON DELETE RESTRICT,
    version         integer NOT NULL,
    release_type    text NOT NULL DEFAULT 'credentialed_release'
                      CHECK (release_type = 'credentialed_release'),
    actor_id        uuid NOT NULL,            -- the credentialed reviewer (D6)
    credential      jsonb NOT NULL,           -- snapshot {name, credentials} at release (byline evidence)
    authorization_id uuid NOT NULL
                      REFERENCES byline_authorizations(id) ON DELETE RESTRICT,  -- FK → §11.5 byline-authorization record
    release_scope   text NOT NULL CHECK (release_scope IN ('piece','section')),
    released_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (piece_id, version)                -- one credentialed release per version
  );
  CREATE INDEX credentialed_releases_client_idx ON credentialed_releases (client_id);
  CREATE INDEX credentialed_releases_auth_idx   ON credentialed_releases (authorization_id);
  ALTER TABLE credentialed_releases ENABLE ROW LEVEL SECURITY;  -- no anon policy
  ```
- **Acceptance criteria:**
  - [ ] `0030`+`0031`+`0032` apply cleanly on a fresh Supabase branch; `pnpm drizzle:generate` produces no drift.
  - [ ] Anon `SELECT` on `content_pieces` returns only `status='published'` rows; anon `SELECT` on `voice_specs`/`content_piece_versions`/`review_comments`/`byline_authorizations`/`client_signoffs`/`credentialed_releases` returns zero rows (contract test).
  - [ ] An operator service-role query scoped to workspace A returns zero rows for a piece owned by workspace B (cross-tenant contract test).
  - [ ] `(client_id, slug)` uniqueness enforced; `cluster_role`/`funnel_stage` CHECK constraints reject invalid enums.
  - [ ] **Release/signoff split is structurally distinct:** `client_signoffs` has a `release_type` CHECK pinned to `'client_signoff'` and carries **no** `credential`/`authorization_id` columns; `credentialed_releases` carries a non-null `credential` snapshot + `authorization_id` and a UNIQUE(`piece_id`,`version`). A schema test asserts a `client_signoff` row cannot carry reviewer credentials and that the two release types are separate tables (not a shared `kind` flag PR 009's `canPublish()` could be fooled by).
  - [ ] **`byline_authorizations` is the FK target for the release record:** `credentialed_releases.authorization_id` is a non-null FK → `byline_authorizations(id)` (ON DELETE RESTRICT); a schema test asserts a `credentialed_release` referencing a nonexistent authorization is rejected by the FK, and that `byline_authorizations` carries the `scope` CHECK + nullable `expires_at`/`revoked_at` (the active-authorization fields the §11.5 release-eligibility check reads).
- **Test plan:** Tier 1 — Drizzle type-gen + enum/`release_type` CHECK unit assertions (incl. the client_signoff-has-no-credential assertion). Tier 2 — `rls-contract.test.ts` runs against a Supabase branch in CI (both anon and cross-tenant directions, incl. the two release tables). Tier 3 — manual `psql` spot-check of a seeded two-tenant fixture.
- **Dependencies:** PR 001
- **Risk:** Med — cross-tenant leakage is the #1 agency-ending risk; the contract test is the guard. The release/signoff split is the persisted backing for the §9.1 publish predicate — PR 009's `canPublish()` depends on these tables existing.
- **Rollback:** `drizzle` down-migration drops `0032` release tables (`credentialed_releases` → `client_signoffs` → `byline_authorizations`, in FK-dependency order) then `0031` columns/indexes; `0030` revert restores prior schema. No data in prod yet.

*References: ch. 14 (bible v1.0.0, sha: 2c02fe80), ch. 16 (bible v1.0.0, sha: 2c02fe80)*

---

### PR 005 — Stand up the `/content/api/{brief,draft,audit,publish}` kernel route contract (the agent-unreachable enforcement boundary the suite skills orchestrate)
- **Lane:** worker-runtime
- **Scope:** Stand up in `apps/seo` the **exact `/content/api/{brief,draft,audit,publish}` route contract** the `seo-copywriter` suite skills orchestrate (verified to exist on origin/preview at `apps/agents/src/app/content/api/{brief,draft,audit,publish}/route.ts`), each route wrapping `@sagemark/core` + Supabase as a typed, tenancy-keyed host operation: `/content/api/brief` (SERP fetch, SSRF-guarded, → `brief.sources`), `/content/api/draft` (host-validated `content_pieces` write), `/content/api/audit` (read-only `runScorers` + `runGate` → Stage-A→Stage-B), `/content/api/publish` (host-enforced `canPublish()` + FSM transition). **These routes ARE the host-side tools the worker exposes to the agent** — Stage-A vetoes and `canPublish()` are enforced here, never inside the loop, so the agent can reach publish only through the fail-closed audit/publish routes. The worker's kernel-host base URL points at this `apps/seo` contract.
- **Files added/modified:** `apps/seo/src/app/content/api/brief/route.ts`, `apps/seo/src/app/content/api/draft/route.ts`, `apps/seo/src/app/content/api/audit/route.ts`, `apps/seo/src/app/content/api/publish/route.ts`, `apps/seo/src/lib/content/serp-fetch.ts` (SSRF-guarded), `apps/seo/src/lib/content/context.ts` (binds `workspaceId`/`clientId` per request), `apps/seo/test/content/*.test.ts`.
- **Acceptance criteria:**
  - [ ] `/content/api/audit` (the `runScorers`/`runGate` path) is read-only: it returns a verdict + Stage-A/Stage-B detail but cannot mutate `status`; a test asserts no DB write occurs.
  - [ ] `/content/api/draft` rejects any payload whose `workspace_id`/`client_id` does not match the bound request context (403), and refuses creation when the client has no `approved_at` voice spec (hard stop).
  - [ ] **Kernel-host-unreachable is a hard, non-silent failure:** a suite step that cannot reach a `/content/api/*` route surfaces a clear `kernel host unreachable` error (naming the route + base URL) and stops — it never fabricates a brief/draft, never skips the gate, never silently no-ops (test simulates an unreachable host and asserts the worker enters the explicit error state rather than degrading).
  - [ ] `/content/api/brief` blocks private/loopback/link-local IPs and non-http(s) schemes (SSRF test) and caps fetched content; fetched page text is treated as untrusted (never executed, never re-injected as a tool result verbatim into a privileged path).
  - [ ] **Source-quality layer (YMYL trust, not just SSRF safety):** each `brief.sources` entry captures canonical URL + domain + fetched-at + an **authority class** — one of three: **(a) medical/statistical authority** `{Alzheimer's Association, NIA/NIH, CDC, recognized medical nonprofits, .gov/.edu medical/statistical domains}`, **(b) client-fact authority** (the client's `voice_specs.attributionSources[]` — grounds client-specific facts only), or **(c) low-authority/unknown**; `robots.txt`/ToS are honored and near-duplicate/spam snippets are filtered. A test asserts the class is assigned (and that a plain `attributionSources[]` entry classifies as (b) client-fact, NOT (a) medical, unless explicitly approved as a medical authority) and that duplicates are dropped.
  - [ ] **Neither a low-quality scraped DDG snippet NOR a client `attributionSources[]` entry can, by itself, satisfy a medical claim's sourcing:** for an `is_ymyl` piece, a numeric/medical claim grounded only in a class-(b) client-fact source or a class-(c) low-authority/unknown source is treated as **unsourced** — it does NOT clear `VETO_UNSOURCED_STAT` even though the string appears in fetched text or in the client's `attributionSources[]`; only a class-(a) medical/statistical authority satisfies it (one test feeds a medical claim backed solely by a junk snippet and a second feeds it backed solely by a client `attributionSources[]` entry — both assert the veto still fires; a class-(b) source still validly grounds a *client-specific fact* like a license number).
  - [ ] Every `/content/api/*` call is keyed to exactly one `(workspace_id, client_id)`; a cross-tenant call returns zero rows / 403.
  - [ ] Each route's request/response JSON schema carries a **contract version**; a contract-version test asserts the worker (suite skills) and host agree on the schema version and **fails the build on a mismatch** (a renamed field or bumped version is caught in CI, never at runtime as a silently-skipped call). This is the guard against the model/tool-schema-drift risk (§8).
- **Test plan:** Tier 1 — unit tests per route (audit read-only invariant, tenancy binding, SSRF guard, voice-spec hard stop, kernel-host-unreachable hard-stop) + the JSON-schema contract-version assertion. Tier 2 — the content-route endpoints authenticate the worker and reject an unbound/cross-tenant context. Tier 3 — none yet (no worker caller until PR 006).
- **Dependencies:** PR 003, PR 004
- **Risk:** Med — this is the enforcement boundary; an `/content/api/audit` that can mutate, or an `/content/api/draft` that trusts request tenancy, collapses the moat.
- **Rollback:** Remove the content-route contract + endpoints; no callers until PR 006.

*References: ch. 02 (bible v1.0.0, sha: 2c02fe80), ch. 03 (bible v1.0.0, sha: 2c02fe80), ch. 16 (bible v1.0.0, sha: 2c02fe80)*

---

### PR 006 — Agent-SDK worker on Vercel Sandbox (the autonomous loop host)
- **Lane:** worker-runtime
- **Scope:** Stand up the self-hosted Claude Agent SDK worker that runs the autonomous brief→fetch→draft→verify→gate loop inside a per-run Vercel Sandbox microVM (D5/D9). The worker spawns the `claude` CLI subprocess, **loads the existing `seo-copywriter` suite skills** and points their kernel-host base URL at the PR 005 `/content/api/*` route contract on `apps/seo` (the routes are the worker's toolset — it calls back into them, never re-implementing the kernel), and persists all session/working-dir state to Supabase — never the ephemeral Sandbox filesystem across runs.
- **Files added/modified:** `apps/seo/src/worker/agent-worker.ts` (Agent SDK bootstrap), `apps/seo/src/worker/sandbox-launch.ts` (Vercel Sandbox provisioning), `apps/seo/src/worker/host-tool-bridge.ts` (worker → `apps/seo` host-tool HTTP client, bearer-scoped to one run), `apps/seo/src/worker/session-store.ts` (Supabase-backed session persistence), `apps/seo/src/worker/Dockerfile`, `apps/seo/test/worker/session-store.test.ts`.
- **Acceptance criteria:**
  - [ ] A Sandbox microVM provisions, runs the loop with the existing `seo-blog-writer` suite skill loaded (driving the `/content/api/draft` route — the thinnest-slice single-drafter path; the full strategist→assistant→audit chain wires in PR 014), and tears down; the run's session/agent state is fully reconstructable from Supabase after teardown (test reloads a persisted run).
  - [ ] The worker's only mutation path is the host `persistPiece` tool; the Sandbox has no Supabase write credentials of its own (verified by attempting a direct write and asserting it fails).
  - [ ] A worker run keyed to client A cannot call host tools bound to client B (the bearer token scopes one `(workspace_id, client_id, run_id)`).
  - [ ] A wedged/timed-out Sandbox emits a terminal error event and releases its lease within the configured ceiling (no indefinite zombie microVM).
  - [ ] **A recycled warm-pool VM carries no prior-run residue:** an idle pooled VM holds no tenant binding, and on lease handoff the working dir is wiped + the `claude` subprocess restarted. A test runs client A on a pooled VM, returns it to the pool, leases it for client B, and asserts client B's run cannot read client A's working-dir files or session state (the cross-tenant compute-residue test).
  - [ ] **The Sandbox boots under a fail-closed capability profile** (see PR 006b for the enforcing tests): network egress is allowlisted to the Claude API/Gateway endpoint(s) and the `apps/seo` host-tool bridge URL only; the worker env carries **no ambient secrets** (no Supabase service key, no provider API key beyond the run-scoped bridge JWT, no cloud-metadata credentials); the `claude` subprocess's general-purpose shell/file/network tools are disabled or constrained to the working dir; the FS mount is the ephemeral working dir only. The bootstrap asserts this profile is applied and refuses to start the loop if any control is missing (fail-closed, not best-effort).
- **Test plan:** Tier 1 — `session-store` round-trip unit test; tenancy-scoping of the host-tool bridge token; warm-VM working-dir-wipe-on-handoff assertion; capability-profile-applied assertion (refuses to boot if a control is absent). Tier 2 — an integration run against a Sandbox that exercises one `serpFetch`→`runScorers`→`runGate`→`persistPiece` loop, plus a recycle-then-release residue check. Tier 3 — manual run in the Vercel Sandbox environment with a real brief, confirming microVM provision + teardown + Supabase state.
- **Dependencies:** PR 005; **PR 000 (the Phase-0 capability-enforcement spike) must have confirmed the runtime** — this PR builds against the runtime/fallback PR 000 decided (Vercel Sandbox if all controls are enforceable, else the PR 000 fallback).
- **Risk:** High — new ops surface Vercel doesn't natively give us; the Agent SDK is non-serverless and the most likely component to fail silently. Mitigated by Supabase-as-system-of-record, the lease/timeout guard, and the PR 000 spike proving capability-denial is enforceable before this locks.
- **Rollback:** Disable the worker behind a feature flag; `apps/seo` falls back to a "worker offline" error state. Sandbox provisioning is per-run, so nothing leaks on revert.

*References: ch. 06 (bible v1.0.0, sha: 2c02fe80), ch. 09 (bible v1.0.0, sha: 2c02fe80), ch. 10 (bible v1.0.0, sha: 2c02fe80)*

---

### PR 006b — Worker runtime capability-denial profile + adversarial confinement tests
- **Lane:** worker-runtime
- **Scope:** Close the gap between "the agent has only typed host tools (`serpFetch`/`runGate`/`persistPiece`) and no raw HTTP/publish" and the reality that the Agent SDK spawns a real `claude` CLI subprocess with a general-purpose shell + on-disk workspace. Pin a **fail-closed runtime capability profile** on the Sandbox and prove it with adversarial integration tests: a hostile brief/prompt that tries to `curl` an arbitrary host, dump env, read another run's files, or write the DB/API directly **must all fail**. The profile is the host-side enforcement that makes the "typed host tools only" safety claim true at runtime, not just on paper.
- **Files added/modified:** `apps/seo/src/worker/capability-profile.ts` (egress allowlist + secret-scrubbing + tool-disable config applied at boot), `apps/seo/src/worker/sandbox-launch.ts` (apply the profile before the `claude` subprocess starts; refuse to boot if any control is absent), `apps/seo/test/worker/capability-denial.test.ts` (the adversarial suite), `apps/seo/test/worker/egress-allowlist.test.ts`.
- **Acceptance criteria:**
  - [ ] **Network egress allowlist:** the worker can reach only the Claude API/Gateway endpoint(s) and the `apps/seo` host-tool bridge URL; a direct connection to any other host (incl. `169.254.169.254` cloud metadata, a private range, or an arbitrary public host) is refused at the network layer, not just by tool absence. A test drives a `curl`/`fetch` from inside the worker to a non-allowlisted host and asserts it fails.
  - [ ] **No ambient secrets in the worker env:** the worker env contains no Supabase service-role key, no provider API key, and no cloud credentials — only the per-run bridge JWT (scoped `(workspace_id, client_id, run_id)`, expiring at the run-budget ceiling). A test enumerates the worker process env and asserts no secret-shaped value is present beyond the run JWT.
  - [ ] **Shell/file tools disabled or constrained:** the `claude` subprocess's general-purpose Bash/file/web tools are disabled or constrained to the ephemeral working dir; the FS mount policy exposes only that working dir (no host FS, no other run's dir). A test asserts a tool-call to read outside the working dir or to a sibling run's path fails.
  - [ ] **Adversarial brief/prompt suite — all four attacks fail:** a malicious brief and a malicious fetched-source string that instruct the agent to (a) raw-`curl` an external host, (b) dump environment variables, (c) read another run's working-dir files, and (d) write Supabase/the Claude API directly (bypassing `persistPiece`/the Gateway) are each blocked; the run continues to completion or terminates cleanly, and **no** attack succeeds. `persistPiece` (host-validated) and `runGate` (read-only) remain the worker's only state-touching paths.
  - [ ] **Fail-closed bootstrap:** if any capability control fails to apply, `sandbox-launch` refuses to start the loop rather than running with a weaker profile.
- **Test plan:** Tier 1 — `capability-profile` unit tests (env scrub, allowlist construction, boot-refusal on missing control). Tier 2 — `capability-denial.test.ts` runs the four adversarial attacks against a Sandbox worker and asserts each fails; `egress-allowlist.test.ts` asserts a non-allowlisted connection is refused. Tier 3 — manual run in the Vercel Sandbox with a deliberately hostile brief, confirming no egress / no env leak / no cross-run read.
- **Dependencies:** PR 006 (and the PR 000 spike, which already proved each control is enforceable on the chosen runtime — this PR hardens that proof into the standing profile + regression suite).
- **Risk:** High — this is the runtime safety boundary that backs the "typed host tools only" claim; a missing egress/secret control means the worker is more capable than the safety model assumes.
- **Rollback:** Tighten to a "worker offline" state behind the PR 006 feature flag; the loop does not run without the profile applied (fail-closed by construction).

*References: ch. 03 (bible v1.0.0, sha: 2c02fe80), ch. 10 (bible v1.0.0, sha: 2c02fe80), ch. 16 (bible v1.0.0, sha: 2c02fe80)*

---

### PR 007 — Worker ↔ apps/seo SSE transport (the streaming hop)
- **Lane:** worker-runtime
- **Scope:** Wire the streaming hop locked by D5: the worker emits Agent SDK events; `apps/seo` relays them to the browser as SSE. Build `POST /api/run` (auth → workspace → client RLS → CostAccountant pre-flight reserve → dispatch to worker) and the relay that forwards token deltas + tool-use rows downstream.
- **Files added/modified:** `apps/seo/src/app/api/run/route.ts`, `apps/seo/src/lib/stream/sse-relay.ts`, `apps/seo/src/lib/stream/event-taxonomy.ts` (stable `tool-use`/`thinking`/`articleDelta`/`gate` event codes), `apps/seo/src/worker/emit.ts`, `apps/seo/test/stream/sse-relay.test.ts`.
- **Acceptance criteria:**
  - [ ] `POST /api/run` streams ≥1 token-delta event within 3s of dispatch and ultimately persists a `content_piece` row via `persistPiece`.
  - [ ] Tool-use events arrive as stable taxonomy-coded rows (`serpFetch`, `runFaithfulnessGate`, `runGate.stageA`, `runGate.stageB`), never raw model prose re-piped into the loop.
  - [ ] `CostAccountant.reserve()` runs pre-flight; a request over the per-run cap returns a cost error before any worker dispatch.
  - [ ] A worker-side error surfaces as a terminal SSE `error` event with a stable code, not a hung stream (heartbeat/timeout enforced).
  - [ ] On a `last_event_id` reconnect, the relay **re-reads the persisted `content_pieces` (+ its persisted scorecard/verdict) as the truth snapshot** (the scorecard lives on the piece/version row, not a `gate_results` table — DR-039) and resumes streaming only the deltas after the cursor — never replaying from worker memory; a test drops the stream mid-run and asserts the reconnect emits the persisted artifact + scorecard then resumes without duplication or loss.
  - [ ] The worker→host bridge token is a **per-run JWT minted by `/api/run`**, scoped to exactly `(workspace_id, client_id, run_id)` and expiring at the run-budget ceiling (~90s, the single-piece generation cap); a test asserts an expired or cross-run token is rejected by every host tool.
- **Test plan:** Tier 1 — `sse-relay` unit test (event ordering, heartbeat, terminal error, `last_event_id` truth-snapshot resume). Tier 2 — integration: `POST /api/run` → worker → SSE → assert first delta < 3s + a persisted draft row. Tier 3 — manual run streamed to a curl client.
- **Dependencies:** PR 006
- **Risk:** Med — a two-hop stream (worker → Vercel → browser) is fragile; the heartbeat/timeout discipline is the guard against silent stalls (the admin-app 8-day failure mode).
- **Rollback:** Revert `/api/run` to a synchronous non-streamed error; disable relay. Worker stays behind its flag.

*References: ch. 13 (bible v1.0.0, sha: 2c02fe80), ch. 06 (bible v1.0.0, sha: 2c02fe80)*

---

### PR 008 — Wire the `seo-blog-writer` suite skill into the worker (single-drafter slice) + golden-set regression harness
- **Lane:** worker-runtime
- **Scope:** **Wire the existing `seo-blog-writer` `SKILL.md` skill into the Agent-SDK worker** — loaded and run directly (NOT re-authored as a prompt), driving the PR 005 `/content/api/draft` route against the ported kernel — and build the golden-set harness that captures the live Whispering Willows hub as a human-labeled baseline and regresses every model/tool-order/skill-config change against it. (Golden capture is the Phase-0 floor; it lands here as the first regression-gated skill. The full strategist→assistant→audit chain wires in PR 014; this slice exercises the single-drafter path the thinnest slice proves.)
- **Files added/modified:** `apps/seo/src/worker/skills/load-suite.ts` (loads the suite `SKILL.md` skills from the in-repo vendored package `skills/seo-copywriter-skill-package/seo-copywriter/*` — **per DR-022; NOT `learnings/SKILLS/` / `~/.claude`** — + points their kernel-host base URL at the `apps/seo` `/content/api/*` contract; PR 008 registers `seo-blog-writer`; the worker `Dockerfile` COPYs the suite tree into the Sandbox image), `apps/seo/golden/whispering-willows/{pillar,spoke-*,faq,checklist}.json` (the labeled corpus generated from the reference content at `skills/seo-copywriter-skill-package/seo-copywriter/examples/whispering-willows-demo/` — body + per-piece `clusterRole`/`funnelStage`/expected dimension scores/expected Stage-A verdict CAPTURED from the real `@sagemark/core` kernel as a characterization baseline per DR-022; expert label certification = follow-up), `apps/seo/test/golden/regression.test.ts`, `apps/seo/test/acceptance/gate-spec.ts` (judge-prompt domain checks transcribed).
- **Acceptance criteria:**
  - [ ] The golden corpus (pillar + ~8 spokes + homepage labels) is checked in with human labels before the suite skill is exercised against it.
  - [ ] The worker loads the **real `seo-blog-writer` `SKILL.md`** (not a re-authored copy) and it drives the `/content/api/draft` route; a test asserts the skill orchestrates the kernel route rather than re-implementing scoring/persistence in markdown.
  - [ ] Generating against the golden brief reproduces the expected Stage-A clean/veto for each golden piece (within the documented tolerance band on Stage-B dimensions).
  - [ ] `gate-spec.ts` enumerates every Stage-A veto code and the Stage-B verdict bands (PUBLISH≥85 / REVIEW / REVISE / REJECT).
  - [ ] A deliberately weakened skill-config/model variant regresses below tolerance and the harness fails (proving the tripwire catches methodology drift).
  - [ ] **Gate-adjudication protocol (PRD §4.4):** a disputed gate result is recorded as a labeled `{veto_code, claimed_outcome, resolution}` row, and a unit test asserts a dispute **does not** flip the verdict to publishable — the only way to clear the veto is to fix the underlying evidence (no override-and-publish path). The labeled disputes feed the per-veto-code false-positive/false-negative metric (PR 020 / PRD §9.5).
  - [ ] **Medical/YMYL-detector change control:** a CI guard flags any diff to the `ymylSignals` detector, the faithfulness check, or the YMYL byline/review vetoes as **release-blocking** (requires the golden-set re-regression to pass), so a medical-detector change cannot ship as a quiet config tweak.
- **Test plan:** Tier 1 — `gate-spec.ts` band assertions. Tier 2 — golden regression run in CI against the labeled corpus (the methodology-fidelity tripwire). Tier 3 — manual side-by-side of one generated piece vs its golden reference.
- **Dependencies:** PR 007
- **Risk:** Med — methodology-fidelity regression is the failure mode that decides whether the suite, run under a new model/tool-order/skill-config, still matches its labeled baseline; the golden harness is the only guard.
- **Rollback:** Unregister the suite skill from the worker; the harness + golden corpus stay (they are pure test infra).

*References: ch. 05 (bible v1.0.0, sha: 2c02fe80), ch. 17 (bible v1.0.0, sha: 2c02fe80)*

---

### PR 009 — Voice-spec hard stop + fail-closed publish endpoint (thinnest-slice close-out)
- **Lane:** schema-tenancy
- **Scope:** Add the voice-spec editor with the `approved_at IS NULL` hard stop (no approved spec ⇒ piece creation refused, no default-voice fallback) and the fail-closed `POST /api/publish` that resolves the byline server-side from `author_id` → voice-spec author registry and gates release through `canPublish()`. **`canPublish()` reads the `credentialed_releases` table (PR 004's `0032` migration) as the source of truth for the human-release precondition — a `client_signoff` can NEVER satisfy it, and a YMYL release requires a `credentialed_release` whose `credential` snapshot + `authorization_id` evidence the reviewer + byline.** The release-reader **also resolves `authorization_id` → `byline_authorizations` and treats a revoked/expired/inactive authorization as a fail-closed block** (§11.5): an inactive authorization means no valid release, so publish is blocked and the byline is never resolved from it. This closes the thinnest end-to-end slice: a gated, human-released piece.
- **Files added/modified:** `apps/seo/src/app/(studio)/voice/VoiceSpecEditor.tsx`, `apps/seo/src/app/api/publish/route.ts`, `apps/seo/src/lib/byline/resolve-author.ts`, `apps/seo/src/lib/release/read-credentialed-release.ts` (reads `credentialed_releases` as the human-release source of truth; rejects a `client_signoff`), `apps/seo/src/lib/release/authorization-active.ts` (resolves `authorization_id` → `byline_authorizations` and fail-closed-rejects a revoked/expired/inactive authorization), `apps/seo/src/app/(studio)/DraftResult.tsx` (operator scorecard view, mirrors `apps/agents` `DraftResult.tsx`), `apps/seo/test/publish/can-publish.test.ts`.
- **Acceptance criteria:**
  - [ ] Creating a piece for a client whose voice spec has `approved_at IS NULL` is refused with an explicit "no approved voice spec" reason; the composer/route is disabled, not silently defaulted.
  - [ ] `POST /api/publish` resolves the byline from `content_pieces.author_id` → `voice_specs.authors[]` server-side; `request.author` is never trusted (test asserts a forged `request.author` is ignored).
  - [ ] A YMYL piece cannot reach `published` unless `verdict==='PUBLISH'` AND `evalRan` AND a recorded human release **(a `credentialed_releases` row, NOT a `client_signoffs` row)** AND a named credentialed author + citations resolve; any failed precondition returns a stable FSM code.
  - [ ] **`canPublish()` reads `credentialed_releases` as the source of truth and a `client_signoff` can NEVER satisfy a YMYL release:** a test seeds a piece with a `client_signoff` only and asserts `canPublish()` returns `NO_HUMAN_RELEASE` (the byline is never populated from a signoff); a second seeds a `credentialed_release` (with `credential` snapshot + `authorization_id`) and asserts release is permitted and the byline resolves from that record.
  - [ ] A `PUBLISH` verdict alone still leaves the piece at `draft` until a recorded `credentialed_release` exists (no autopilot).
  - [ ] **Fail-closed byline authorization (§11.5):** a `credentialed_release` whose `authorization_id` resolves to a **revoked** (`revoked_at` set), **expired** (`expires_at` in the past), or otherwise **inactive** `byline_authorizations` row is **rejected** — the release does not satisfy `canPublish()`'s human-release precondition, so publish is blocked (stable `NO_HUMAN_RELEASE`/authorization-inactive code), and the byline is never resolved from an inactive authorization. A test seeds (a) a revoked, (b) an expired, and (c) an inactive authorization and asserts each blocks release/publish, while an **active** authorization (granted, not revoked, not expired) permits it — fail-closed, never default-allow.
- **Test plan:** Tier 1 — `can-publish.test.ts` truth table (incl. `client_signoff`-only ⇒ `NO_HUMAN_RELEASE`, `credentialed_release` ⇒ permitted, and the revoked/expired/inactive-authorization ⇒ blocked cases); voice-spec hard-stop unit test; byline-resolution test (forged author ignored, byline sourced from the `credentialed_release` credential snapshot, never from an inactive authorization). Tier 2 — end-to-end: brief → worker draft → gate → persist `draft` → attempt publish → blocked without a `credentialed_release`, allowed with one + credentialed author. Tier 3 — manual operator walk: generate a YMYL piece, watch a Stage-A veto block it with `score=null`, fix the brief, see it pass to Stage-B, confirm it still sits at `draft` until a credentialed release is recorded.
- **Dependencies:** PR 008; **PR 004 (the `0032` release/signoff split migration — `canPublish()` reads `credentialed_releases`)**
- **Risk:** Med — the YMYL byline trust hole is the inherited `origin/preview` bug; server-side resolution + reading `credentialed_releases` (never `client_signoffs`) as the release source of truth is the close.
- **Rollback:** Disable `/api/publish` (pieces stay at `draft`); revert the voice editor. Generation still works.

*References: ch. 09 (bible v1.0.0, sha: 2c02fe80), ch. 14 (bible v1.0.0, sha: 2c02fe80)*

---

### PR 010 — Three-zone agent canvas shell (reuse videogen `StudioCanvas`)
- **Lane:** agent-ui
- **Scope:** Assemble the operator three-zone canvas (Agent | Artifact | Inspector) by adapting videogen's `StudioCanvas`, stripped of operator-only video controls and re-pointed at a markdown `content_piece`. Wire it to the PR 007 SSE stream so token deltas and tool-use rows render live.
- **Files added/modified:** `apps/seo/src/app/(studio)/SeoStudioCanvas.tsx`, `apps/seo/src/app/(studio)/agent/{AgentPanel,AgentMessageStream,ThinkingDelta,ToolUseRow}.tsx`, `apps/seo/src/app/(studio)/artifact/{ArtifactZone,BriefCard,ModeTabs}.tsx`, `apps/seo/src/components/ScoreSignalDot.tsx` (extracted from the 4× duplication in `apps/agents/.../adgen/new/ResultPanel.tsx`), `apps/seo/src/lib/stream/use-ui-message-stream.ts`.
- **Acceptance criteria:**
  - [ ] The canvas renders three zones; LEFT appends taxonomy-coded `ToolUseRow`s (spinner→check) as SSE tool-use events arrive; thinking deltas render as muted italic rows.
  - [ ] CENTER opens on an editable `BriefCard` (observed intent, `clusterRole`/`funnelStage`, entities, `is_ymyl`); body streaming is gated on the human approving the brief.
  - [ ] `ScoreSignalDot` is a single shared component consumed by the canvas (the 4× duplication is removed).
  - [ ] An SSR mount-guard protects any localStorage-touching component (no hydration mismatch).
- **Test plan:** Tier 1 — component unit/render tests (`ToolUseRow` states, `BriefCard` validation gating "Generate"). Tier 2 — the canvas consumes a mocked SSE stream and renders the brief→generating→done state sequence. Tier 3 — manual: run a real brief and watch the canvas materialize.
- **Dependencies:** PR 007
- **Risk:** Low — reuse-heavy UI assembly over a proven stream.
- **Rollback:** Route the studio path back to the PR 009 `DraftResult` operator view; remove the canvas shell.

*References: ch. 05 (bible v1.0.0, sha: 2c02fe80), ch. 02 (bible v1.0.0, sha: 2c02fe80)*

---

### PR 011 — Live token streaming into the center editor + Inspector gate scorecard
- **Lane:** agent-ui
- **Scope:** Render `data-articleDelta` token deltas live in the CENTER markdown editor (artifacts pattern) and build the RIGHT Inspector `GateScorecard` — Stage-A red blocking veto chips with stable codes, then Stage-B 8 dimension bars with the verdict band (faithfulness visibly dominant).
- **Files added/modified:** `apps/seo/src/app/(studio)/artifact/MarkdownEditor.tsx`, `apps/seo/src/app/(studio)/inspector/{InspectorPanel,GateScorecard,StageAVetoes,StageBBars,VerdictBand,PieceStatusRow}.tsx`, `apps/seo/src/app/(studio)/inspector/use-client-scorers.ts` (zero-credit `useMemo` deterministic scorers for the live sidebar).
- **Acceptance criteria:**
  - [ ] The body types in live token-by-token via `readUIMessageStream`; the editor is read-only during `generating` and editable at `done`.
  - [ ] When a Stage-A veto fired, the scorecard shows the specific veto chip, the composite reads `score=null` ("no composite — Stage-A veto"), and the verdict band reads REJECT/REVISE.
  - [ ] When Stage-A is clean, 8 dimension bars render 0–100 with the verdict band (PUBLISH≥85 / REVIEW / REVISE / REJECT); faithfulness is visually weighted heaviest.
  - [ ] Client-side deterministic scorers (flesch-kincaid, keyword-density, passive-voice) run via `useMemo` with zero LLM/credit cost for the live editor heuristics.
- **Test plan:** Tier 1 — `GateScorecard` render tests (veto chips, `score=null` state, band thresholds). Tier 2 — stream a mocked generation and assert the editor materializes + the scorecard fills. Tier 3 — manual: generate a piece that trips a veto, confirm the chip + null composite render honestly.
- **Dependencies:** PR 010
- **Risk:** Low
- **Rollback:** Render a static last-frame body + a plain verdict line instead of the live editor/scorecard.

*References: ch. 02 (bible v1.0.0, sha: 2c02fe80), ch. 15 (bible v1.0.0, sha: 2c02fe80)*

---

### PR 012 — Conversational fine-tune: `/api/edit` bounded diff + full gate re-run + versioning
- **Lane:** agent-ui
- **Scope:** Build the bounded fine-tune turn: an instruction (chat or routed comment) → the worker emits a bounded markdown-region diff → applied as an append-only `content_piece_versions` snapshot → the **full** two-stage gate re-runs in host code (the `/content/api/audit` route) → a one-line "what changed" summary streams back. Port the videogen `chat-edit` hardening verbatim. **Slice-1 scope = one bounded edit → re-gate → gated version** (no canvas required — it runs against the PR 009 publish/gate path and the PR 005 audit route); the **full multi-turn conversational fine-tune** (chat surface, live streaming, the activity feed) widens this in Slice 2 once the canvas (PR 010–011) exists.
- **Files added/modified:** `apps/seo/src/app/api/edit/route.ts`, `apps/seo/src/lib/edit/constrained-edit-contract.ts` (`{region, instruction} → bounded markdown diff + summary` — net-new; videogen's `{op:'update',changes:{props}}` does not generalize to prose), `apps/seo/src/worker/prompts/seo-edit.system.md`, `apps/seo/src/lib/edit/version-write.ts`, `apps/seo/src/app/(studio)/agent/ActivityFeed.tsx`, `apps/seo/test/edit/guards.test.ts`.
- **Acceptance criteria:**
  - [ ] An accepted edit writes an append-only `content_piece_versions` snapshot, bumps `version`, and re-runs the full gate before the verdict updates.
  - [ ] A fine-tune instruction that breaks faithfulness (or trips any Stage-A veto) is recorded as a version but the verdict gates release — it cannot advance toward publish (test: "drop the citations" edit → faithfulness veto → blocked).
  - [ ] SHA-256 stale-edit guard returns 409; per-tenant rate limit (30 auto-versions/hr) returns 429; workspace-ownership mismatch returns 403; missing key returns 503.
  - [ ] No instruction text, LLM prose, or body is logged — only ids, counts, wall-clock (PII discipline test).
- **Test plan:** Tier 1 — `guards.test.ts` (409/429/403/503 + PII discipline). Tier 2 — end-to-end edit turn: instruction → diff → version → re-gated verdict; a faithfulness-breaking edit is blocked. Tier 3 — manual: "tighten the intro" lands a bounded diff + new version + re-run gate + summary.
- **Dependencies:** PR 009 (for the Slice-1 minimal bounded edit → re-gate → gated version, no canvas needed); the **full** multi-turn fine-tune surface additionally depends on PR 011 (Slice 2).
- **Risk:** Med — the "agent reasons past a hard gate" risk concentrates here; host-side re-gate is the guard.
- **Rollback:** Disable `/api/edit`; pieces remain generate-only with no fine-tune.

*References: ch. 09 (bible v1.0.0, sha: 2c02fe80), ch. 10 (bible v1.0.0, sha: 2c02fe80)*

---

### PR 013 — Version hub: switch / name / compare + undeletable named sign-off
- **Lane:** agent-ui
- **Scope:** Port videogen's `VersionHub` + `VersionDiff` into the Inspector: auto-vs-named invariant, switch (restore as a new auto-version), compare (before/after diff), and named versions as protected, undeletable bookmarks recording approver identity (the E-E-A-T sign-off substrate).
- **Files added/modified:** `apps/seo/src/app/(studio)/inspector/VersionHub.tsx`, `apps/seo/src/app/(studio)/inspector/VersionDiff.tsx`, `apps/seo/src/app/api/versions/[id]/route.ts` (name/switch server actions), `apps/seo/test/versions/named-undeletable.test.ts`.
- **Acceptance criteria:**
  - [ ] Every accepted edit appears as an `auto=true` version row (append-only, never destructive).
  - [ ] "Switch" restores a target version's body as a new auto-version (zero re-generate, fully reversible).
  - [ ] "Name" flips `auto=false`; a delete attempt on a named version returns 409 (API defends the invariant).
  - [ ] `VersionDiff` renders before/after for any two versions ("what changed since your last review").
- **Test plan:** Tier 1 — `named-undeletable.test.ts` (409 on named-delete, auto-vs-named invariant). Tier 2 — switch/restore round-trip writes a new auto-version. Tier 3 — manual diff walk.
- **Dependencies:** PR 012
- **Risk:** Low — reuse of a proven contract.
- **Rollback:** Hide the version hub; versions still persist (PR 012 writes them) but are not switchable in UI.

*References: ch. 09 (bible v1.0.0, sha: 2c02fe80)*

---

### PR 014 — Wire the remaining three suite skills into the worker (strategist / assistant / audit) — the full chain
- **Lane:** worker-runtime
- **Scope:** **Wire the existing `seo-strategist`, `seo-assistant`, and `seo-audit` `SKILL.md` skills into the Agent-SDK worker** — loaded and run directly (NOT re-authored), driving the PR 005 `/content/api/{brief,audit,publish}` routes — completing the full typed-handoff chain `ContentStrategy → ContentBrief → ContentDraft → AuditResult`, golden-regressed against the Whispering Willows set on every change. The strategist (Stage 0, human-gated) produces the operator-approved `ContentStrategy` cluster map (pillar + funnel-staged spokes, spoke→pillar edges) that drives the homepage; the audit drives the audit + publish routes and enforces the N=3 revise cap (4th force-routes to human review).
- **Files added/modified:** `apps/seo/src/worker/skills/load-suite.ts` (extend the PR 008 loader to register `seo-strategist`/`seo-assistant`/`seo-audit` against the `/content/api/*` contract), `apps/seo/src/worker/loop/revise-cap.ts` (N=3 → hold at `review` as `forcedToHumanReview`), `apps/seo/test/golden/suite-chain.test.ts`.
- **Acceptance criteria:**
  - [ ] All four suite skills (the real `SKILL.md` files, run directly) pass golden regression within tolerance (extends PR 008's harness to the full chain) and each orchestrates its kernel route rather than re-implementing the kernel in markdown.
  - [ ] The strategist emits an operator-approved `ContentStrategy` cluster map with explicit spoke→pillar link edges and per-spoke `clusterRole`/`funnelStage` (consumed by PR 017's homepage); roadmap items enter the chain at `seo-assistant`, not as off-strategy one-offs (absent a recorded operator override).
  - [ ] The typed handoff chain holds end-to-end (`ContentStrategy → ContentBrief → ContentDraft → AuditResult`); no stage is skipped and no artifact is fabricated for a missing stage.
  - [ ] The 4th failed re-audit holds the piece at `review` (`forcedToHumanReview`) instead of looping forever.
- **Test plan:** Tier 1 — revise-cap unit test (4th failure holds). Tier 2 — `suite-chain.test.ts` golden regression across all four suite skills + typed-handoff assertions. Tier 3 — manual cluster generation producing a pillar + ≥3 funnel-staged spokes from an approved strategy.
- **Dependencies:** PR 008
- **Risk:** Med — three more suite skills wired into the loop; the golden harness is the regression guard against a model/tool-order/skill-config change degrading them.
- **Rollback:** Unregister the three suite skills; the writer-only path (PR 008) still functions.

*References: ch. 05 (bible v1.0.0, sha: 2c02fe80), ch. 17 (bible v1.0.0, sha: 2c02fe80)*

---

### PR 015 — Content-hub SSR render route + FAQ JSON-LD + placeholder stripping
- **Lane:** render-geo
- **Scope:** Build the per-client SSR route at `apps/seo/src/app/clients/[client]/blog/[slug]/page.tsx` (full body in initial HTML, FAQPage JSON-LD from `faq_data`, `[photo:]`/`[cta:]` resolution with unresolved-token stripping) plus per-client `sitemap.xml` + `robots.txt`. Stand up net-new vitest for `apps/seo` render (the surface had none). **The minimal body-only render (full article body present in the initial server HTML, status-filtered, cross-namespace 404) is the Slice-1 render floor** — it lands with Slice 1 so the declared-green slice actually renders a published piece; FAQ JSON-LD, placeholder resolution, sitemap/robots, and the hub homepage widen the render in Slice 2/3.
- **Files added/modified:** `apps/seo/src/app/clients/[client]/blog/[slug]/page.tsx`, `apps/seo/src/lib/render/{client-blog,build-faq-jsonld,resolve-placeholders}.ts`, `apps/seo/src/app/clients/[client]/sitemap.xml/route.ts`, `apps/seo/src/app/clients/[client]/robots.txt/route.ts`, `apps/seo/vitest.config.ts`, `apps/seo/test/render/{ssr-body,faq-jsonld,placeholder-strip,status-filter}.test.ts`.
- **Acceptance criteria:**
  - [ ] The full article body is present in the initial server HTML (no client-side fetch) — asserted by parsing the SSR response, not the hydrated DOM.
  - [ ] `faq_data` emits valid schema.org `FAQPage` JSON-LD (schema-validated in test).
  - [ ] Unresolved `[photo:slug]`/`[cta:type]` tokens are stripped, never leaked as literal text.
  - [ ] A slug belonging to another client resolves to `null` and 404s; only `status='published'` rows render (cross-namespace + status-filter tests).
- **Test plan:** Tier 1 — render unit tests (body-in-HTML, JSON-LD validity, placeholder strip, 404 on cross-client slug). Tier 2 — SSR response snapshot asserts body presence + JSON-LD block. Tier 3 — manual fetch of a published piece + `curl` of the JSON-LD.
- **Dependencies:** PR 009
- **Risk:** Med — any CSR slip kills the GEO thesis (crawlers don't run JS); the net-new vitest is the guard.
- **Rollback:** Route published pieces to a minimal body-only template; disable sitemap/robots routes.

*References: ch. 14 (bible v1.0.0, sha: 2c02fe80), ch. 13 (bible v1.0.0, sha: 2c02fe80)*

---

### PR 016 — CI reachability gate (sitemap == published-and-indexable set, both directions)
- **Lane:** render-geo
- **Scope:** Add a CI reachability gate that asserts the per-client `sitemap.xml` exactly equals the published-and-indexable set in both directions — catching orphans (published but not in sitemap) AND stale entries (in sitemap but not published/indexable).
- **Files added/modified:** `apps/seo/test/render/reachability-gate.test.ts`, `apps/seo/src/lib/render/indexable-set.ts`, CI workflow step in `.github/workflows/seo.yml`.
- **Acceptance criteria:**
  - [ ] A published piece missing from the sitemap fails the gate (orphan direction).
  - [ ] A sitemap entry for a non-published/`noindex` piece fails the gate (stale direction).
  - [ ] A `noindex` piece co-existing with a `robots.txt` Disallow on the same path fails a lint (the contradictory-signal guard).
- **Test plan:** Tier 1 — reachability unit test (both directions + the noindex/Disallow lint). Tier 2 — the gate runs in CI against a seeded multi-piece fixture. Tier 3 — manual sitemap diff against the published set.
- **Dependencies:** PR 015
- **Risk:** Low
- **Rollback:** Demote the gate to a warning; render still works.

*References: ch. 13 (bible v1.0.0, sha: 2c02fe80)*

---

### PR 017 — Generated resource-library homepage (D7) + imagegen hero resolution
- **Lane:** render-geo
- **Scope:** Build the net-new resource-library homepage template fed by the `clusterRole`/`funnelStage` columns (hero, statistic callout, named three-stage cluster section, guide-card grid, quality section, tour CTA + license badge) and wire `packages/videogen/imagegen` in-process to resolve `[photo:slug]` placeholders into healthcare-appropriate imagery with a recorded provenance record.
- **Files added/modified:** `apps/seo/src/app/clients/[client]/page.tsx` (homepage), `apps/seo/src/lib/render/hub-homepage.ts` (cluster-map query off the first-class columns), `apps/seo/src/lib/tools/hero-image.ts` (in-process `generateHeroImage` from `@sagemark/imagegen`, async/job-wrapped, tenancy + cost-cap enforced host-side), `apps/seo/test/render/homepage.test.ts`, `apps/seo/test/tools/hero-provenance.test.ts`.
- **Acceptance criteria:**
  - [ ] The homepage queries pieces by `client_id` and groups them by `funnel_stage` with `cluster_role` labels (driven by the first-class columns, not `brief_snapshot` jsonb).
  - [ ] Each spoke card links to its piece; the pillar links out to every spoke (no orphan spoke by construction).
  - [ ] A generated hero image carries a recorded license/provenance record; an asset with no provenance is blocked from rendering.
  - [ ] Only `[photo:slug]` placeholders with empty stock trigger generation; resolved placeholders pass through; image generation is async/job-wrapped (never synchronous blocking the render).
- **Test plan:** Tier 1 — homepage grouping + orphan-detection unit test; `hero-provenance.test.ts` (no-provenance asset blocked). Tier 2 — render the full Whispering Willows hub homepage from a seeded cluster. Tier 3 — manual visual diff of the generated homepage vs the golden demo.
- **Dependencies:** PR 014 (cluster map), PR 015 (render route)
- **Risk:** Med — net-new template + an external imagegen dependency; the provenance block is the publish-safety guard.
- **Rollback:** Serve a flat published-pieces list instead of the homepage; disable hero generation (placeholders strip).

*References: ch. 14 (bible v1.0.0, sha: 2c02fe80), ch. 07 (bible v1.0.0, sha: 2c02fe80)*

---

### PR 018 — Tokenized client-review preview + pinned comments + section verbs
- **Lane:** client-review
- **Scope:** Build the tokenized, fail-closed client-review surface: an opaque token resolving to exactly one `(workspace_id, client_id, piece_id, version)`, rendering the real SSR hub in a same-origin sandboxed iframe with element-anchored pinned comments (reuse `PinOverlay` + `PreviewClickHandler` + `useIframePinDrop`) and section-level Approve / Request-changes (reuse `ApprovalBeat`), plus the paired `SerpPreview`.
- **Files added/modified:** `apps/seo/src/app/review/[token]/page.tsx`, `apps/seo/src/lib/review/resolve-token.ts`, `apps/seo/src/app/review/[token]/{PinOverlay,PreviewClickHandler}.tsx` + `hooks/useIframePinDrop.ts` (ported from videogen), `apps/seo/src/app/review/[token]/SectionApprovalBeat.tsx`, `apps/seo/src/app/review/[token]/SerpPreview.tsx`, `apps/seo/src/app/api/review/comments/route.ts`, `apps/seo/test/review/token-scope.test.ts`.
- **Acceptance criteria:**
  - [ ] A review token grants read of exactly one `(client_id, piece_id, version)`; a request for another client's piece or another version under the same token returns 404/zero rows (the agency-ending-leak test, both directions).
  - [ ] The client surface never renders the gate scorecard, credits, cost, model, or raw markdown export (asserted absent in the rendered tree).
  - [ ] A pinned comment persists with normalized 0..1 coords + `elementHint` + `version_left_on`, scoped by `workspace_id`/`client_id`; the iframe message is origin/source/finite-coord validated.
  - [ ] Section Approve / Request-changes verbs persist a `review_comments` row with the correct `kind` (section-approve | request-changes); approval is recorded but does not itself release a YMYL piece.
- **Test plan:** Tier 1 — `token-scope.test.ts` (one-tuple scope, cross-tenant/cross-version denial); client-surface-exposure test (no scorecard/credits leaked). Tier 2 — drop a pin via a validated iframe message and assert the persisted anchor. Tier 3 — manual: open a review token, pin a comment, approve a section.
- **Dependencies:** PR 015, PR 017
- **Risk:** High — the review link is the most likely place to leak the #1 cross-tenant bug; the token is a fail-closed row-scoped boundary, never a render-time flag.
- **Rollback:** Disable the `/review/[token]` route; clients review over a shared screen with the operator instead.

*References: ch. 03 (bible v1.0.0, sha: 2c02fe80), ch. 14 (bible v1.0.0, sha: 2c02fe80)*

---

### PR 019 — "Request changes" → agent edit loop routing + named sign-off + approval-debt KPI
- **Lane:** client-review
- **Scope:** Route a client "Request changes" comment into the PR 012 agent edit loop (operator triages → `/api/edit` with the comment's `elementHint`/section anchor as a scoped instruction), and write the two sign-off acts as **separate persisted records in the PR 004 `0032` tables** — a `client_signoffs` row (the client/agency contact: advisory approval / comment resolution) and a `credentialed_releases` row (the credentialed reviewer, D6: the release that `canPublish()` reads as its source of truth). Each is its own table/row with its own actor, permissions, timestamp, and UI label; only `credentialed_releases` writes the named undeletable release version and supplies the byline (via its `credential` snapshot + `authorization_id`). Instrument approval-cycle time + open-thread count ("approval debt") per client.
- **Files added/modified:** `apps/seo/src/app/api/review/route-to-edit/route.ts`, `apps/seo/src/lib/review/comment-to-instruction.ts`, `apps/seo/src/lib/review/signoff.ts` (writes the two distinct persisted records: a `client_signoffs` row = advisory; a `credentialed_releases` row = the only one that writes the named release version + the E-E-A-T "Reviewed by [Name, Credential]" byline from its `credential` snapshot), `apps/seo/src/lib/metrics/approval-debt.ts`, `apps/seo/src/app/(studio)/inspector/ApprovalDebtPanel.tsx`, `apps/seo/test/review/route-to-edit.test.ts`.
- **Acceptance criteria:**
  - [ ] A "Request changes" comment, once an operator triages it, becomes a bounded `/api/edit` instruction anchored to the commented region; the comment thread updates to "addressed in vN — see diff."
  - [ ] `client_signoffs` and `credentialed_releases` are **separate persisted tables** (PR 004 `0032`) with separate actors, permissions, timestamps, and UI labels. A client "Approve" writes only a `client_signoffs` row (advisory: resolves comments / advisory-approves) and can NEVER release or supply reviewer credentials — `canPublish()` reads `credentialed_releases` as the source of truth and accepts only a `credentialed_release` as the human release for a YMYL piece (test asserts a `client_signoffs` row alone leaves the piece unreleasable and never populates the byline).
  - [ ] Only a `credentialed_releases` row (by the credentialed reviewer, D6) writes the named, undeletable release version recording the reviewer's identity + `credential` snapshot + `authorization_id`; that record is the **sole** source of the YMYL "Reviewed by [Name, Credential]" byline — a `client_signoffs` row carries no `credential`/`authorization_id` and is structurally incapable of supplying reviewer credentials.
  - [ ] **The release write requires an active byline authorization (§11.5, fail-closed):** `signoff.ts` writes a `credentialed_releases` row only when its `authorization_id` resolves to an **active** `byline_authorizations` row (granted, not revoked, not expired); an attempt to release against a revoked/expired/inactive authorization is refused (no release written, publish stays blocked) — a test asserts the three inactive cases are blocked at write time and an active one succeeds.
  - [ ] Approval-cycle time (link-sent → `client_signoffs` row, and `draft→review` → `credentialed_releases` row) and open-thread count are computed per client and surfaced in the operator panel.
- **Test plan:** Tier 1 — `comment-to-instruction` scoping test; client-approve-does-not-release test; approval-debt computation test. Tier 2 — end-to-end: client requests changes → operator routes → agent edits → new re-gated version → thread resolves. Tier 3 — manual full review cycle on a Whispering Willows piece.
- **Dependencies:** PR 012, PR 018; **PR 004 (the `0032` `client_signoffs` / `credentialed_releases` tables) + PR 009 (`canPublish()` reading `credentialed_releases`)**
- **Risk:** Med — the gate re-runs in host code on every routed edit; a client instruction cannot talk past a YMYL/faithfulness veto.
- **Rollback:** Disable routing (comments stay advisory); operators apply edits manually via the studio canvas.

*References: ch. 17 (bible v1.0.0, sha: 2c02fe80), ch. 09 (bible v1.0.0, sha: 2c02fe80)*

---

### PR 020 — Separate SEO cost ledger (AI Gateway) + share-of-model instrumentation
- **Lane:** worker-runtime
- **Scope:** Stand up the separate SEO AI-Gateway cost ledger (D4) — pre-flight cost reservation via a lock-row conditional UPDATE, per-stage cost/latency recorded from Gateway usage against the ≤$2 editorial target — and instrument the north-star share-of-model KPI (AI-answer-engine citation tracking per published hub).
- **Files added/modified:** `apps/seo/src/lib/ledger/seo-cost-ledger.ts`, `apps/seo/src/lib/ledger/reserve-conditional.ts` (lock-row conditional UPDATE, not sum-then-check), `packages/schema-flywheel/drizzle/0039_seo_cost_ledger.sql`, `apps/seo/src/lib/metrics/share-of-model.ts`, `apps/seo/src/app/(studio)/inspector/CostLedgerPanel.tsx`, `apps/seo/test/ledger/reserve.test.ts`.
- **Migration SQL (inline, `0039` — reconciled to shipped reality per audit-005 / DR-038; creates THREE tables):**
  ```sql
  -- 0039_seo_cost_ledger.sql
  CREATE TABLE seo_cost_ledger (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL,
    client_id     uuid NOT NULL REFERENCES content_clients(id) ON DELETE RESTRICT,
    piece_id      uuid REFERENCES content_pieces(id) ON DELETE SET NULL,
    run_id        uuid NOT NULL,
    stage         text NOT NULL,           -- brief|draft|faithfulness|gate|edit|hero-image
    reserved_usd  numeric(10,4) NOT NULL DEFAULT 0,
    actual_usd    numeric(10,4),
    model         text,
    latency_ms    integer,
    created_at    timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX seo_cost_ledger_run_idx    ON seo_cost_ledger (run_id);
  CREATE INDEX seo_cost_ledger_client_idx ON seo_cost_ledger (client_id, created_at);
  ALTER TABLE seo_cost_ledger ENABLE ROW LEVEL SECURITY;  -- no anon policy: cost is never public

  -- The per-run ACCUMULATOR + the single lock-row the conditional-UPDATE
  -- reservation targets. ONE row per run_id; reserved_usd is atomically
  -- incremented under the row lock with the `reserved_usd + cost <= cap_usd`
  -- guard, so a concurrent over-cap reservation is rejected by the predicate
  -- (no sum-then-check race). This is what makes the AC1 atomicity guarantee
  -- runnable on the LIVE schema (not just the in-memory CostAccountant model).
  CREATE TABLE seo_cost_run_budget (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL,
    client_id     uuid NOT NULL REFERENCES content_clients(id) ON DELETE RESTRICT,
    run_id        uuid NOT NULL UNIQUE,        -- one budget row per run
    cap_usd       numeric(10,4) NOT NULL,      -- the run's ≤$2 editorial cap
    reserved_usd  numeric(10,4) NOT NULL DEFAULT 0
  );
  ALTER TABLE seo_cost_run_budget ENABLE ROW LEVEL SECURITY;  -- no anon policy

  CREATE TABLE share_of_model (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    uuid NOT NULL,
    client_id       uuid NOT NULL REFERENCES content_clients(id) ON DELETE RESTRICT,
    piece_id        uuid REFERENCES content_pieces(id) ON DELETE SET NULL,
    engine          text NOT NULL,           -- free-text: chatgpt|claude|gemini (DR-038, reconciled to shipped reality per audit-005; perplexity = deferred 4th)
    query           text NOT NULL,           -- the normalized prompt actually sent
    cited           boolean NOT NULL,
    position        integer,
    raw_response    text,                    -- raw engine response (auditable / re-parseable)
    parser_conf     numeric(4,3),            -- citation-extraction confidence 0..1
    audit_sampled   boolean NOT NULL DEFAULT false,  -- flagged for manual audit
    source_channel  text NOT NULL DEFAULT 'direct',  -- HYBRID 3-channel set (DR-038 addendum): direct-citation (real cited source) | direct-proxy (model-API answer = mention only, NEVER summed as a citation) | vendor (GEO-tracker, deferred). Free-text; DEFAULT 'direct' is the legacy sentinel — the live store writes the hybrid labels.
    locale          text,                    -- geo/region the probe ran under
    device_profile  text,                    -- device profile the probe ran under
    captured_at     timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX share_of_model_client_idx ON share_of_model (client_id, captured_at);
  ALTER TABLE share_of_model ENABLE ROW LEVEL SECURITY;
  ```
- **Acceptance criteria:**
  - [ ] Cost is reserved pre-flight via a lock-row conditional UPDATE (a concurrent over-cap run is rejected, not silently over-spent) — concurrency test.
  - [ ] Per-stage `actual_usd` + `latency_ms` are recorded from Gateway usage; a per-piece cost is measured (not estimated) and compared against the ≤$2 target.
  - [ ] **Gateway-disabled ⇒ no model call:** a worker run launched with the Gateway base URL absent/disabled (and no fallback provider key) makes **zero** model calls — it fails fast with a stable "no model seam" error, and a network attempt to the raw Anthropic endpoint is refused by the PR 006b egress allowlist (test). This proves the seam is the only model path, not a convention.
  - [ ] **Per-run reconciliation:** the ledger's per-`run_id` token/cost records reconcile against the Gateway's reported usage for that run (within tolerance); an unreconciled gap (a call that escaped the seam) fails the check.
  - [ ] The gate-block-by-sourcing rate (`VETO_UNSOURCED_STAT` + low-faithfulness-from-thin-sources share) is computed — the D3 reversal trigger (instrumenting the D2×D3 tension).
  - [ ] Share-of-model citation checks persist per `(client_id, engine, query)` and roll up to a per-hub citation rate.
- **Test plan:** Tier 1 — `reserve.test.ts` (conditional-UPDATE concurrency, over-cap rejection); sourcing-block-rate computation test. Tier 2 — a full run writes per-stage ledger rows summing to a measured per-piece cost. Tier 3 — manual: run a cluster, read the measured cost-per-piece and the gate-block-by-sourcing rate from the ledger.
- **Dependencies:** PR 007, PR 015, PR 006b (the egress allowlist the Gateway-disabled / reconciliation tests assert against)
- **Risk:** Med — sum-then-check race is the classic ledger bug; the lock-row conditional UPDATE is the guard.
- **Rollback:** Drop `0039` (all three tables: `seo_cost_ledger`, `seo_cost_run_budget`, `share_of_model`); fall back to `CostAccountant` in-memory reservation only (no persisted ledger, no share-of-model rollup).

*References: ch. 16 (bible v1.0.0, sha: 2c02fe80), ch. 17 (bible v1.0.0, sha: 2c02fe80)*

---

### PR 021 — Share-of-model citation-ingestion cron + freshness cron (the north-star feed)
- **Lane:** worker-runtime
- **Scope:** Build the two crons the north-star KPI and the compounding loop depend on but that prior slices only specified as a table. (1) The **SoM citation-ingestion cron** — treated as a *measurement subsystem*, not a one-shot fetch — poses each client's funnel-staged query bank to the tracked answer engines (ChatGPT/Claude/Gemini — DR-038, reconciled to shipped reality per audit-005; Perplexity = deferred 4th) on a weekly cadence and writes durable citation rows to `share_of_model`. (2) The **freshness cron** scans published pieces past a staleness threshold and emits a refresh **draft** only — never an auto-publish (per §1 non-goals); a refreshed draft re-enters the gate + human-release path like any other. Both emit heartbeats so a wedged cron alerts rather than stalling silently.
- **SoM measurement-subsystem design (the specifics that make the metric trustworthy):**
  - **Provider-specific adapters.** One adapter per engine (`chatgpt` / `claude` / `gemini` — DR-038, reconciled to shipped reality per audit-005; `perplexity` = deferred 4th) behind a common `SomAdapter` interface — each engine's query/response shape and citation-extraction differ, so they are not one code path.
  - **Stored prompts + responses.** Every probe persists the *normalized prompt sent* and the *raw response received* (not just the boolean `cited`), so a citation claim is auditable and re-parseable when an adapter improves.
  - **Prompt normalization.** Queries are normalized (canonical phrasing per funnel stage) so week-over-week trends compare like-for-like, not drift from re-worded prompts.
  - **Rate-limit budgets per engine.** Each adapter runs under a configured request budget; over-budget probes defer to the next window rather than tripping a ban, and a degraded engine logs a miss + heartbeat rather than crashing the cron.
  - **Parser confidence + manual audit sampling.** Each extracted citation carries a parser-confidence score; a sampled fraction is flagged for periodic manual audit so parser error is *measured*, not assumed zero.
  - **Geographic / device variance.** The probe records the locale/region/device profile it ran under (answers vary by geo/device), so a citation rate is qualified by where it was observed, not reported as universal.
  - **Hybrid source-channel model (DR-038 addendum) — proxy ≠ citation.** Each row records a `source_channel` ∈ {`direct-citation`, `direct-proxy`, `vendor`}: `direct-citation` = the direct Gateway path that returns a REAL cited source (Claude + the web-search tool) — a genuine SoM citation signal; `direct-proxy` = a direct Gateway MODEL-API answer used as a PROXY (ChatGPT/Gemini) — a model-answer **mention**, NOT a consumer-engine citation; `vendor` = a contracted GEO-tracker (real consumer-engine citations, **deferred** — the seam is pre-wired). The dashboard reports `direct-citation`+`vendor` as the **citation rate** and reports `direct-proxy` separately as **"API-answer mention rate (proxy)"** — a proxy row is **never** summed into the citation rate.
  - **ToS compliance + vendor-API fallback.** Where an engine's ToS forbids or rate-limits direct querying, or direct querying proves unreliable, the adapter falls back to the vendor's official API / a sanctioned data source behind the same `SomAdapter` interface — the fallback is pre-wired (the deferred `vendor` channel above), so a blocked engine degrades to its API path rather than going dark.
- **Files added/modified:** `apps/seo/src/cron/ingest-share-of-model.ts`, `apps/seo/src/cron/freshness-scan.ts`, `apps/seo/src/lib/metrics/query-bank.ts` (per-client funnel-staged query bank off the `clusterRole`/`funnelStage` map), `apps/seo/src/lib/metrics/som-adapters/{chatgpt,claude,gemini,types}.ts` (provider adapters + the common interface + the vendor-API fallback; `perplexity` deferred per DR-038), `apps/seo/src/lib/metrics/som-parse.ts` (citation extraction + confidence + normalization), `apps/seo/vercel.json` (cron schedule), `apps/seo/test/cron/{som-ingest,freshness}.test.ts`, `apps/seo/test/metrics/som-adapters.test.ts`.
- **Acceptance criteria:**
  - [ ] **Measurement-feasibility spike FIRST (gates the rest of this PR).** Before building the adapters, a feasibility spike proves **≥3 legal/reliable citation-measurement channels** actually exist — naming the candidate **sanctioned APIs/providers** per engine (e.g. an official engine API where one exists, or a contracted GEO-tracker vendor such as Profound/AthenaHQ for an engine with no sanctioned direct path) and recording, for each, its **quota and per-run cost**. The spike output is a one-page channel matrix `{engine, channel, sanctioned?, quota, per-run $, citation-signal reliability}`. If fewer than 3 engines expose a legal/reliable citation channel, the **degraded v1 metric** below ships instead of the ≥3-engine metric.
  - [ ] **Gated on real credentials / a contracted vendor, not mocks.** PR 021's DoD is auditable rows landing from **real adapter credentials or a contracted measurement vendor** for the channels the spike confirmed — a fully-mocked adapter suite is *not* sufficient to close this PR (mocks remain valid for Tier-1/Tier-2 unit/integration tests, but the metric is not "done" until at least the confirmed channels produce real rows for the Whispering Willows hub).
  - [ ] **Degraded v1 metric defined.** If only 1–2 engines expose reliable citation behavior, share-of-model ships as a **single-/dual-engine metric explicitly labeled as such** (the rows record which engines are covered; the per-hub rate is qualified "citation rate across {covered engines}", never reported as universal share-of-model), and the uncovered engines are recorded as a known gap with their blocking reason — rather than faking a ≥3-engine number.
  - [ ] The SoM ingestion cron poses the per-client query bank to ≥3 answer engines (or the degraded set above) via **provider-specific adapters** and **populates `share_of_model`** with `{client_id, piece_id, engine, query, cited, position, captured_at}` durable rows plus the **stored normalized prompt + raw response + parser-confidence + locale/device profile** (the north-star feed; DoD is auditable rows landing, not a dashboard number).
  - [ ] Each adapter honors a **per-engine rate-limit budget** and **ToS**; an over-budget or ToS-restricted engine **falls back to the sanctioned vendor API** (or logs a heartbeat miss) behind the same interface, never crashing the cron or scraping past a ban.
  - [ ] Queries are **normalized** before probing so week-over-week trends compare like-for-like; a sampled fraction of citations is flagged for **manual audit** and parser confidence is recorded per row.
  - [ ] Share-of-model is a derived ratio (citations won / queries posed) trendable per client and per piece off the persisted rows, qualified by the recorded geo/device profile.
  - [ ] The freshness cron emits a refresh **draft** for a stale published piece and **never** flips a row to `published` — the refreshed draft re-runs the full gate and still requires a recorded human release.
  - [ ] Both crons emit a heartbeat; a missed heartbeat raises an alert (no silent stall).
- **Test plan:** Tier 1 — query-bank construction + prompt-normalization + per-adapter parse/confidence unit tests; rate-limit-budget + ToS-fallback unit test; `share_of_model` row-write (incl. stored prompt/response) test; freshness-cron emits-draft-never-publishes test. Tier 2 — a scheduled run populates `share_of_model` against a mocked multi-engine set (one engine forced to its API fallback) and a per-hub citation rate rolls up. Tier 3 — manual cron trigger reading real citation rows + a manual-audit spot-check of stored prompts/responses for the Whispering Willows hub.
- **Dependencies:** PR 020 (the `seo_cost_ledger`/`share_of_model` tables), PR 017 (cluster map for the query bank); **the measurement-feasibility spike (above) must confirm ≥3 legal/reliable channels — or pin the degraded v1 metric — before the adapters are built.**
- **Risk:** Med-High — external answer-engine citation measurement may have **no** sanctioned ≥3-engine path; the feasibility of measuring share-of-model at all is itself an assumption (PRD §15a). Mitigated by the feasibility spike, gating on real credentials / a contracted vendor (not mocks), the defined degraded v1 metric, per-engine budgets + the sanctioned vendor-API fallback + parser-confidence sampling — and the cron degrades to a logged miss + heartbeat alert, never a crash.
- **Rollback:** Disable both crons (no `share_of_model` ingestion, no freshness drafts); the rest of the build is unaffected.
- **Owner:** James (per NE-3 / the north-star instrumentation)

*References: ch. 17 (bible v1.0.0, sha: 2c02fe80), ch. 13 (bible v1.0.0, sha: 2c02fe80)*

---

**Slice summary.** PR 001–009 (plus the worker-safety PR 006b) are the thinnest green vertical (brief → worker draft → host-enforced gate → render-ready `draft` → fail-closed publish), proving the ported moat + worker topology + worker capability-denial + SSE hop + RLS + voice hard-stop before any surface widens. PR 010–014 add the agent canvas, live streaming, conversational fine-tune, versioning, and the full four-skill suite wired into the worker (the complete `ContentStrategy → ContentBrief → ContentDraft → AuditResult` chain). PR 015–021 add the crawlable hub (SSR + reachability gate + generated homepage + imagery), the fail-closed client-review surface with feedback-into-edit routing, the separate cost ledger + share-of-model tables, and the SoM citation-ingestion + freshness crons that actually feed the north-star KPI and the compounding loop. The high-risk PRs (006 worker, 006b capability-denial, 018 review token) are isolated behind flags/routes so a rollback never blocks the rest of the build.

*References: ch. 05 (bible v1.0.0, sha: 2c02fe80), ch. 11 (bible v1.0.0, sha: 2c02fe80)*

## 5 · Lanes (parallelism map)

Six lanes, derived from this project's reuse boundary (ported moat vs. net-new worker + UI + render). Lanes are sized so the **deterministic moat and schema land before the agent**, and the **worker topology is proven on the thinnest slice before the surface widens** (per the DECISIONS.md Phase-1-inflation note).

- **Lane A — engine-port** (`@sagemark/core`): scorers, faithfulness gate (`drafter≠verifier`), `seo-gate` A→B, `lifecycle-fsm` `canPublish()`, `CostAccountant`, provider seam. Pure functions; lowest risk; unblocks everything.
- **Lane B — schema-tenancy** (`schema-flywheel`): port `0030`, add `0031` cluster columns + `0032` release/signoff split + `0039` aux ledger (the shipped `seo_cost_ledger`/`seo_cost_run_budget`/`share_of_model` migration; numbered `0039` per audit-005, not `0033`), RLS + the 4-layer tenancy test.
- **Lane C — worker-runtime** (Agent-SDK worker on Vercel Sandbox): boot the SDK worker, the autonomous loop, the authed host-tool bridge, and run-dispatch/resume. The D5/D9-specific lane and the highest-novelty risk.
- **Lane D — agent-ui** (`apps/seo` canvas + SSE relay): three-zone canvas, the worker→Vercel→browser SSE relay, `/api/run·/api/edit·/api/publish`, conversational fine-tune.
- **Lane E — render-geo** (`apps/seo` public SSR routes + homepage): SSR full-body, FAQPage JSON-LD, placeholder stripping, sitemap/robots, CI reachability gate, the **generated hub homepage** (D7), imagegen `[photo:]` resolution.
- **Lane F — client-review** (review token + feedback): tokenized fail-closed preview, pin/section-verb threads, "Request changes"→edit-loop routing, named-version sign-off, server-resolved YMYL byline.

```
            ┌──────────────────────┐
            │ Lane A engine-port    │  (scorers/gate/FSM → @sagemark/core)
            └──────────┬───────────┘
                       │
      ┌────────────────┼────────────────────────────┐
      ▼                ▼                              ▼
┌───────────┐   ┌───────────────┐            ┌────────────────┐
│Lane B      │   │Lane C worker- │            │ (golden set,   │
│schema-     │   │runtime         │            │  Phase 0,      │
│tenancy     │   │(Sandbox+bridge)│            │  gates A & C)  │
└─────┬──────┘   └───────┬───────┘            └────────────────┘
      │                  │
      └────────┬─────────┘
               ▼
        ┌──────────────┐
        │Lane D agent-ui│  (canvas + SSE relay; needs A,B,C)
        └──────┬───────┘
               ▼
        ┌──────────────┐        ┌────────────────┐
        │Lane E render- │◀──────│Lane F client-   │
        │geo (needs B,E │       │review (needs D  │
        │schema+pieces) │       │edit-loop + E    │
        └──────────────┘        │render surface)  │
                                └────────────────┘
```

Critical path: **A → C → D → F**. Lane B parallels A→C and must land its `0031` cluster columns before Lane E's homepage. Lane E's render surface and Lane F's review token both depend on real published-shape pieces from D. The golden set (Phase 0) is an input gate to A (scorer regression) and C (prompt/loop regression).

*References: ch. 06 (bible v1.0.0, sha: 2c02fe80), ch. 07 (bible v1.0.0, sha: 2c02fe80)*

## 6 · Non-engineering deliverables

| # | Deliverable | Owner | Blocks | Detail |
|---|---|---|---|---|
| **NE-1** | **Credentialed YMYL reviewer staffed + backup named** (D6) | **James** | **YMYL publish** (the binding go-live constraint; no memory-care page ships without it) | Supply a number (pages/week one reviewer clears) **and** a name (the backup). **Get the early read by dry-running the reviewer over the Phase-0 golden corpus** (time them releasing the ~8 labeled pieces) — that pages/week number is the go-live constraint, the pricing floor (§13), and the throughput ceiling at once. With D2 = hard gate, the credentialed reviewer holds release authority on every YMYL piece; this is product-level release gating, not plan-level signoff. Needed before Whispering Willows go-live, not before the build starts. Date-by 2026-08-15. |
| **NE-2** | **Whispering Willows content brief + sources** | James (with client) | Phase-0 golden set; Phase-1 first piece | The pillar + ~8 spoke topics, the named authorities (Alzheimer's Association, NIA), the DSHS license badge data, disclaimer text, and the approved `voice_specs` row (tone, banned lexicon, author registry). The live demo is the golden reference; this is the inbound source contract the gate grounds against. |
| **NE-3** | **Pricing finalized from the live ledger** (D4) | James | v1 commercial launch (not the build) | Per-seat / per-piece SaaS + a **separate AI-Gateway SEO ledger**. Calibrate per-asset cost (incl. reviewer time) from `seo_cost_ledger` after the first cluster, then set the price. Confirm D4: do not reuse the VideoGen credits wallet. |
| **NE-4** | **Ops runbook + incident response + SLOs** (see PRD §9.6) | James | **Whispering Willows go-live** (not the build) | A written runbook before the first piece publishes publicly: alert thresholds + who is paged + escalation path; rollback commands (kill switch / unpublish / disable worker flag); data-repair scripts (orphaned-run cleanup, replay from the last `content_piece_versions` snapshot); customer incident templates (what the agency tells its client if a published piece must be pulled); audit-log queries (who released a piece, when, against which evidence); and the SLO targets below. This is a *publish-readiness* artifact, not engineering code — a YMYL surface cannot go live without a "what do we do at 2am when a bad memory-care claim is live" answer. |

**SLO targets (the runbook's numeric spine):**

| SLO | Target | Why |
|---|---|---|
| Publish (SSR serving) availability | 99.9% monthly | Published hubs are the asset; downtime is invisibility to crawlers + clients |
| Worker run completion (brief → gated draft, ex-revise) | ≥ 99% of runs reach a terminal state (gated draft or stable error), 0 silent zombies | The §1 budgets are latency; this is *liveness* — no run wedges forever |
| Gate latency (Stage-A+B as a tool call) | ≤ 15 s p95 (per §1) | A slow gate stalls the loop; a timed-out faithfulness gate is a YMYL hard block, never a pass |
| Unpublish / Removals propagation | live piece 404/410s within one render cycle; Search Console Removals request fired ≤ 5 min | A bad YMYL claim must come down fast — the kill switch is only as good as its propagation |

*References: ch. 13 (bible v1.0.0, sha: 2c02fe80), ch. 16 (bible v1.0.0, sha: 2c02fe80)*

## 7 · Rollout plan

**Phase 0 — de-risk (≈0.5 wk).** `git fetch origin preview`; read the real engine (`content_pieces`, `seo-gate`, `lifecycle-fsm`, the four `seo-copywriter` suite skills, and the `/content/api/*` routes they orchestrate). Capture the live Whispering Willows hub (pillar + 8 spokes + homepage) as a checked-in **golden corpus** with human labels (cluster role, funnel stage, expected dimension scores, expected Stage-A clean/veto) **before the suite is wired into the worker** — the only guard against methodology-fidelity drift in an autonomous loop (D1). Transcribe `judge-prompt.md` into `gate-spec.ts` acceptance stubs. **Dry-run the credentialed reviewer (D6) over the golden corpus** — time them releasing the ~8 labeled Whispering Willows pieces to get an early **pages/week** number. That number is load-bearing three ways at once: it is the YMYL go-live constraint (NE-1), the pricing floor (per-piece SaaS prices the scarce reviewed asset, §13), and the throughput ceiling (reviewer capacity, not the model, caps publish rate) — so it must be measured early, not assumed. Ships no runtime; this is the floor the estimate rests on.

**Phase 1 — thinnest end-to-end slice first.** Per the DECISIONS.md scope-inflation note (D1+D2+D5+D7 stack), the **canonical Slice-1 DoD** (identical to PRD §0 / PRD §12 / RFC §4) = **brief → a single worker-hosted drafter call (over the SSE relay) → host-enforced gate (the `/content/api/audit` route) → a MINIMAL SSR render → one bounded edit → re-gate → a gated version — NOT the full self-revising autonomous loop/canvas, which arrives in Slice 2.** Build **one client, one approved voice spec, one YMYL piece**: brief → a single worker-hosted drafter call streamed over the SSE relay → host-enforced faithfulness gate + `seo-gate` (Stage-A vetoes then Stage-B composite) → persist as `draft` scoped by `workspace_id`/`client_id` → a **minimal body-only SSR render** of the published piece → **one bounded edit that re-runs the full gate and writes a gated version** → **prove it cannot reach `published`** without `verdict==='PUBLISH'` ∧ `evalRan` ∧ recorded human release ∧ (YMYL) a server-resolved credentialed byline + citations. This single slice exercises every load-bearing decision — the ported moat, the host-enforced non-compensatory gate, the fail-closed FSM, RLS, the voice-spec hard stop, the provider seam + cost accounting, the worker topology + SSE relay, the minimal render, one bounded re-gate, and golden regression — while deliberately omitting the full self-revising autonomous loop/canvas, the hub homepage, imagegen, multi-piece hub, and client review. Those land **after** the slice is green (Slice 2+), so the worker/loop/gate are proven before the surface widens.

**Kill-switch design (disable release).** The chokepoint is the `published` transition. The kill switch **disables release without stopping drafting**: a global `publishEnabled` flag is an explicit precondition inside `canPublish()` (off ⇒ no row can flip to `published`, drafting and gating continue). Unpublishing a live piece reverts the SSR render, emits an instant **410 Gone** + a Search Console Removals request, applies `noindex` (with a lint forbidding a co-existing `robots.txt Disallow` that would block re-crawl of the `noindex`), and flips the row out of `published`. Because the Sandbox is ephemeral, the kill switch lives in `@sagemark/core` host code, never in the worker.

**Feature-flag design.** Flags are read host-side (`apps/seo` / `@sagemark/core`), never trusted from the worker. v1 flags: `publishEnabled` (the kill switch), `generationEnabled` (circuit-breaker — pause new runs while keeping the serving surface live), `homepageGenEnabled` (D7 homepage rollout, off until Phase 3), `imagegenEnabled` (Phase 3), and `serpProvider` (`ddg` default; flips to a SERP API behind the same `brief.sources` contract if the D3 sourcing-block rate forces the reversal — a cheap, pre-wired switch). Worker **warm-pool**: keep a small pool of pre-booted Sandbox microVMs to keep first-token latency inside the ≤4 s p95 budget; the pool size is a flag. **A pooled VM holds NO tenant binding while idle** — it carries no `workspace_id`/`client_id`, no scoped tools, and no bridge token. A VM becomes tenant-bound only when `/api/run` leases it and injects the per-run scoped host tools + the per-run JWT (scoped `(workspace_id, client_id, run_id)`); on lease handoff the Sandbox working directory is **wiped and the `claude` subprocess restarted**, so no prior run's working-dir or session state can survive into the next tenant's run. This reconciles "per-run Sandbox" with "warm pool of pre-booted microVMs": the pool optimizes boot latency only, never tenant state — recycling a VM is indistinguishable, to the next run, from a cold boot.

*References: ch. 09 (bible v1.0.0, sha: 2c02fe80), ch. 16 (bible v1.0.0, sha: 2c02fe80)*

## 8 · Risks at engineering level

| Risk | Severity | Mitigation |
|---|---|---|
| **Worker cold-start / state-loss on ephemeral Sandbox (D9)** | High — first-token latency + lost runs | All durable state persists to Supabase (system of record); the Sandbox FS is scratch-only. Runs are resumable from the last persisted snapshot. A **warm-pool** of pre-booted microVMs amortizes cold-start under the ≤4 s budget. A microVM dying mid-run loses no committed state; the orchestrator re-dispatches from the last `content_piece_versions` snapshot. |
| **SSE relay reliability (worker → apps/seo → browser, the D5 hop)** | High — the "watch it work" demo breaks silently | Heartbeat/keepalive frames on the relay; client auto-reconnect on `last_event_id` where the relay **re-reads the persisted `content_pieces` (+ its persisted scorecard/verdict) as the truth snapshot** (no `gate_results` table — the scorecard is on the piece/version row, DR-039) and resumes only deltas after the cursor; the relay is **stateless re: truth** — a dropped stream never loses data because the canonical artifact is the persisted row, not the stream. OQ-1 (SSE-vs-poll) is tracked in §9 and **must resolve in Slice 1 before the UI widens**; if relay reliability is poor, fall back to a poll-the-row transport behind the same UI contract. |
| **Model / tool-schema drift breaking the loop** | High — an autonomous loop (D1) fails opaquely on a renamed tool or changed model output | Pin model ids (`sonnet-4-6`/`haiku-4-5`/`opus-4-7`) and assert the `drafter≠verifier` invariant in a unit test; version the host-tool JSON schemas and contract-test the worker↔host bridge; **golden-regress** every prompt/model/tool-order change against the Phase-0 corpus. A tool-call that fails schema validation is a hard error, never a silent skip. |
| **Ported-engine integration** (the moat is on origin/preview, not local) | Medium-High — under-scoping; a drifted second gate copy | Phase 0 pulls origin/preview before estimating. Exactly **one** gate module in `@sagemark/core`: both the agent's read-only `runGate` tool and the host's enforcement call the same module — never a copy. Preserve the ported bug-fix scars (faithfulness 12 s timeout + 25-claim cap; voice 3 s timeout). |
| **SSRF via fetch** (DDG scraping is the ingestion surface, D3) | High — fetched pages are untrusted (SSRF + prompt-injection) | `serpFetch` is a **host-side tool**, not a worker capability: it enforces an allowlist/deny-private-ranges SSRF guard, caps to 3 pages × 2000 chars, and treats fetched content as untrusted input to the brief. The worker can request a fetch but cannot reach arbitrary hosts itself. Prompt-injection from fetched content cannot reach past the host-enforced gate. |

*References: ch. 10 (bible v1.0.0, sha: 2c02fe80), ch. 03 (bible v1.0.0, sha: 2c02fe80)*

## 9 · Open technical questions

| # | Question | Lean | Resolve by |
|---|---|---|---|
| **OQ-1** | **SSE vs. poll transport** for the worker→Vercel→browser hop. SSE gives real token deltas (the demo value) but adds relay-reliability risk across the D5 hop. | Start with SSE + heartbeat/`last_event_id` truth-snapshot resume; keep a poll-the-row fallback behind the same UI contract. **Must resolve in Slice 1 — before the canvas/UI surface widens in Slice 2** — so the relay reliability is proven on the thinnest slice, not after the surface is built on it. | Slice 1 (decide on first-slice relay-reliability data) |
| **OQ-2** | **Sandbox session resumption** — how a run resumes after a microVM dies mid-loop (D9). Does the Agent SDK's session state reconstruct from the persisted `content_piece_versions` snapshot, or do we checkpoint SDK session state explicitly? | Reconstruct from the persisted artifact snapshot (artifact is truth); adopt `DurableAgent`/explicit checkpoint only if reconstruction proves lossy for in-flight multi-turn fine-tunes. | Phase 1→2 (tech-spike) |
| **OQ-3** | **Gate-as-tool latency budget** — the full Stage-A+Stage-B gate runs as a worker tool call across the bridge; the faithfulness 12 s timeout + 25-claim cap plus bridge round-trip may exceed the ≤15 s p95 cap on long pieces. | Run scorers host-side in parallel; consider a single combined `runGate` tool call (not N scorer calls) to collapse round-trips; a timed-out faithfulness gate is a YMYL **hard block**, never a pass. | Phase 1 (measure) |
| **OQ-4** | **Voice-bleed contract-test design** — how to prove, in CI, that the per-run host-tool binding (Layer 3) makes cross-tenant retrieval/persistence structurally impossible, not merely untested. | A contract test that constructs a run for client A, then asserts every host tool rejects a client-B `workspace_id`/`client_id`, plus a cross-workspace RLS `SELECT` returning zero rows. Gate Phase-1 done on it. | Phase 1 (test design) |

*References: ch. 09 (bible v1.0.0, sha: 2c02fe80), ch. 15 (bible v1.0.0, sha: 2c02fe80), ch. 17 (bible v1.0.0, sha: 2c02fe80)*
