# Architecture

This document fixes the runtime, the reuse boundary, the request/stream lifecycle, where the service sits in the Sagemark monorepo, the data model, and inter-service calls for the **SEO Creator** — the tool that produces a Whispering-Willows-style content hub (one pillar + ~8 funnel-staged guides), not a brochure site.

The one-line thesis the rest of the plan hangs on: **the LLM is the replaceable middle; the moat is the harness** — the deterministic scorers, the cross-model faithfulness gate, the non-compensatory `seo-gate`, the fail-closed lifecycle FSM, the per-tenant voice/byline boundary. That harness is engine-agnostic, so the runtime that can host a *real* agent loop while keeping that moat host-enforced wins. Per `DECISIONS.md` **D5/D9**, that runtime is a **self-hosted Claude Agent SDK worker on a Vercel Sandbox microVM** (not the in-process AI SDK v6 loop this doc originally recommended — see the superseded banner in §1).

---

## 1. Runtime

> ### ⚠️ SUPERSEDED by DECISIONS.md D5/D9 (2026-06)
>
> **This section's original recommendation — "Approach B: native AI SDK v6 `ToolLoopAgent` in-process on a Vercel route; never self-host the Agent SDK and never use a Sandbox for content" — was OVERRIDDEN.** `DECISIONS.md` **D5** ("Harness runtime = Claude Agent SDK self-hosted worker") and **D9** ("Agent-SDK worker host = Vercel Sandbox") are the locked calls, and the merged code + the P0.W.1 capability spike (`apps/seo/spike/capability-enforcement/RESULTS.md` — "VERCEL SANDBOX CONFIRMED", hardened profile) implement exactly that. The Approach-B comparison below is retained as **historical analysis only**; read the **LOCKED RUNTIME** block immediately under it for what is actually built.
>
> **LOCKED RUNTIME (D5/D9 — what is built).** The SEO Creator runs the autonomous loop (D1) in a **self-hosted Claude Agent SDK worker on a Vercel Sandbox microVM** — the real Claude Code harness as a library (loop + subagents + hooks + `SKILL.md` skills), spawning a `claude` CLI subprocess (Node-only, non-serverless, so it *cannot* run in a Vercel function). `apps/seo` on Vercel is a **thin UI + orchestration API**: it authenticates, resolves `workspace_id`/`client_id`, reserves cost pre-flight, dispatches the run, and relays worker SDK events to the browser as **SSE (worker → `apps/seo` → browser)**. The worker reaches the deterministic kernel **only** through the host-side `/content/api/{brief,draft,audit,publish}` routes (the ported `seo-gate` / `lifecycle-fsm` / scorers / `content-store` behind them — these *are* the host-side tools the worker calls; `apps/seo/src/lib/content/contract.ts` is their single source-of-truth contract). The kernel stays **host-enforced**: Stage-A vetoes + `canPublish()` execute in `@sagemark/core` behind those routes, where the agent can never reason past them, and the worker can reach publish only through the fail-closed `/content/api/{audit,publish}` routes. The worker holds **no durable state** (Supabase is the only system of record; the Sandbox is compute-only, D9). Confinement is a **capability-denial profile** proven in the spike: an SDK `networkPolicy` default-deny **egress allowlist** (Gateway + DDG) **plus an in-VM `iptables` DROP on `169.254.0.0/16`** to close the hypervisor-local MMDS (DR-010), and a **no-shell worker** whose only filesystem access is a workdir-scoped read tool refusing out-of-jail paths (DR-011); a control that fails to apply is a **boot refusal**. All model traffic routes through the **metered AI Gateway** — the worker holds a run-scoped Gateway base URL + bridge JWT as its only model credential, never a raw provider key. **`canPublish()` + Stage-A vetoes stay HOST-side, never in the loop.**

### The three approaches, and why B *(historical analysis — superseded by the LOCKED RUNTIME block above)*

