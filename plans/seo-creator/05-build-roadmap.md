# Build Roadmap

This roadmap takes the Sagemark SEO Creator from an empty `apps/seo` directory to a YMYL-credible v1 that can run the Whispering Willows pilot. It is sequenced so that the **deterministic moat ships before the agent**, the **gate ships before any publish**, and the **golden set is captured before a single prompt is written**. Every phase delivers a usable vertical slice of the three product surfaces — the **harness** (scorers, gate, FSM, tenancy), the **artifact** (content piece → cluster → rendered hub), and the **feedback loop** (streaming generation, conversational fine-tune, client review) — rather than a horizontal layer that can't be demoed.

The chosen runtime is **Approach B**: a native AI SDK v6 `ToolLoopAgent` on a Vercel Node/Fluid route, using the trailhead `resolveGatewayModel()` seam + fail-closed `CostAccountant`. The deterministic engine is **ported verbatim from origin/preview (PRs #1668–1684), not re-authored**; only the four runtime producer prompts are net-new. See `02-architecture.md` for why B over A/C.

---

## Map to the Sagemark stack

| Concern | Where it lives | Notes |
|---|---|---|
| New service | `apps/seo` (Next.js 16, React 19, Tailwind v4) | Mirrors `apps/agents` page convention (Server Component `page.tsx` + `*HubClient.tsx` + sub-routes) |
| Shared platform primitives | `packages/core` (`@sagemark/core`) | Provider seam, `CostAccountant`, scorer re-exports, gate composer, FSM — host-side, agent-unreachable |
| Schema | `packages/schema-flywheel/drizzle/0030+` | Port `content_clients` / `content_pieces` / `content_piece_versions` / `voice_specs` from origin/preview; local tree stops at `0029_videogen_image_generations_provenance.sql` |
| Scorers (port source) | `apps/agents/src/lib/content/*` | 20+ pure-function modules confirmed present locally (`content-score`, `flesch-kincaid`, `keyword-density`, `passive-voice`, `faithfulness-gate`, `voice-gate`, `faq-schema-generator`, `meta-tag-generator`, `og-tag-generator`) |
| Gate / FSM (port source) | origin/preview `apps/agents/src/lib/content/{seo-gate,lifecycle-fsm,failure-codes}.ts` | **NOT in local checkout** — must `git fetch origin preview` first |
| Provider seam (copy) | `apps/trailhead/src/lib/ai.ts` | `resolveGatewayModel()` + `CostAccountant` — verbatim foundation for the agent loop |
| Render surface | `apps/seo/src/app/clients/[client]/blog/[slug]/page.tsx` | SSR full-body; **`apps/site` has no vitest** so render tests are net-new |
| Imagegen | `packages/videogen/imagegen` | Enters Phase 3 for hero/inline article imagery via `[photo:slug]` resolution |
| Client review primitives (copy) | `apps/agents/src/components/videogen/canvas/*` | `PinOverlay`, `PreviewClickHandler`, `useIframePinDrop`, `VersionHub`, `ApprovalBeat`, `ChatEdit` all verified present locally |

---

## What to port FIRST from the existing SEO skill

The single highest-leverage pre-work is **not code** — it is the **golden set**. The deterministic engine is framework-agnostic and low-risk to port; the LLM prompts are the only net-new IP and the **only thing that can silently regress**. Port order, strictly:

1. **The live Whispering Willows hub → a human-labeled golden set** (Phase 0). Capture all ~8 pieces + the homepage from `whispering-willows-content-demo.vercel.app` as the regression baseline **before any prompt exists**. This is the failure-mode tripwire for methodology-fidelity drift.
2. **`judge-prompt.md` domain checks → runtime acceptance-test spec** (Phase 0). The build-orchestrator's judge (non-compensatory order, fail-closed eval, no-fabricated-data, YMYL, keyword-stuffing-is-a-veto, tenant scoping) is repurposed as the gate's acceptance tests. The `/seo-copywriter-build` orchestrator itself is a build-time tool with **no runtime role** — do not port it.
3. **The scorer library** (`apps/agents/src/lib/content/*`) → `@sagemark/core` (Phase 1). Pure functions, verbatim, with their production bug-fix scars preserved (faithfulness 12s timeout + 25-claim cap; voice 3s timeout; cross-model `drafter !== verifier` invariant).
4. **`seo-gate.ts` + `lifecycle-fsm.ts` + `failure-codes.ts`** from origin/preview → `@sagemark/core` (Phase 1). The two-stage non-compensatory gate and the fail-closed FSM. These are the product.
5. **The four producer SKILL.md files** (`seo-strategist`, `seo-assistant`, `seo-blog-writer`, `seo-audit`) → AI SDK v6 system prompts + typed tools (Phase 1 for the writer; Phase 2 for the rest), **golden-regressed on every change**.

---

## Phase 0 — Pre-work: pull preview, capture the golden set (~0.5 wk)

**Goal:** Eliminate the two ways this build silently fails — under-scoping by reading only the local checkout, and methodology-fidelity regression invisible to CI.

**Scope (what ships):**
- `git fetch origin preview` and read the real engine: `content_pieces` schema, `seo-gate`, `lifecycle-fsm`, `failure-codes`, the four producer skills. Confirm what exists (good — most of the moat) and what's net-new (the homepage template, the agent UI, the cluster columns).
- Capture the Whispering Willows hub (pillar + 8 spokes + homepage) as a checked-in golden corpus under `apps/seo/golden/whispering-willows/` with the human labels: per-piece cluster role, funnel stage, expected dimension scores, expected Stage-A clean/veto.
- Transcribe `judge-prompt.md` domain checks into `apps/seo/test/acceptance/gate-spec.ts` stubs.

**Harness / artifact / feedback slice:** None shipped — this is the de-risking floor that the entire estimate rests on.

**Dependencies:** Read access to origin/preview; the live demo URL.

**Definition of done:** Golden corpus committed; `gate-spec.ts` enumerates every Stage-A veto code and the Stage-B verdict bands; a one-page diff doc states exactly which files port verbatim vs. which are net-new.

---

## Phase 1 — MVP / v0: "gate + one piece" (~3–4 wk)

**Goal:** Ship one grounded, gated, human-released content piece through the real engine, with the gate enforced in host code the agent can never reason past. Prove the moat before the UX.

**Scope (what ships):**
- Scaffold `apps/seo` (page convention, Tailwind v4 tokens, auth guard mirroring `apps/agents/src/lib/auth`).
- Register **`@sagemark/core`**: copy `resolveGatewayModel()` + `CostAccountant` from `apps/trailhead/src/lib/ai.ts`; re-baseline model ids off `claude-sonnet-4.5` to current (`claude-sonnet-4-6` drafter / `claude-haiku-4-5` verifier), drop `budget_tokens`.
- Port the scorer library + faithfulness gate + voice gate + `seo-gate` + `lifecycle-fsm` + `failure-codes` into `@sagemark/core` as host-side primitives.
- Port the Drizzle schema (`0030+`): `content_clients` / `content_pieces` / `content_piece_versions` / `voice_specs`, every row scoped by `workspace_id` + `client_id`, **fail-closed RLS** (anon `SELECT` only `status='published'`).
- Voice-spec editor with the **hard-stop guard**: no approved `voice_specs` row (`approved_at IS NULL`) ⇒ piece creation refused. No default-voice fallback.
- A minimal generation route: brief (SERP-grounded, deterministic, SSRF guard preserved) → one drafter call (`seo-blog-writer` prompt) → faithfulness gate → `seo-gate` Stage-A vetoes + Stage-B composite → persist as `draft`. **Every publish is a recorded human release; nothing auto-publishes.**

**Harness slice:** The full deterministic moat — scorers, two-stage gate, fail-closed FSM, multi-tenant persistence, voice-spec hard stop. The agent gets a **read-only `runGate` tool only**; `canPublish()` and all Stage-A vetoes live in host code.

**Artifact slice:** One `content_piece` row with the full persisted shape (`body`, `meta_description`, `excerpt`, `faq_data`, `dimensions`, `verdict`, `is_ymyl`, `author_id`, `brief_snapshot`) and its initial immutable version snapshot.

**Feedback slice:** None yet — a plain operator result view (mirror `DraftResult.tsx`) showing the gate scorecard.

**Dependencies:** Phase 0 (the ported engine + golden set). **AI Gateway / provider keys enter here** — `ANTHROPIC_API_KEY` (BYOK) or Gateway key wired through `resolveGatewayModel()`; **Supabase enters here** as system of record.

**Definition of done:** A YMYL piece for one client generates, runs the real two-stage gate, and is blocked from `published` unless `verdict==='PUBLISH'` AND `evalRan===true` AND a recorded human release exists AND (YMYL) a credentialed `author_id` resolves + citations present. Generation against the golden brief reproduces the expected Stage-A clean/veto. Cross-tenant `SELECT` of another workspace's draft returns zero rows (RLS test).

---

## Phase 2 — Agent canvas + fine-tune (~2 wk)

**Goal:** Make it behave like the Claude harness — real token streaming, a live two-stage gate scorecard, and native multi-turn conversational fine-tune. This is the user's #1 and #2 requirements.

**Scope (what ships):**
- Three-zone canvas modeled on videogen's `StudioCanvas` minus operator-only controls: **LEFT** Agent chat streaming real token deltas + tool-use traces ("fetching SERP, running faithfulness gate, Stage-A clean, scoring 8 dimensions"); **CENTER** the artifact (artifacts-pattern side-panel markdown editor); **RIGHT** Inspector with Stage-A veto chips (stable codes, blocking, red) then Stage-B 8-dim 0–100 bars with verdict band (faithfulness visibly dominant) + version history.
- The `ToolLoopAgent` loop via `createAgentUIStreamResponse`, streaming `data-articleDelta`. Scorers/gate exposed as **read-only tools**; `persistPiece` is a validated host-side tool (keys never reach the agent).
- Conversational fine-tune: an instruction → bounded body diff → applied as an **append-only `content_piece_versions` snapshot** → **full gate re-runs** → one-line "what changed" summary. Guarded by SHA-256 stale-edit (409) + per-tenant rate limit + workspace-ownership (ported from videogen `chat-edit`).
- **Brief-first checkpoint:** the human reviews/refines the typed brief (intent from live SERP, cluster placement, entities, `isYmyl`/`reviewerRequired`), not the 2,200-word draft.
- Re-author + **golden-regress** the remaining three producer prompts (`seo-strategist`, `seo-assistant`, `seo-audit`) against the Whispering Willows set.

**Harness slice:** The agent loop wired around the host-side gate — a fine-tune instruction can never push a piece past a Stage-A/YMYL/faithfulness veto.

**Artifact slice:** The piece becomes a live, editable, versioned object with an append-only history.

**Feedback slice (internal):** Operator conversational fine-tune + the gate scorecard as the trust surface.

**Dependencies:** Phase 1 (`@sagemark/core`, schema, gate). The four producer prompts depend on the Phase 0 golden set for regression.

**Definition of done:** Token deltas stream visibly; an operator edit writes a version, re-runs the gate, and a faithfulness-breaking edit is caught and blocked from advancing. All four producer prompts pass golden regression within tolerance. Stale-edit (409) and rate-limit (429) guards fire under test.

---

## Phase 3 — Render + hub + client review (~2–3 wk)

**Goal:** Produce the actual deliverable — a crawlable, schema-marked content **hub** — and the surface a client reviews and signs off on.

**Scope (what ships):**
- Per-client SSR at `apps/seo/src/app/clients/[client]/blog/[slug]/page.tsx`: **full body in initial HTML** (mandatory — GPTBot/ClaudeBot/PerplexityBot largely don't run JS), FAQPage JSON-LD from `faq_data`, `[photo:]`/`[cta:]` resolution with **unresolved-token stripping**, per-client `sitemap.xml` + `robots.txt`.
- **CI reachability gate:** `sitemap == published-and-indexable set`, both directions (catches orphans AND stale entries). Net-new vitest infra for `apps/seo` render — `apps/site` has none and the 24 client-blog render tests were omitted, so placeholder-stripping / JSON-LD / status-filtering must be hardened here.
- **Net-new resource-library homepage template** fed by the cluster map: hero, statistic callout, named three-stage cluster section, guide-card grid, quality section, tour CTA + license badge. **Promote `clusterRole` + `funnelStage` to first-class columns** (`0031+` migration) to drive the homepage + related-guides nav — the engine ships pieces + sitemap, not the hub homepage.
- **Imagegen integration enters here:** wire `packages/videogen/imagegen` to resolve `[photo:slug]` placeholders into warm, inclusive, healthcare-appropriate hero/inline imagery, each with a recorded license/provenance record (asset with no provenance is blocked).
- **Tokenized hosted client-review preview:** the actual SSR-rendered piece in a same-origin sandboxed iframe. Reuse `PinOverlay` + `PreviewClickHandler` + `useIframePinDrop` for element-anchored pinned comments and `ApprovalBeat` for section-level Approve / Request-changes. A "Request changes" comment routes straight into the agent edit loop. Sign-off = a **named, undeletable version recording approver identity**. Token scoped to exactly one piece/version, fail-closed.
- **Close the YMYL byline trust hole:** resolve the byline **server-side from `content_pieces.author_id` → voice-spec author registry** at publish, never from `request.author`.
- Instrument **approval-cycle time + open-thread count ("approval debt")** per client.

**Harness slice:** Reachability gate + SSR full-body + server-resolved YMYL byline — the publish-governance the wizard never shipped.

**Artifact slice:** The cluster becomes a real hub (homepage + related-guides nav + crawlable pieces with imagery).

**Feedback slice (client-facing):** Pinned comments + section Approve/Request-changes + named-version sign-off, with client approval **advisory on hard gates** — a client can never approve past a YMYL/faithfulness/thin-content veto.

**Dependencies:** Phase 2 (the edit loop that "Request changes" routes into). Imagegen + Supabase storage for asset provenance.

**Definition of done:** A full Whispering Willows hub renders SSR with body in initial HTML, valid FAQPage JSON-LD, no leaked placeholder tokens; the CI reachability gate is green both directions; the client preview accepts a pinned comment that becomes an agent edit + new version + re-gated diff; a YMYL piece cannot publish unless the resolved author is credentialed.

---

## Phase 4 — v1 hardening / compounding loop (~2–3 wk, partly deferrable)

**Goal:** Prove multi-client tenancy end-to-end, measure real cost, and stand up the loop that makes content a compounding asset rather than a one-shot printer.

**Scope (what ships):**
- Multi-client tenancy proven end-to-end (second client, full hub, zero voice/fact bleed across namespaces).
- **Cost ledger via Gateway usage** measured against the ≤$2 editorial target (a PRD target, not yet a measured number); pre-flight cost reservation (lock-row conditional UPDATE, not sum-then-check).
- Observability: per-stage cost/latency, eval-score-distribution slide (judge/voice drift caught before a reader sees it), cron heartbeats, kill-switch (instant 410 + Search Console Removals; noindex with a lint forbidding a co-existing robots.txt Disallow; global feature-flag pause).
- Compounding loop (deferrable to v1.1 by appetite): freshness cron → draft (never auto-publish), winner-amplification sibling briefs, GEO weekly query-bank.
- `DurableAgent` (Workflow DevKit) checkpointing **only if** the pipeline outgrows a single Fluid timeout.

**Harness slice:** The three governors (cost reservation, circuit breaker that pauses generation-not-serving, publish-rate gate), kill switches, correction-propagation.

**Artifact slice:** Refresh-as-a-draft that re-enters the gate; sibling-spawn for cluster expansion.

**Feedback slice:** Approval-debt KPI per client as the binding-constraint dashboard (release, not generation, is the bottleneck).

**Dependencies:** Phases 1–3. Gateway usage API for the cost ledger.

**Definition of done:** Two clients run isolated end-to-end; a cross-tenant retrieval/leak test passes; the per-piece cost is measured (not estimated) from the live ledger; a wedged generation triggers a heartbeat alert rather than a silent stall; the kill-switch demonstrably unpublishes a live piece.

---

## Milestone table

| Phase | Milestone | Duration | Harness | Artifact | Feedback | Enters here |
|---|---|---|---|---|---|---|
| 0 | Preview pulled, golden set captured | ~0.5 wk | acceptance spec | golden corpus | — | origin/preview |
| 1 | Gate + one human-released piece | 3–4 wk | scorers, 2-stage gate, FSM, RLS, voice hard-stop | `content_piece` + version | operator scorecard | **`@sagemark/core`, Supabase, AI Gateway keys** |
| 2 | Agent canvas + conversational fine-tune | 2 wk | host-side gate around agent loop | live editable versioned piece | operator fine-tune | ToolLoopAgent, streaming |
| 3 | Render + hub + client review | 2–3 wk | reachability gate, server-resolved byline | crawlable hub + homepage | client pins + sign-off | **imagegen**, SSR, review token |
| 4 | v1 hardening + compounding loop | 2–3 wk | governors, kill switch, observability | refresh-as-draft, sibling-spawn | approval-debt KPI | cost ledger, DurableAgent (if needed) |

**Total to YMYL-credible v1: ~10–13 engineer-weeks** (Phases 0–3 are pilot-ready; Phase 4's compounding loop is partly deferrable to v1.1).

---

## Risks + mitigations

| Risk | Severity | Mitigation | Phase |
|---|---|---|---|
| **Methodology-fidelity regression** — re-authored prompts quietly underperform the SKILL.md harness, invisible to CI | Decides B's success | Capture Whispering Willows as a golden set **before** writing any prompt; regress every prompt/model bump against it | 0, every later phase |
| **Agent reasons past a hard gate** — a persuasive fine-tune bypasses a YMYL/faithfulness/thin-content veto | Agency-ending (YMYL) | Enforce all Stage-A vetoes + `canPublish()` in **host code**; agent gets a read-only `runGate` tool only | 1, 2 |
| **Cross-tenant leakage / voice bleed** — tools or the review token widen retrieval across clients | #1 flagged risk | Host-side tools keyed to one `workspace_id`/`client_id`; fail-closed RLS; review token scoped to one piece/version; corpus namespace as a hard boundary | 1, 3, 4 |
| **Crawler-invisibility** — any CSR slip makes the body absent from AI answer indexes | Kills the GEO thesis | SSR full-body as a CI-enforced reachability gate; net-new vitest for `apps/seo` render (placeholder-stripping, JSON-LD, status-filtering) | 3 |
| **Under-scoping from the local checkout** — the gate/FSM/render engine is on origin/preview, not local | Schedule | Pull origin/preview in Phase 0 before estimating or writing | 0 |
| **Cost/latency blowout** — tool round-trips exceed ≤$2; long pipelines exceed the Fluid window | Margin/UX | Measure from a live Gateway cost ledger; pre-flight cost reservation; adopt `DurableAgent` checkpointing before outgrowing one timeout | 4 |
| **YMYL credential hole** inherited from preview — publish trusts `request.author` | Regulatory (memory care) | Resolve byline server-side from `author_id` → voice-spec registry; require named credentialed Person + citations + recorded release before any YMYL publish; backup-reviewer path | 3 |
| **Cross-model invariant silently violated** — drafter == verifier collapses faithfulness into a self-consistency check | Costliest YMYL failure | Enforce `drafter !== faithfulnessVerifier` in `@sagemark/core` config; assert in a unit test | 1 |

---

## Thinnest end-to-end slice (build this first)

If you build one thing to prove the whole thesis on real infra, build the **Phase 1 vertical**: for **one client with one approved voice spec**, generate **one YMYL piece** through brief → drafter → faithfulness gate → `seo-gate` (Stage-A vetoes then Stage-B composite), persist it as `draft` in Supabase scoped by `workspace_id`/`client_id`, and **prove it cannot reach `published`** without a `PUBLISH` verdict + recorded human release + a server-resolved credentialed byline.

This slice is thin but it exercises **every load-bearing decision at once**: the ported deterministic moat (`@sagemark/core`), the non-compensatory host-enforced gate, the fail-closed FSM, multi-tenant RLS, the voice-spec hard stop, the provider seam + cost accounting, and the golden-set regression. It deliberately **omits** the agent loop, the canvas, the hub homepage, imagegen, and client review — all of which are UX and surface area layered on top of a moat that must work first.

The fastest honest demo of "this is a harness, not a write-my-blog toy" is: paste a brief, watch the gate **block** a draft that trips a Stage-A veto with a stable code and `score=null`, fix the brief, watch it pass to Stage-B, and see that even a `PUBLISH` verdict still sits at `draft` until a human releases it. That single screen is the product.