| | A — Claude Agent SDK / Managed Agents | B — Native AI SDK v6 (**chosen**) | C — Vercel Sandbox (headless Claude Code) |
|---|---|---|---|
| What runs the loop | Anthropic hosts the Claude Code loop (literal `SKILL.md` execution) | `ToolLoopAgent` in-process on a Vercel Node route | Claude Code CLI inside a per-run Firecracker microVM |
| Skill reuse | Literal `SKILL.md` corpus | `SKILL.md` **re-authored** as system prompts + typed tools | Literal `SKILL.md` corpus |
| Infra cost | New: beta-gated Managed Agents, **unconfirmed for org**; self-hosted SDK is non-serverless | **None new** — `ai@6` + `@ai-sdk/anthropic` + `@ai-sdk/gateway` already in repo | microVM provisioning + clone + install before first token; tokens unprovisioned |
| Streaming | Forward Anthropic SSE event taxonomy | **Real token deltas** via AI SDK UIMessage SSE | Proxy stdout → SSE (fragile) |
| Fit to artifact | Over-built: literal-harness fidelity | Fits: artifact is markdown + JSON-LD + a deterministic gate | **Wrong**: the one thing only a Sandbox can do (run generated code) is unused |
| Per-run cost | Highest (hosted loop + container) | Lowest measurable (a few `generate`/`stream` calls) | Worst (hosted agent loop ×8 pieces) |

The decisive facts:

- **The Claude Agent SDK literally cannot run in a Sagemark Vercel function.** `@anthropic-ai/claude-agent-sdk` spawns the Claude Code CLI as a subprocess, bundles native binaries, and is Node-only/non-serverless. Reuse would force a dedicated long-lived sidecar (new ops surface, the component most likely to fail silently) or the Managed Agents beta (access unconfirmed). Both pay for fidelity B can match.
- **The artifact is content, not runnable code.** A Sandbox (C) is a code-execution engine. For markdown + meta + FAQ JSON-LD + a deterministic gate, the microVM capability is dead weight that adds cost and a cold-start dead stare to the "watch it work" demo.
- **B is the only path proven in-repo today.** `apps/trailhead` already ships `ai@^6.0.191`, `@ai-sdk/anthropic@^3`, `@ai-sdk/gateway@^3`, the lazy `resolveGatewayModel()` provider seam (Anthropic-direct BYOK when `ANTHROPIC_API_KEY` is set, else Gateway), and a `CostAccountant` that fail-closed-aborts at a per-request USD cap (`CostCapExceededError`). B reuses a vetted in-house pattern; A and C introduce new infra.

**Reserved, not chosen:** keep Managed Agents (real Approach A) as a flagged later *"true autonomous research-agent"* tier **only if literal `SKILL.md` execution ever becomes non-negotiable**. ~~Never self-host the Agent SDK and never use a Sandbox for content.~~ **⚠️ SUPERSEDED by DECISIONS.md D5/D9 (2026-06):** this prohibition is reversed — the locked runtime *is* a **self-hosted Claude Agent SDK worker on a Vercel Sandbox** (see the SUPERSEDED banner + LOCKED RUNTIME block at the top of §1). The Sandbox does not run *content as code*; it hosts the autonomous loop process, and the literal `SKILL.md` `seo-copywriter` suite runs directly on it, kernel-backed via the `/content/api/*` routes.

---

## 2. Harness reuse: PORT the moat, RUN the four skills directly

> **⚠️ Runtime-reuse note — SUPERSEDED by DECISIONS.md D5/D9 (2026-06).** This section originally said the four producer skills are **RE-AUTHORED as AI SDK v6 system prompts**. Under the locked Agent-SDK-on-Sandbox runtime (§1 LOCKED RUNTIME) they instead **run directly as their literal `SKILL.md` skills** on the worker, kernel-backed via the host-side `/content/api/{brief,draft,audit,publish}` routes — *not* re-authored. The **PORT** dispositions (scorers, gates, `seo-gate`, `lifecycle-fsm`, schema → `@sagemark/core`, host-side) are unchanged and correct; only the "4 runtime producers" row's disposition flips from RE-AUTHOR to RUN-DIRECTLY (corrected in the table below).

The single most important scoping fact: **the content-hub engine is not greenfield. It exists on `origin/preview` (PRs #1668–1684) and must be PORTED, not reinvented.** The local checkout (`apps/agents/src/app/content`) only has the older single-piece `ContentEngine`; the local `packages/schema-flywheel/drizzle/` stops at `0029_videogen_image_generations_provenance.sql` — there is no `content_pieces`/`seo-gate`/`lifecycle-fsm` locally. **Phase 0 pulls `origin/preview` first.** A plan that reads only local code will mis-locate the schema and badly under-estimate what already exists.

| Component | Disposition | Source / target |
|---|---|---|
| 22 deterministic scorers (flesch-kincaid, keyword-density, passive-voice, content-score, meta/og/faq generators…) | **PORT verbatim** (framework-agnostic pure fns) | `apps/agents/src/lib/content/*` → `@sagemark/core` |
| Cross-model faithfulness gate (sonnet drafter vs **haiku** verifier) | **PORT, preserve invariant** drafter ≠ verifier | `apps/agents/src/lib/content/faithfulness-gate.ts` |
| Non-compensatory `seo-gate` (Stage-A vetoes → Stage-B 8-dim composite) | **PORT** to host code | `origin/preview` |
| Fail-closed `lifecycle-fsm` (`canPublish`/`canTransition`, snapshot rules) | **PORT** to host code | `origin/preview` |
| Drizzle schema (`content_clients`/`content_pieces`/`content_piece_versions`/`voice_specs`) | **PORT** + extend (`clusterRole`/`funnelStage` columns) | `origin/preview` PRs #1668–1684 |
| 4 runtime producers (seo-strategist, seo-assistant, seo-blog-writer, seo-audit) | **RUN DIRECTLY** as literal `SKILL.md` skills on the Agent-SDK worker, kernel-backed via `/content/api/{brief,draft,audit,publish}` (D5/D9) — *~~RE-AUTHOR as AI SDK v6 system prompts~~, superseded* | `learnings/SKILLS/seo-copywriter/*/SKILL.md` |
| `/seo-copywriter-build` orchestrator | **DROP at runtime** — build-time dev tool only | — |
| `judge-prompt.md` domain checks | **Repurpose** as the runtime acceptance-test spec | — |

This collapses B's headline cost from "rebuild the engine" down to **just four prompts**. The risk that survives is **methodology-fidelity regression** (§7) — ~~re-authored prompts quietly underperforming the `SKILL.md` harness~~ **[superseded by D5/D9: producers run as literal `SKILL.md` skills — the live risk is the producer skills drifting on a model / tool-order / skill-config change]**, invisible to CI. The mitigation is mandatory and gates Phase 0: **capture the live Whispering Willows hub as a human-labeled GOLDEN SET before a single prompt is written**, and regress every prompt/model bump against it.

Model ids are re-baselined off the stale `anthropic/claude-sonnet-4.5` to the trailhead-current ids: **`claude-sonnet-4-6` drafter / `claude-haiku-4-5` faithfulness verifier / `claude-opus-4-7` judge**, dropping `budget_tokens` on 4.6+/Opus.

---

## 3. Request / stream lifecycle

> **⚠️ Runtime note — SUPERSEDED by DECISIONS.md D5/D9 (2026-06).** Where the prose and the diagram below place the loop "on a Node/Fluid route in `apps/seo`," the locked topology instead runs the loop in the **Claude Agent SDK worker on a Vercel Sandbox**; `apps/seo` is the thin orchestration tier that dispatches the run and **relays the worker's SDK events as SSE (worker → `apps/seo` → browser)**, and the agent's "tools" are the host-side `/content/api/{brief,draft,audit,publish}` routes (see §1 LOCKED RUNTIME). **The three invariants below are unchanged and remain exactly correct** — the gate is host code outside the loop, a green eval makes a draft eligible (not published), and cost is reserved pre-flight — only *where the loop physically runs* moved from in-process to the Sandbox worker.

Generation runs the autonomous loop (the Claude Agent SDK worker; D5/D9), with the deterministic kernel reached as host-side `/content/api/*` tools. The human's primary checkpoint is the **brief**, not the 2,200-word draft — get the brief right and the draft is bookkeeping.

```
 CLIENT (three-zone canvas)                apps/seo SERVER (Node/Fluid route)            @sagemark/core (host-side, deterministic)
 ──────────────────────────                ──────────────────────────────────           ─────────────────────────────────────────
 1. operator submits/refines  ──POST──▶   /api/run  (auth → workspace → client RLS)
    typed BRIEF                            │  CostAccountant.reserve(pre-flight)
                                           │  resolveGatewayModel()  ──▶  sonnet-4-6
 2. ◀── SSE token deltas ──────────────    ToolLoopAgent.stream({ tools })
    (live thinking + tool-use)             │   ├─ tool: serpFetch       (host, 1 client) ──▶  grounding sources
    "fetching SERP… scoring 8 dims"        │   ├─ tool: runScorers (RO) ─────────────────▶  scorers (pure fns)
                                           │   └─ tool: runGate    (RO) ─────────────────▶  seo-gate Stage-A → Stage-B
 3. ◀── artifact (markdown) ───────────    │  persistPiece (host-validated upsert)  ──────▶  content_pieces (draft)
    rendered in CENTER editor              │                                                  + content_piece_versions snapshot
 4. ◀── gate scorecard ────────────────    │  HOST enforces Stage-A veto + canPublish()
    Stage-A chips + Stage-B bars           │  (agent NEVER sees a path past a veto)
 ───────────────────────── fine-tune (multi-turn) ─────────────────────────
 5. operator/client edit      ──POST──▶   /api/edit  (SHA-256 stale-guard → 409,
    instruction or pinned comment          │           per-tenant rate-limit → 429,
                                           │           workspace-ownership → 403)
 6. ◀── bounded body diff ─────────────    agent emits region-scoped diff
    new auto-version                       │  re-run FULL gate  ──────────────────────────▶  seo-gate (re-scores)
                                           │  append content_piece_versions snapshot
 ───────────────────────── release (human, fail-closed) ───────────────────
 7. operator clicks Publish    ──POST──▶   /api/publish
                                           │  resolve byline server-side from author_id ───▶  voice_specs author registry
                                           │  canPublish() = PUBLISH verdict ∧ evalRan
                                           │   ∧ humanRelease ∧ (is_ymyl ⇒ named author
                                           │   + credentials + citations)
                                           └─ status → 'published'  ──▶ SSR render surface (apps/site)
```

Three invariants this lifecycle enforces:

1. **The gate is host code, outside the loop.** The agent gets a read-only `runGate` tool. Stage-A ordered vetoes (`UNSOURCED_STAT`, `KEYWORD_STUFF`, `YMYL_NO_BYLINE`, `THIN_CONTENT`, `BANNED_LEXICON`, `VOICE_FAIL`, `EVAL_FAILED`) short-circuit to REJECT/REVISE with `score=null` **before** the Stage-B 8-dim composite (faithfulness strictly heaviest) is ever computed. A persuasive fine-tune instruction can tune soft surface but can **never** talk past a YMYL/faithfulness/thin-content veto.
2. **A green eval makes a draft ELIGIBLE, not PUBLISHED.** The only path to `published` is `canPublish()` returning true in `lifecycle-fsm.ts`: a PUBLISH verdict **and** an eval that actually ran **and** a recorded human release **and** (if `is_ymyl`) a named credentialed author + citations. A skipped/thrown/timed-out eval **blocks**. No autopilot.
3. **Cost is reserved pre-flight.** The `CostAccountant` charges before each call and fail-closed-aborts at the per-run ceiling — the `≤$2` editorial target is *measured* from Gateway usage, not asserted.

---

## 4. Where it sits in Sagemark

> **⚠️ Runtime-placement note — SUPERSEDED by DECISIONS.md D5/D9 (2026-06).** The tree below shows the loop (`api/run`, `agent.ts`, `ToolLoopAgent`) running **in-process inside `apps/seo`**. Under the locked topology that loop runs on the **Claude Agent SDK worker on a Vercel Sandbox** (§1 LOCKED RUNTIME); `apps/seo` instead owns the **thin orchestration API + the `/content/api/{brief,draft,audit,publish}` kernel routes** (the host-side tools the worker calls) + the **SSE relay**. The package boundaries (`@sagemark/core` as the host-side moat; `apps/site` render surface; imagegen in-process) are unchanged — only the loop's *host* moved from an `apps/seo` route to the Sandbox worker.

```
flywheel-main/
├── apps/
│   ├── seo/                         ◀── NEW SERVICE (Next.js 16, React 19, Tailwind v4)
│   │   └── src/
│   │       ├── app/
│   │       │   ├── (studio)/        operator three-zone canvas (Agent | preview | Inspector)
│   │       │   ├── review/[token]/  tokenized client-review preview (pin stack + approve)
│   │       │   └── api/
│   │       │       ├── run/         ToolLoopAgent generation (Node/Fluid, SSE)
│   │       │       ├── edit/        conversational fine-tune (constrained diff)
│   │       │       └── publish/     fail-closed release
│   │       └── lib/
│   │           ├── agent.ts         ToolLoopAgent def + typed tools
│   │           └── ai.ts            resolveGatewayModel + CostAccountant (mirrors trailhead)
│   ├── site/                        per-client SSR render surface (/clients/[client]/blog/[slug])
│   ├── trailhead/                   ◀── provider-seam reference (ai.ts)
│   └── agents/                      ◀── scorer-library source (lib/content/*) + videogen canvas
├── packages/
│   ├── @sagemark/core/              ◀── NEW: scorers + faithfulness gate + seo-gate + FSM as platform primitives
│   ├── schema-flywheel/             Drizzle schema (port content_pieces/clients/versions/voice_specs here)
│   └── videogen/imagegen/           ◀── hero-image engine, called in-process (§6)
```

**Why a new `apps/seo` rather than extending `apps/agents`:** the SEO Creator is the first service built on the ~~AI SDK v6 agent-loop pattern~~ **self-hosted Claude Agent SDK worker pattern (D5/D9)** — a thin `apps/seo` host exposing the deterministic kernel over `/content/api/*` to a Sandbox-hosted loop. `apps/agents` is uniformly hand-rolled `fetch → OpenRouter`. A clean service keeps the two LLM ecosystems from tangling, lets `apps/seo` own its Fluid `maxDuration` and Gateway config, and gives the scorers a natural home (`@sagemark/core`) shared by both. It reuses `apps/agents`' auth/credit/workspace conventions and `apps/site`'s render surface — no fork of those.

**`@sagemark/core` is the moat made a package.** It registers the deterministic primitives (scorers, faithfulness gate, `seo-gate`, `lifecycle-fsm`) plus the provider seam (`resolveGatewayModel`, `CostAccountant`) as **host-side platform code**. Both the agent's read-only tools and the host's enforcement call the *same* gate module — there is exactly one gate, never a drifted copy.

**Persistence: Supabase Postgres, not localStorage.** The shipped wizard persists to `localStorage` (cap 50) — disqualifying for multi-tenant agency work. Supabase is the system of record. **Every row is scoped by `workspace_id` + `client_id` with fail-closed RLS** (anon `SELECT` only `status='published'`). Cross-tenant leakage / voice bleed is the agency-ending bug; the namespace is a hard, fail-closed boundary. Never rely on session/Anthropic-side state as durable product data.

---

## 5. Data model

Five tables, mirroring `origin/preview` with two additive columns. The artifact **unit** is a `content_piece`; the **deliverable** is a cluster of pieces forming a hub.

| Table | Role | Key columns |
|---|---|---|
| `content_clients` | tenant root (≠ accounting `clients`) | `id`, `name`, `blog_slug` UNIQUE, `workspace_id` |
| `content_pieces` | the artifact unit | `id`, `client_id` FK, `slug` (unique/client), `title`, `body` (markdown), `excerpt`, `meta_description`, `status` (draft\|review\|approved\|published\|archived), `version`, `is_ymyl`, `author_id`, `eval_score`, `verdict` (PUBLISH\|REVIEW\|REVISE\|REJECT), `dimensions` jsonb (8-dim scorecard), `faq_data` jsonb (→ FAQPage JSON-LD), `brief_snapshot` jsonb, `published_at`, **`cluster_role`** (pillar\|cornerstone\|spoke\|faq\|checklist), **`funnel_stage`** (awareness\|consideration\|decision\|retention) |
| `content_piece_versions` | immutable history (written before every forward FSM move) | `piece_id`, `client_id`, `version`, `body`, `dimensions`, `verdict`, `snapshot_at` |
| `voice_specs` | per-client approved brand voice + **author registry** | `client_id`, `spec` jsonb (`tone[]`, `bannedLexicon[]`, `authors[]` = `{id, name, credentials}`, `attributionSources[]`, `samplePassages[]`), `approved_at` (NULL = draft) |
| `review_comments` | client feedback (pin threads + section verbs) | `id`, `piece_id`, `version`, `client_id`, `anchor` (normalized 0..1 + `elementHint`), `body`, `author`, `status` (open\|resolved), `kind` (pin\|section-approve\|request-changes) |

Decisions and rationale:

- **`cluster_role` / `funnel_stage` promoted to first-class columns** (not left in `brief_snapshot`, as `origin/preview` does). *Rationale:* the deliverable is a hub, and the Whispering Willows homepage is a curated resource library driven by the cluster map; a related-guides nav and the homepage template need a queryable cluster edge. *Alternative considered:* keep them in `brief_snapshot` jsonb — insufficient for a true hub graph.
- **Byline resolves server-side from `content_pieces.author_id` → `voice_specs.authors[]`** at publish. *Rationale:* the `origin/preview` publish path trusts `request.author` — a YMYL credential hole where an uncredentialed byline could ship memory-care content. *Alternative:* trust the request body — rejected; it is the inherited bug.
- **`voice_specs.approved_at IS NULL` is a HARD STOP.** No approved spec ⇒ no generation, no default-voice fallback. *Rationale:* voice-as-data + an approved per-client byline registry is the E-E-A-T and anti-bleed boundary.
- **`review_comments.anchor` stores normalized 0..1 coords + `elementHint`**, mirroring videogen's `useIframePinDrop` payload, so a "Request changes" comment routes straight into `/api/edit` as the agent instruction.

---

## 6. Inter-service calls

The SEO Creator needs hero/section imagery for pieces and the homepage. **It calls the imagegen engine in-process, not over HTTP.** The pattern is the one already shipped in `packages/videogen/imagegen/`, wired into `packages/videogen/orchestrator/generate.ts` as a stage call — a typed function import, no network hop, no second deploy target.

```ts
// apps/seo/src/lib/agent.ts — a host-side tool the agent may request,
// resolved AFTER the gate, keyed to exactly one workspace_id/client_id.
import { generateHeroImage } from "@sagemark/imagegen"; // re-export of packages/videogen/imagegen

const heroImageTool = tool({
  description: "Generate a warm, healthcare-appropriate hero image for a [photo:slug] placeholder.",
  inputSchema: z.object({ slug: z.string(), prompt: z.string() }),
  execute: async ({ slug, prompt }, { ctx }) => {
    // host-side: tenancy + cost cap enforced here, key never reaches the agent
    return generateHeroImage({ workspaceId: ctx.workspaceId, clientId: ctx.clientId, slug, prompt });
  },
});
```

Rules that keep this on-thesis:

- **In-process function call, not `callService` HTTP.** *Rationale:* both engines live in the same monorepo and share the Gateway + credit ledger; an in-process call inherits the `CostAccountant` reservation and avoids a network failure surface. *Alternative considered:* an HTTP `callService` to a separate imagegen route — warranted only if imagegen becomes a separately-deployed service; today it would add latency and a silent-failure point for no gain.
- **Image generation is async/job-wrapped**, per the imagegen-bible (`07-production-engineering.md`) and the Codex audit BLOCKER on `apps/agents/src/app/videogen/api/generate/route.ts` (sync generation blows wall-clock). For SEO v1, only generate for **empty-stock / unresolved** `[photo:slug]` placeholders; resolved placeholders pass through. Unresolved tokens are **stripped at render, never leaked**.
- **Every generated asset carries a recorded license/provenance record** (mirroring `0029_videogen_image_generations_provenance.sql`) or it cannot ship — the engine must be architecturally incapable of publishing an unlicensed asset.
- **The render surface stays in `apps/site`.** Generation persists `content_pieces`; `apps/site` SSR-renders `/clients/[client]/blog/[slug]` with the full body in initial HTML (mandatory — GPTBot/ClaudeBot/PerplexityBot largely don't run JS), FAQPage JSON-LD from `faq_data`, and per-client `sitemap.xml`/`robots.txt`. A **CI reachability gate** (sitemap == published-and-indexable set, both directions) is required; `apps/site` currently has **no vitest** and the 24 client-blog render tests were omitted, so placeholder-stripping / JSON-LD / status-filtering must be hardened before clients depend on it.

---

## 7. Architectural risks this design must hold

| Risk | Mitigation baked into the architecture |
|---|---|
| **Methodology-fidelity regression** — the runtime producer behavior drifts from the proven `SKILL.md` methodology, invisible to CI *(under D5/D9 the skills run literally, so this is loop/model/tool-order drift rather than ~~re-authored-prompt~~ drift)* | Golden set captured in Phase 0 **before** any prompt; regressed on every prompt/model bump |
| **Agent reasons past a hard gate** | Stage-A vetoes + `canPublish()` enforced in **host code**; agent gets read-only `runGate` only |
| **Cross-tenant leakage / voice bleed** (agency-ending) | Host-side tools keyed to one `workspace_id`/`client_id`; fail-closed RLS; review token scoped to exactly one piece/version |
| **Crawler-invisibility** (any CSR slip kills the GEO thesis) | SSR full-body as a CI-enforced reachability gate; `apps/site` vitest stood up first |
| **Under-scoping by reading local only** | Phase 0 pulls `origin/preview` (PRs #1668–1684) before estimating |
| **Cost/latency blowout** past `≤$2` / the Fluid window | Pre-flight `CostAccountant` reservation; live Gateway ledger; `DurableAgent` checkpointing if the pipeline outgrows one timeout |
| **YMYL credential hole** inherited from `origin/preview` | Byline resolved server-side from `author_id` at publish; named credentialed Person + citations + recorded release required before any YMYL publish |

---

## Component diagram

> **⚠️ SUPERSEDED by DECISIONS.md D5/D9 (2026-06).** This diagram shows the loop (`ToolLoopAgent (ai@6)`) running **inside `apps/seo`**. The locked topology runs it on the **Claude Agent SDK worker on a Vercel Sandbox**, with `apps/seo` as the thin orchestration tier exposing the `/content/api/*` kernel routes (host-side tools) + the SSE relay. For the current architecture diagram see RFC §2 (`plans/seo-creator/flywheel/engineering-rfc.md`); `@sagemark/core` as the host-enforced moat and the gate/`canPublish()` host-side invariants below remain exactly correct.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  apps/seo  (Next.js 16 · React 19 · Tailwind v4)                                  │
│                                                                                  │
│  ┌──────────────┐   ┌────────────────────┐   ┌──────────────────────────────┐   │
│  │ Agent panel  │   │  Center: markdown  │   │ Inspector: gate scorecard     │   │
│  │ (token SSE)  │   │  editor ⇄ SSR prev │   │ Stage-A chips · Stage-B bars  │   │
│  └──────┬───────┘   └─────────┬──────────┘   └──────────────┬───────────────┘   │
│         │  /api/run · /api/edit · /api/publish (Node/Fluid · SSE)                │
│         ▼                                                                         │
│  ┌──────────────────────────── ToolLoopAgent (ai@6) ───────────────────────────┐ │
│  │  resolveGatewayModel → sonnet-4-6 (draft) · haiku-4-5 (faithfulness)         │ │
│  │  tools[RO]: serpFetch · runScorers · runGate     tools[host]: persistPiece   │ │
│  └──────────────┬─────────────────────────────┬───────────────────────────────┘ │
│                 │ read-only                    │ host-validated write             │
└─────────────────┼─────────────────────────────┼─────────────────────────────────┘
                  ▼                              ▼
   ┌──────────────────────────┐   ┌──────────────────────────────────────────────┐
   │  @sagemark/core           │   │  Supabase Postgres (RLS: workspace+client)    │
   │  • 22 scorers (pure)      │   │  content_clients · content_pieces             │
   │  • faithfulness gate      │   │  content_piece_versions · voice_specs         │
   │    (sonnet ≠ haiku)       │   │  review_comments                              │
   │  • seo-gate  A→B          │   └──────────────────────────────────────────────┘
   │  • lifecycle-fsm          │                          │
   │    (canPublish fail-closed)│                  status='published'
   │  • CostAccountant         │                          ▼
   └───────────────────────────┘   ┌──────────────────────────────────────────────┐
                  ▲                  │  apps/site  SSR /clients/[client]/blog/[slug] │
   in-process call │                 │  full-body HTML · FAQPage JSON-LD · sitemap   │
   ┌───────────────┴───────────┐    │  + resource-library HOMEPAGE (cluster map)    │
   │ packages/videogen/imagegen│    └──────────────────────────────────────────────┘
   │  hero images (async/job)  │
   │  + license/provenance     │
   └───────────────────────────┘
```
