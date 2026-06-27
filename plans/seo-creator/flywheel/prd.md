# PRD — SEO Creator: agent-driven, gate-governed SEO/GEO content hubs for senior-living agencies

> **Meet SEO Creator.** An agency editor at a senior-living marketing shop submits a one-paragraph brief; an autonomous Claude-Agent-SDK worker fetches sources, drafts a 2,200-word E-E-A-T memory-care guide, and self-scores it — but a deterministic, host-enforced gate decides whether it can ever ship, refusing to publish any draft that can't prove its claims or its byline. It lives at `apps/seo` in the Sagemark monorepo, sells per-seat / per-piece SaaS to agencies serving the senior-living / memory-care vertical, and produces not a brochure site but a **content hub** — a pillar page plus a funnel-staged cluster of long-form guides, built to be cited by Google, ChatGPT, and Perplexity alike.

---

**Status:** Final v1
**Author:** James (with claude-opus-4-8)
**Date:** 2026-06-25
**Reviewer rounds:** 0 (pending Phase 5)
**Manifest + Foundations:** Agentic Bible v1.0.0 (sha `2c02fe80`) · `flywheel.manifest.json` (canonical) · `DECISIONS.md` (locked D1–D9, authoritative over the analysis docs)
**Sequencing principle:** concierge-first — pilot Whispering Willows manually before self-serve. **Canonical Slice-1 DoD (identical in §12 and RFC §4/§7):** one piece — brief → **a single worker-hosted drafter call** streamed over the SSE relay → **host-enforced gate (the `/content/api/audit` route)** → **a MINIMAL SSR render** of the published piece → **one bounded edit → re-gate → a gated version**, with fail-closed publish behind `canPublish()` — **NOT the full self-revising autonomous loop/canvas, which arrives in Slice 2.** Prove that thinnest end-to-end slice green before widening. The full self-revising autonomous loop and the live canvas are deliberately *outside* this thinnest slice — they widen the surface in later slices (RFC PR 010–011, 013–014), they are not what the thinnest slice proves. The thinnest slice proves the ported moat, the host-enforced gate, the FSM, RLS, the voice-spec hard stop, the worker topology + SSE relay, the minimal render, one bounded re-gate, and golden regression; the full autonomous loop, the hub homepage, and client review come after it is green.

---

## 0 · TL;DR

**Situation.** The click is collapsing. AI Overviews are crushing organic CTR, and the marketing world has reorganized around **GEO/AEO** — getting *cited* by answer engines, measured by *share of model*. The strategy everyone now repeats is identical: feed LLMs structured, truthful, well-sourced content. Senior-living agencies (our beachhead — Whispering Willows is a live engagement) need exactly this, in a YMYL domain where being wrong is a brand-ending event.

**Complication.** Across ~12 shipping products, the field is crowded on **generation**, freshly funded on **measurement** (Profound, AthenaHQ), and **empty on governance**. Every surveyed tool nudges quality with a *compensatory* score (Surfer's 0–100) or brand-voice consistency — **none can refuse to publish.** Meanwhile the ground is actively burning: a 2026 Guardian investigation found Google's *own* AI Overviews gave misleading health advice in **44%** of medical searches; CNET shipped 77 ungoverned AI finance articles with numeric errors; Sports Illustrated fabricated AI author personas. The failure in every case was **process, not model** — there was no pre-publish gate.

**Question.** What does an agency buy that a generic LLM, a $49/mo optimizer, or a $40M-funded horizontal content platform cannot give it — and that survives the next core update?

**Answer (governing thought).** **SEO Creator wins on governance, not speed.** It is the only content engine that can *refuse to publish* on faithfulness and YMYL grounds. The model is the replaceable middle; the **harness is the moat** — a non-compensatory fail-closed gate, a cross-model faithfulness check, a fail-closed lifecycle FSM, and per-tenant voice/byline isolation that together turn "AI content" from a deindexing liability into a compounding, crawlable, citation-earning asset.

- **Wedge = governance, not generation speed.** Speed is table stakes (every competitor has it); *refusal* is unoccupied ground. We frame the entire product around the gate that says no.
- **Moat = the fail-closed FSM + vertical E-E-A-T depth.** A horizontal toolkit (AirOps, the $40M displacement risk) can bolt on a gate; it will not prioritize opinionated senior-living E-E-A-T — care-level schema, named-clinician bylines, the memory-care faithfulness corpus. Vertical depth is what a competitor cannot replicate in 6 months.
- **Timing = the GEO shift + YMYL enforcement sharpening at once.** AI-answer-engine citation is now the success metric (north-star KPI = share-of-model); simultaneously SpamBrain scaled-content detection, E-E-A-T enforcement, and floating AI-health-disclaimer regulation punish the ungoverned. The market is bifurcating into ungoverned scale-content (losing) and governed E-E-A-T-first content (winning) — and **no shipping tool productizes the governance half.**
- **Validation = real, not hypothetical.** Whispering Willows is a live client engagement; the reference artifact ([whispering-willows-content-demo.vercel.app](https://whispering-willows-content-demo.vercel.app/)) reflects real client work. The Trigger-3 commercial gate passes — no abort.
- **The one binding open question = the credentialed YMYL reviewer (D6) is UNSTAFFED.** With a hard gate, this human is the throughput chokepoint on YMYL publish. Staffing a name + a backup + a pages/week ceiling is the top go-live blocker — needed before Whispering Willows goes live, not before the build starts.

---

## 1 · Why this product, why now

### 1.1 The pain

A senior-living marketing agency is squeezed from three directions at once, and none of the tools it can buy resolve the squeeze:

- **The click is disappearing.** AI Overviews and answer engines intercept the query before the user ever reaches a blue link. Ranking #1 now often means *not getting the click* — the answer was synthesized above the fold, possibly citing a competitor. The agency's deliverable has silently changed from "rank a page" to "be the source the model quotes," and its tooling hasn't caught up.
- **The YMYL ground is radioactive.** Memory-care content is Your-Money-or-Your-Life: a wrong medication interaction, a fabricated statistic, an uncredentialed author attached to dementia-care advice. The cautionary tales are recent and specific — CNET's $10,300-vs-$300 finance error, Sports Illustrated's fake author personas, Babylon Health's collapse, and Google's own AI Overviews failing 44% of medical searches in 2026. A single ungoverned mistake can deindex a client's whole domain post-Helpful-Content and damage a real family's care decision.
- **The available tools make the problem worse.** Generation tools (Jasper, Byword, Writesonic) make publishing *feel too easy* — Byword is described as "the fastest way to trigger a manual action." Optimization tools (Surfer, Frase) score with a **compensatory** 0–100 that drives keyword-stuffing and, users report, *rank drops*. None of them can look at a draft and say "this claim is unsourced; I will not publish it." The agency is left manually back-stopping an engine that has no brakes.

The customer is not asking for faster drafts. They're asking for a way to ship AI content into a YMYL vertical **without betting the client's domain on it.** That is a governance problem, and it has no productized answer today.

### 1.2 Strategic frame — three moats

The positioning thesis is one line: **the model is the replaceable middle; the harness is the moat.** Concretely, three layers compound into defensibility:

1. **The non-compensatory fail-closed gate (the wedge).** SEO Creator can *refuse to publish*. Stage-A ordered vetoes (`UNSOURCED_STAT`, `KEYWORD_STUFF`, `YMYL_NO_BYLINE`, `THIN_CONTENT`, `BANNED_LEXICON`, `VOICE_FAIL`, `EVAL_FAILED`) short-circuit a draft to REJECT/REVISE with `score=null` *before* the Stage-B 8-dimension composite (faithfulness strictly heaviest) is ever computed. This is the structural inverse of Surfer's compensatory green-score: a persuasive fine-tune can tune soft surface but can **never** talk past a YMYL/faithfulness/thin-content veto. The wedge is the word *no* — and the Phase-2 survey confirmed it is unoccupied ground across ~12 products.

2. **The opinionated fail-closed lifecycle FSM + vertical E-E-A-T depth (the durable moat).** The displacement risk is **AirOps** ($40M Series B at $225M, Greylock, Nov 2025) — well-funded, agency-credible, converging on the same SEO+GEO surface. AirOps ships *guidance* (Brand Kits, Knowledge Bases) — brand-voice consistency, not a refuse-to-publish gate. A horizontal toolkit *can* add a gate; what it will not prioritize is the opinionated, senior-living-specific depth: care-level schema, named-clinician bylines resolved server-side, a memory-care faithfulness corpus grounded to the Alzheimer's Association / NIA, and a fail-closed FSM whose `canPublish()` encodes the exact YMYL preconditions of this vertical. **Vertical depth is the moat a generalist cannot match in 6 months.** AirOps adding a generic gate does not give it senior-living E-E-A-T judgment.

3. **Per-tenant voice + byline isolation (the trust moat and the cardinal safety boundary).** Voice-as-data: every client has an approved `voice_specs` row (`tone[]`, `bannedLexicon[]`, a credentialed `authors[]` registry, `attributionSources[]`, `samplePassages[]`). `approved_at IS NULL` is a **hard stop** — no approved spec means no generation and *no default-voice fallback*. Cross-tenant voice bleed is the #1 agency-ending bug; it is engineered out by host-side tools keyed to exactly one `workspace_id`/`client_id`, fail-closed RLS (anon `SELECT` only `status='published'`), and review tokens scoped to a single piece/version. This is simultaneously the E-E-A-T provenance layer (bylines are real and credentialed) and the anti-bleed boundary.

The through-line tying all three to the agentic-bible framework: a deterministic control plane sitting *outside* the autonomous loop is what converts a probabilistic generator into a governed platform primitive. The gate, the FSM, and the tenancy boundary are host code the agent calls as tools and can never reason past — the same fail-closed property the bible prescribes for any agent that touches a consequential surface.

*References: ch. 14 (framework-to-platform), ch. 16 (control-plane)*

### 1.3 What we already own

The single most important scoping fact: **the content-hub engine is not greenfield.** The deterministic moat exists, battle-tested, on `flywheel-main` `origin/preview` (PRs #1668–1684) and is **PORTED, not reinvented.** This collapses the build from "rebuild the engine" to a much smaller surface.

| Asset we already own | Disposition | Why it matters |
|---|---|---|
| **22 deterministic scorers** (flesch-kincaid, keyword-density, passive-voice, content-score, meta/OG/FAQ generators…) | **PORT verbatim** — framework-agnostic pure functions → `@sagemark/core` | The Stage-B composite and surface quality are pre-built and CI-tested |
| **Cross-model faithfulness gate** (sonnet drafter vs **haiku** verifier; invariant drafter ≠ verifier) | **PORT, preserve invariant** | The mechanism that manufactures ground truth where YMYL content has no compiler |
| **Non-compensatory `seo-gate`** (Stage-A vetoes → Stage-B 8-dim composite) | **PORT to host code** | The wedge itself — exposed to the worker as a read-only `runGate` tool |
| **Fail-closed `lifecycle-fsm`** (`canPublish`/`canTransition`, snapshot rules) | **PORT to host code** | The publish chokepoint + kill switch |
| **Drizzle schema** (`content_clients`/`content_pieces`/`content_piece_versions`/`voice_specs`/`review_comments`) | **PORT + extend** (`cluster_role`/`funnel_stage` first-class per D7) | The system of record; multi-tenant from row one |
| **The existing `seo-copywriter` suite — 4 skills** (seo-strategist → seo-assistant → seo-blog-writer → seo-audit, the real `SKILL.md` files) | **RUN DIRECTLY** — the Agent-SDK worker loads and runs the existing suite skills as-is; they are not re-authored as prompts | Net-new cost is *wiring* the suite into the worker + standing up the kernel route contract, not authoring an engine |
| **The kernel route contract** (`/content/api/{brief,draft,audit,publish}` + the `src/lib/content` kernel the suite skills orchestrate) | **PORT + STAND UP** the exact route contract in `apps/seo`, backed by the ported seo-gate / lifecycle-fsm / content-store / scorers | The suite skills are kernel-backed — they orchestrate these routes, never re-implement the gate/FSM/persistence in markdown |
| **VideoGen three-zone canvas + `useIframePinDrop`** (`apps/agents` videogen) | **REUSE** the interaction pattern | The operator studio + client-review pin-drop UX is a proven shape |
| **`packages/videogen/imagegen`** hero-image engine (async/job, license/provenance) | **REUSE in-process** | Healthcare-appropriate hero imagery without a second deploy target |
| **`@sagemark/core` provider seam** (`resolveGatewayModel`, `CostAccountant`) | **REUSE** (mirrors `apps/trailhead`) | Fail-closed per-run cost ceiling + Gateway/BYOK seam, already vetted in-repo |

Two consequences. First, the headline build cost collapses to **wiring the existing four-skill `seo-copywriter` suite into the Agent-SDK worker, standing up the `/content/api/{brief,draft,audit,publish}` kernel route contract in `apps/seo`, plus the worker topology + the transport** — not rebuilding a content engine and not re-authoring the producers as prompts. The worker *loads and runs the real `SKILL.md` skills*; the deterministic kernel rides as host-side routes the agent orchestrates. Second, the risk that *survives* the collapse is **methodology-fidelity regression** — a model/tool-order change quietly making the suite underperform its labeled baseline, invisible to CI. The mitigation is mandatory and gates Phase 0: **capture the live Whispering Willows hub as a human-labeled GOLDEN SET before the suite is wired into the worker**, and regress every model/tool-order/skill-config change against it. With D1's full autonomous loop, nondeterminism is the dominant failure surface, so the golden-set discipline is no longer optional.

*References: ch. 07 (extensibility), ch. 17 (evals-learning-loop)*

### 1.4 Stakeholders + decision-authority map

| Stakeholder / role | Relationship | Authority | Can veto? | Sign-off required | Notes |
|---|---|---|---|---|---|
| **James Stone** (founder / operator) | builds | full | **yes** | no | Decision authority on all of D1–D9; owns the strategic angle and the final audience-shaped pass |
| **Whispering Willows** (pilot client) | pays | input-only | no | no | Real client engagement — the validation, not a hypothetical. Concierge-first pilot before self-serve |
| **Credentialed YMYL reviewer** ⚠️ **UNSTAFFED** | owns-risk | partial | **yes** (at publish time) | no | Holds release authority on YMYL content — a **product-level** gate, not a plan-level sign-off. **Not yet named.** The top go-live blocker |
| **Agency editor / operator** | uses | input-only | no | no | Drives the studio: submits/refines briefs, runs fine-tune turns, requests publish |
| **End families / prospective residents** | consumes | none | no | no | The ultimate beneficiary of the faithfulness gate; never interacts with the tool, only the published hub |

**Stakeholder note — the unstaffed reviewer is the binding constraint.** With D2 locked to a hard gate, the credentialed YMYL reviewer is the chokepoint on the YMYL publish *rate*: `canPublish()` requires a recorded human release plus, for any `is_ymyl` piece, a named credentialed author and citations. There is **no engineering default** that can substitute for this — it is a staffing decision (D6), and it has two halves still owed by James: a **number** (pages/week one reviewer clears, which calibrates the per-asset cost ledger and the realistic hub-delivery cadence) and a **name** (the backup-reviewer path, so a single reviewer is not a single point of failure). **No YMYL page goes live until the backup path exists.** This is required before Whispering Willows go-live, not before the build starts — the build proceeds; the *publish* of YMYL content blocks on it. Target resolution: specialist-review by 2026-08-15.

*References: ch. 16 (control-plane), ch. 09 (modes-state)*

## 2 · Where this fits

SEO Creator is the first Sagemark service built on the Claude Agent SDK self-hosted-worker pattern (D5) with a Vercel-Sandbox host (D9). It is a **new `apps/seo` service** plus a separate Agent-SDK worker — a thin UI + orchestration API on Vercel, with the autonomous loop running off-platform and all durable state in Supabase. It deliberately does *not* extend `apps/agents` (uniformly hand-rolled `fetch → OpenRouter`); a clean service keeps the two LLM ecosystems from tangling and gives the ported deterministic primitives a natural home in `@sagemark/core`, shared by both.

| App / package | Status | Role | Stack / host | Relationship to SEO Creator |
|---|---|---|---|---|
| **`apps/seo`** | **NEW** | Thin operator studio (three-zone canvas) + tokenized client-review route + orchestration API (`/api/run`, `/api/edit`, `/api/publish`) that relays worker SSE to the browser | Next.js 16 · React 19 · Tailwind v4 · Vercel (Node/Fluid) | **The product.** Owns the UI + orchestration; delegates the autonomous loop to the worker |
| **Agent-SDK worker** | **NEW** | Runs the long-lived autonomous `ToolLoopAgent` loop (fetch → outline → draft → verify → revise → gate) via the real Claude Code harness; calls host-side tools for the gate, scorers, and DB | Claude Agent SDK on **Vercel Sandbox** (ephemeral microVMs) | **The loop (D5/D9).** Ephemeral compute only — *all* per-run session/agent/working-dir state persists to Supabase, never the Sandbox filesystem across runs |
| **`@sagemark/core`** | **NEW** (ported) | The moat made a package: 22 scorers, cross-model faithfulness gate, non-compensatory `seo-gate`, fail-closed `lifecycle-fsm`, provider seam (`resolveGatewayModel`, `CostAccountant`) | TypeScript library | **The deterministic kernel.** Exposed to the worker as read-only host tools the agent cannot reason past; one gate module, never a drifted copy |
| **`packages/schema-flywheel`** | existing | Drizzle schema home | Supabase Postgres | **Ported into.** `content_pieces` family lands here + the `cluster_role`/`funnel_stage` migration (D7) |
| **`packages/videogen/imagegen`** | existing | Hero/section image engine (async/job, license + provenance) | TypeScript library | **Reused in-process.** Generates healthcare-appropriate imagery for `[photo:slug]` placeholders; no HTTP hop, inherits the `CostAccountant` reservation |
| **`apps/seo` (public SSR routes)** | **NEW** (same service) | Public SSR render surface — `/clients/[client]/blog/[slug]`, FAQPage JSON-LD, per-client sitemap/robots, the generated resource-library **homepage** (D7) | Next.js 16 · React 19 · Tailwind v4 · Vercel | **The publish target.** The public render routes live in the same `apps/seo` service (NOT `apps/site`); full-body HTML in initial response (crawlers largely don't run JS); a CI reachability gate enforces sitemap ⇄ published-set parity |
| **`apps/trailhead`** | existing | Provider-seam reference implementation | Next.js · Vercel | **Reference only.** The `ai.ts` `CostAccountant` + Gateway/BYOK pattern `@sagemark/core` mirrors |
| **`apps/agents`** | existing | Scorer-library *source* + VideoGen canvas/pin-drop *source* | Next.js · Vercel | **Donor, not host.** We lift the scorers and the canvas pattern; we do not build SEO Creator inside it |

The shape of the system: a human submits a typed brief in `apps/seo`; `apps/seo` provisions a Vercel-Sandbox worker that runs the Claude-Agent-SDK loop; the worker streams SDK events back through `apps/seo` as SSE to the three-zone canvas; the loop calls `@sagemark/core` host tools for grounding, scoring, and the gate; host code (never the agent) enforces the Stage-A vetoes and `canPublish()`; persisted pieces render publicly through the SSR routes in `apps/seo`. Streaming spans the hop **worker → `apps/seo` → browser** — a transport that must be designed in Phase 1, because D5 splits the topology into two deploy targets where the recommended in-process path would have had one.

*References: ch. 14 (framework-to-platform), ch. 06 (delegation), ch. 16 (control-plane)*

---

## 3 · Product surfaces

The SEO Creator exposes three operator-facing surfaces and one client-facing surface, all built on the same fail-closed substrate (the ported gate, FSM, and per-tenant RLS). The design stance across every surface is **brief-first, gate-honest, release-gated**: the human's leverage point is the typed brief, the agent's reasoning and the gate's adjudication are shown in the open, and "eligible" is rendered visibly distinct from "published." Nothing in any surface lets a user — operator or client — talk the engine past a Stage-A veto. The surfaces map onto the `draft → review → approved → published → archived` FSM: surfaces 3.1–3.2 produce and refine while `status='draft'`; 3.3–3.4 govern and observe; the client surface (specified in doc 04) captures **advisory** client sign-off (it does not itself perform `review → approved` — that release is the credentialed reviewer's, per §9.1); release to `published` is host-side and human.

### 3.1 Primary surface — the three-zone agent canvas

The operator screen is a three-zone canvas (`<SeoStudioCanvas>`) ported from videogen's `StudioCanvas`, stripped of operator-only video controls and re-pointed at a markdown `content_piece`. It is the single most load-bearing surface — it is where generation, scoring, and fine-tune all happen — and it is deliberately built to *feel like the Claude harness*: visible thinking, a streaming artifact, and an inspector that adjudicates in the open.

```
┌──────────────┬───────────────────────────────┬────────────────────┐
│  AGENT       │  ARTIFACT                     │  INSPECTOR         │
│  (left)      │  (center)                     │  (right)           │
│  chat +      │  BriefCard → Editor ⇄ Preview │  Stage-A vetoes    │
│  thinking +  │  • markdown editor            │  Stage-B 8-dim     │
│  tool-use    │  • live SSR preview iframe    │    score bars      │
│  ledger      │    (/clients/[c]/blog/[slug]) │  verdict band      │
│  [composer]  │  [Editor | Preview] tabs      │  version history   │
└──────────────┴───────────────────────────────┴────────────────────┘
```

**LEFT — Agent.** A chat composer plus an append-only stream of message deltas, agent thinking (muted italic, mirroring `PlanningAgentChat`), and **taxonomy-coded tool-use rows** (`serpFetch ✓`, `draftBody (streaming…)`, `runFaithfulnessGate ✓ FAITHFUL 91%`, `runGate → Stage-A clean`, `runGate → Stage-B 83 REVIEW`). Tool rows are never raw model prose piped back into the loop — they are stable coded events, which is both an injection-surface discipline and the thing that makes the panel *read* like the harness. The composer is **hard-disabled when the selected client has no approved `voice_spec`** (`requireApprovedVoiceSpec()` is a hard stop; the disabled state shows the explicit reason "This client has no approved voice spec; generation is blocked" — there is no default-voice fallback).

**CENTER — Artifact.** The `content_piece`. **The zone opens on a `<BriefCard>`, not a draft** — this is the critical brief-first stance. The agent's first tool call is a live SERP fetch; observed intent, `clusterRole`/`funnelStage`, entities, `dataPointsNeeded`, and the `is_ymyl`/`reviewerRequired` flags stream in as an *editable structured object* before a single body token exists. The human edits and approves the brief — the cheap, high-leverage checkpoint — and only then does the card flip to the streaming article. Once generated, the center is the AI SDK "artifacts" pattern: a side-panel markdown editor that toggles to a same-origin sandboxed iframe rendering the actual SSR page at `/clients/[client]/blog/[slug]`, paired with the CSS-only `SerpPreview` search-snippet mock.

**RIGHT — Inspector.** The two-stage gate scorecard plus version history. **Stage-A vetoes** render as red blocking chips with stable codes (`UNSOURCED_STAT`, `KEYWORD_STUFF`, `YMYL_NO_BYLINE`, `THIN_CONTENT`, `BANNED_LEXICON`, `VOICE_FAIL`, `EVAL_FAILED`); when any fired, the composite reads `score = null` ("no composite computed — Stage-A veto") and the verdict band shows REJECT/REVISE. **Stage-B** (only if Stage-A is clean) renders 8 horizontal 0–100 bars (readability, keyword, structure, **faithfulness**, voice, geo, originality, eeat) with faithfulness visually weighted heaviest, plus the verdict band (PUBLISH ≥85 / REVIEW 70–84 / REVISE 50–69 / REJECT <50). The scorecard honestly communicates *eligible ≠ published*: there is no publish affordance here. The inspector also hosts the `VersionHub` (switch / name / compare) and a `PieceStatusRow` showing the FSM state and any guard reasons.

The canvas is a formal state machine — `idle → briefing → generating → streaming-gate → done(eligible) → editing` — and every long-running state carries a **heartbeat + timeout + circuit-breaker** so a wedged session surfaces as an explicit error row (`503 no-llm-key`, `402 credits`, `409 stale-edit`, `429 rate-limit`, `403 ownership`) rather than an indefinite spinner. The last-good body and last-good scorecard are always preserved across an error — an edit that fails never destroys the current artifact. (This directly answers the admin-app failure mode where a broken build went unnoticed for 8 days.)

*References: ch. 01 (bible v1.0.0, sha: 2c02fe80), ch. 09 (bible v1.0.0, sha: 2c02fe80)*

### 3.2 Onboarding flow — client + brief intake

There are two distinct intake moments, and conflating them is a bug. **Client onboarding is a one-time tenant setup; brief intake is a per-piece setup that recurs every generation.**

**Client onboarding (tenant setup).** Creating a `content_clients` row establishes the tenant root: `name`, `blog_slug` (UNIQUE — the public URL namespace), and the `workspace_id` bridge. Onboarding is **not complete until an approved `voice_spec` exists**, because the canvas composer is hard-disabled without one. Voice-spec authoring is its own flow (3.3): the operator drafts tone/register/audience, the `bannedLexicon`, the `authors[]` registry (`{id, name, credentials}` — the E-E-A-T byline source), `pillarLinks`/`internalLinks`, `attributionSources`, and `samplePassages`. A spec with `approved_at IS NULL` is a draft and blocks generation; approval is an explicit, recorded action. For a YMYL client (e.g. Whispering Willows, memory care) the `authors[]` registry must carry at least one *credentialed* author before any YMYL piece can clear the byline veto.

**Strategy layer (upstream of brief intake — `seo-strategist`, Stage 0).** A new client or a new content program starts at `seo-strategist`, the human-gated strategy layer that runs *first*, upstream of any brief. It turns client + business goal + market into an operator-approved `ContentStrategy` — the topic-cluster map across the funnel, the competitive-gap + keyword/intent analysis (gap-first, not volume-first), the E-E-A-T / named-author plan, the GEO/AEO + schema plan, the conversion architecture, and a prioritized roadmap. Each roadmap item is the strategic context (cluster role, assigned credentialed author, conversion target) that then enters the chain at `seo-assistant` as a brief request; an off-strategy one-off requires an explicit, recorded operator override.

**Brief intake (per-piece, brief-first).** The operator selects a client (loading its approved voice spec) and enters an approved roadmap item — a keyword, a cluster slot, or "draft the pillar." The agent's first action (driving `seo-assistant`'s brief route) is a **live SERP fetch** (host-side, scoped to one client); intent is *observed from the SERP*, never asserted from the query string. The brief streams into the `<BriefCard>` as an editable structured object: observed search intent, proposed `clusterRole`/`funnelStage`, entities, `dataPointsNeeded`, grounding `sources`, and the auto-derived `is_ymyl` flag (set from auditable `ymylSignals`). The human edits the outline and entities, confirms `is_ymyl`, and only then enables "Generate." **Nothing is generated until the brief is approved** — get the brief right and the draft is bookkeeping.

*References: ch. 04 (bible v1.0.0, sha: 2c02fe80), ch. 09 (bible v1.0.0, sha: 2c02fe80)*

### 3.3 Customer admin / control surface

The control surface is the operator's tenant-management plane — distinct from the per-piece canvas — and it owns the configuration that the gate and FSM consume.

- **Client roster.** List/create/archive `content_clients`; each row shows tenant name, `blog_slug`, piece counts by status, and approval-cycle health (see 3.4). Archiving a client is fail-closed (`ON DELETE RESTRICT` on `content_pieces.client_id` — a tenant with pieces cannot be silently deleted).
- **Voice-spec editor + approval.** Author and approve the per-client `voice_spec`: tone/register/audience, `bannedLexicon` (which *extends* the built-in slop floor that `VETO_BANNED_LEXICON` checks), the `authors[]` credentialed registry, `pillarLinks`/`internalLinks`, `attributionSources`, `samplePassages`. Approval flips `approved_at` and unblocks generation. A brand-style-guide markdown rendered from the spec feeds the LLM voice gate.
- **Per-client instance overrides.** Operators may tune **soft** surface only — Stage-B threshold nudges and the `bannedLexicon` extension. **Hard-gate canon is read-only**: the Stage-A veto order, the faithfulness-strictly-heaviest invariant, and `canPublish()` are not editable from any admin screen. This is the architectural boundary that keeps the moat from collapsing into "the client configured the gate off."
- **Author / reviewer registry.** Manage the `authors[]` entries and credentials that `author_id` resolves to server-side at publish, plus the credentialed-reviewer assignment for YMYL release (D6 — the reviewer ceiling + backup name is the binding constraint on YMYL publish rate; no YMYL piece goes live without a recorded credentialed release).
- **Review-link management.** Mint, revoke, and observe tokenized client-review links (each scoped fail-closed to exactly one `(workspace_id, client_id, piece_id, version)`).

*References: ch. 03 (bible v1.0.0, sha: 2c02fe80), ch. 16 (bible v1.0.0, sha: 2c02fe80)*

### 3.4 Operational dashboards

Three dashboards instrument the three things this product can silently get wrong — the gate misbehaving, cost blowing the budget, and the engine failing at its actual north-star job (getting cited by answer engines). All three read host-side, deterministic data, never agent self-report.

**Gate metrics.** Per-client and aggregate: Stage-A veto rate broken out **by code**, Stage-B verdict distribution (PUBLISH/REVIEW/REVISE/REJECT), and the audit→revise cycle histogram (with the N=3 cap and `forcedToHumanReview` hold-state counts). **The instrumented D2×D3 tension lives here:** the dashboard surfaces the *share of gate-blocks attributable to thin sourcing* (`UNSOURCED_STAT` + low-faithfulness-from-thin-sources). This is the load-bearing measurement for the D3 decision — if sourcing is the top blocker after the first cluster, D3 flips from "free DuckDuckGo scraping" to "fund a SERP API," and engineering wires either behind the same `brief.sources` contract. D3 is a *measured, reversible* call, and this dashboard is the instrument that makes it so.

**Cost ledger.** The separate SEO AI-Gateway ledger (D4). Per-run and per-piece USD from live Gateway usage (not asserted), the `CostAccountant` pre-flight reservation and any `CostCapExceededError` aborts, and the running comparison against the `≤$2`-per-editorial-piece target. The autonomous loop (D1) means more model round-trips per piece, so cost-per-asset and per-run trend lines are first-class — a regression here is the early-warning signal that a prompt or model change made the loop chattier.

**Share-of-model (north-star KPI).** AI-answer-engine citation / share-of-model — the metric the whole GEO thesis targets. Track, per hub and per piece, whether and how often the content is cited by ChatGPT/Claude/Gemini answers (DR-038, reconciled to shipped reality per audit-005; Perplexity = deferred 4th) for the target queries, alongside crawl-surface health (sitemap == published-and-indexable set, both directions — the CI reachability gate's runtime mirror). **Hybrid source-channel model (DR-038 addendum) — proxy ≠ citation:** each measurement carries a `source_channel` ∈ {`direct-citation`, `direct-proxy`, `vendor`}. `direct-citation` (Claude + web-search tool → a REAL cited source) and `vendor` (a contracted GEO-tracker, deferred) are the genuine citation signal and roll up as the **citation rate**; `direct-proxy` (a ChatGPT/Gemini model-API answer) is a model-answer **mention only**, surfaced separately as **"API-answer mention rate (proxy)"** and **never** counted as a citation. The dashboard keeps the two rates visually distinct so a proxy mention is never read as a won citation. Paired with the **approval-cycle-time** KPI (link-sent → sign-off, plus open-thread count) from doc 04, since approval debt — not generation — is the named throughput bottleneck.

*References: ch. 13 (bible v1.0.0, sha: 2c02fe80), ch. 17 (bible v1.0.0, sha: 2c02fe80)*

### 3.5 Content workflow primitives

The workflow decomposes into three nested objects and one repeatable refinement loop.

**Hub → pieces → sections.**
- A **hub** is a cluster — a strategy-layer artifact (the `seo-strategist` `ContentStrategy`: pillar + cornerstones + funnel-staged spokes with explicit spoke→pillar edges), *not* a database table. Cluster membership is realized physically as internal links in each piece's markdown and as the curated resource-library homepage (D7, generated in v1).
- A **piece** is a `content_pieces` row — the atomic unit. Its `cluster_role` (pillar | cornerstone | spoke | faq | checklist) and `funnel_stage` (awareness | consideration | decision | retention) are **first-class indexed columns** (promoted from `brief_snapshot` jsonb in Phase 1 — D7), because the generated homepage and the related-guides nav need a queryable cluster graph. Four archetypes share the row shape and the gate but tune the brief template and gate emphasis: pillar (internal-link completeness), spoke (faithfulness + GEO + E-E-A-T), FAQ (self-containment for AI quoting), checklist (structure + relaxed prose-length floor).
- **Sections** are `H2` blocks in the body, each carrying answer-first capsules (the GEO on-page pattern the gate scores) and, on the canvas, per-section affordances: "Regenerate section" (region-scoped edit), and on the client surface section-level Approve / Request-changes verbs.

**Fine-tune (the repeatable loop).** While `status='draft'`, refinement is conversational and multi-turn, not regenerate-from-scratch. Three modalities converge on **one auditable version-write**: (a) a chat instruction ("tighten the intro," "add a Medicaid eligibility stat with a source") → a bounded markdown-region diff; (b) a direct inline edit in the center editor → snapshot on blur; (c) a section regeneration. Every accepted edit (1) writes an append-only `content_piece_versions` snapshot and bumps `version`; (2) **re-runs the full two-stage gate in host code** — an edit can never advance past a Stage-A/YMYL/faithfulness veto; (3) streams a one-line "what changed" summary ("Added Medicaid eligibility stat (NIA-sourced); faithfulness 89→92"). Concurrency is guarded by a SHA-256 stale-edit check (409), per-tenant rate limit (429), and workspace-ownership check (403). The N=3 audit→revise cap holds a stuck piece at `review` (`forcedToHumanReview`) rather than looping forever. A named, undeletable version = a release decision (recording approver identity, which supplies the YMYL byline).

*References: ch. 09 (bible v1.0.0, sha: 2c02fe80), ch. 08 (bible v1.0.0, sha: 2c02fe80)*

---

## 5 · Capabilities

The capability set is deliberately **deep, not wide**: one artifact (the governed content hub), one client (Whispering Willows) at v1, and a small number of load-bearing capabilities each hardened to YMYL-credible depth. "Load-bearing?" marks capabilities the product is incoherent without. "Tier" marks v1 / fast-follow / later.

| # | Capability | Wide/Deep | Load-bearing? | Tier | Notes |
|---|---|---|---|---|---|
| 1 | **Autonomous generation loop** (D1) — the Agent-SDK worker **runs the existing four-skill `seo-copywriter` suite directly** (`seo-strategist` strategy layer → `seo-assistant` brief → `seo-blog-writer` draft → `seo-audit` audit/gate), self-directing SERP-fetch → outline → draft → faithfulness-verify → revise → gate, streamed live | Deep | **Yes** | v1 | Claude Agent SDK worker on Vercel Sandbox; the four real `SKILL.md` skills are loaded and run (not re-authored as prompts) and are kernel-backed via the `/content/api/{brief,draft,audit,publish}` routes `apps/seo` stands up; `apps/seo` relays SSE; the content routes are the host-side tools that keep the gate host-enforced (per D5 / §4.0 / §4.1). The harness-feel surface. Nondeterminism is the dominant failure mode → golden-set regression mandatory. |
| 2 | **Non-compensatory two-stage gate** (D2) — ordered Stage-A hard vetoes short-circuit to `score=null`; else Stage-B 8-dim weighted composite | Deep | **Yes** | v1 | The product. Enforced in **host code outside the agent loop**; agent gets read-only `runGate`. Faithfulness strictly heaviest (0.20). |
| 3 | **Cross-model faithfulness gate** — sonnet-4-6 drafter ≠ haiku-4-5 verifier; every claim traces to `brief.sources` | Deep | **Yes** | v1 | drafter ≠ verifier is an *invariant* — collapsing it makes the gate a self-consistency check. 12s timeout + 25-claim cap (ported scars). |
| 4 | **Fail-closed lifecycle FSM** — `canPublish()` (canonical predicate in §9.1) requires PUBLISH verdict ∧ evalRan ∧ humanRelease ∧ (YMYL ⇒ named credentialed author + citations) | Deep | **Yes** | v1 | A skipped/thrown/timed-out eval **blocks**. No autopilot. Fixes a prior fail-open non-fatal-publish bug (a thrown eval defaulting to publish). |
| 5 | **Per-tenant voice + byline boundary** — `voice_specs` as data; `approved_at IS NULL` is a hard stop; byline resolved server-side from `author_id` at publish | Deep | **Yes** | v1 | Anti-bleed + E-E-A-T boundary. Closes the inherited YMYL credential hole (never trust `request.author`). |
| 6 | **Brief-first intake** — observed-intent SERP brief as the human checkpoint before any body token | Deep | **Yes** | v1 | The cheap high-leverage gate. `is_ymyl` confirmed here from auditable signals. |
| 7 | **Conversational fine-tune** — bounded markdown-region diffs; chat / inline / section; every edit an auto-version + full gate re-run | Deep | **Yes** | v1 | SHA-256 stale-guard (409), rate-limit (429), ownership (403). Net-new SEO constrained-edit contract (videogen scene-prop diff doesn't generalize). |
| 8 | **Multi-tenant SSR render surface** — `/clients/[client]/blog/[slug]` full-body HTML + FAQPage JSON-LD + placeholder stripping + sitemap/robots | Deep | **Yes** | v1 | CSR is lethal to the GEO thesis (crawlers don't run JS). CI reachability gate; the `apps/seo` render-route vitest is net-new. |
| 9 | **Generated resource-library homepage** (D7) — hero, statistic callout, three-stage cluster section, guide-card grid, tour CTA + license badge | Wide | Yes | v1 | The hub-as-artifact. Driven by the promoted `cluster_role`/`funnel_stage` columns. Net-new template. |
| 10 | **Tokenized client review + on-page feedback** — pinned comments, section Approve/Request-changes, comment → agent edit | Deep | **Yes** | v1 | Token scoped fail-closed to one `(client, piece, version)`. Attacks approval debt — the named throughput bottleneck. |
| 11 | **Cost ledger + reservation** (D4) — separate SEO Gateway ledger; `CostAccountant` fail-closed pre-flight at a per-run cap | Wide | Yes | v1 | `≤$2`/piece *measured*, not asserted. More important under D1's extra round-trips. |
| 12 | **In-process hero/inline imagery** — imagegen for unresolved `[photo:slug]` only, async/job-wrapped, license-provenance recorded | Wide | No | fast-follow | Typed function import, no HTTP hop. Cannot publish an unlicensed asset by construction. |
| 13 | **Multi-piece cluster generation** — generate a full hub (pillar + ~8 funnel-staged spokes) from one strategy | Wide | No | fast-follow | Sequence the thinnest single-piece slice green first (per the Phase-1 scope-inflation note), then widen. |
| 14 | **Inline edit suggestions + presentation mode** — client highlight→replace; full-bleed QBR view with "Reviewed & graded" trust strip | Wide | No | later | Polish multipliers; pinned comments + section verbs already cover the core requirement. |

### Never list (judge enforces)

These are non-overridable canon, enforced by the host-side gate and FSM — not by prompt instruction, and not by any operator/client toggle. The judge's domain checks (repurposed from `judge-prompt.md`) are the runtime acceptance-test spec for each.

1. **Never fabricate a citation, statistic, author, credential, testimonial, or license badge.** Every figure must trace to a named `brief.sources` authority; `VETO_UNSOURCED_STAT` blocks. A fabricated byline or credential cannot pass the byline resolution at publish.
2. **Never publish past a veto.** A Stage-A veto sets `score=null` and short-circuits; `canPublish()` permits `published` only on a PUBLISH verdict with a real eval and a recorded human release. No persuasive instruction — operator *or* client ("just drop the disclaimer," "ignore the byline rule, publish") — can talk the agent past it; the agent holds only a read-only `runGate`.
3. **Never publish a YMYL piece without a named credentialed author + citations + a recorded credentialed-reviewer release.** Client "Approve" is captured as advisory sign-off; it does not release. The credentialed reviewer (D6) holds release. **Never let a YMYL false-negative through the gate:** a piece whose body carries medical-claim signals but `is_ymyl=false` is a hard block (`VETO_YMYL_MISCLASSIFIED`) — the misclassification cannot be used to bypass the YMYL byline/review/faithfulness vetoes.
4. **Never fall through to a default voice.** `requireApprovedVoiceSpec()` is a hard stop — no approved `voice_spec`, no generation. There is no fallback voice.
5. **Never skip the eval and publish.** A skipped / thrown / timed-out eval is treated as a block (`EVAL_DID_NOT_RUN`), never as a pass.
6. **Never leak across tenants or versions.** Every row is `workspace_id`/`client_id`-scoped with fail-closed RLS; the review token grants exactly one `(client, piece, version)` and widens nothing. Cross-tenant leakage is the agency-ending bug.
7. **Never ship a client-rendered body.** Full body must be in the initial server HTML; a CSR slip makes the content invisible to answer-engine crawlers and silently defeats the north-star KPI.
8. **Never leak an unresolved placeholder** (`[photo:…]` / `[cta:…]`) — strip at render, never emit literal token text — and never publish a generated asset without a recorded license/provenance record.

---

## 8 · Persona & behavior tuning

The SEO Creator has no single "assistant persona." The persona is **the client's brand voice, per tenant, sourced from data** — and the engine's own behavior is tuned to be a faithful, non-alarmist, E-E-A-T-disciplined ghostwriter for that brand. There is exactly one place voice can come from (the approved `voice_spec`) and zero fallbacks.

### Voice — per-client voice specs

Voice is data, not prompt-baked. Each client carries a `voice_specs` row (`VoiceSpecV1` JSONB): `tone[]`, register, audience, `bannedLexicon[]`, the `authors[]` registry, `attributionSources[]`, `pillarLinks`/`internalLinks`, and `samplePassages[]`. The spec feeds behavior on two distinct paths:

- **As gate input.** `bannedLexicon` *extends* the built-in AI-slop floor that `VETO_BANNED_LEXICON` checks; a brand-style-guide markdown rendered from the spec feeds the **LLM voice gate** (the `voice` Stage-B dimension, 3s timeout, ported scar). A draft that contradicts the brand voice trips `VETO_VOICE_FAIL`.
- **As generation context.** `samplePassages[]` and tone/register seed the writer prompt so the draft starts in-voice rather than being corrected into voice.

**The hard stop:** `requireApprovedVoiceSpec()` refuses generation for any client whose spec has `approved_at IS NULL`. There is **no default voice** — the canvas composer is disabled with an explicit reason. This is deliberate: a default voice is exactly how a multi-tenant content engine produces homogeneous slop and how one client's voice bleeds into another's. Voice-as-required-data is the anti-bleed boundary.

### Brand — the client's, never Sagemark's

Every rendered surface carries the *client's* brand: logo/asset references and palette live on `content_clients` + `voice_specs` (per-tenant). The Sagemark chrome (comment rail, version switcher, inspector) uses the `apps/agents` visual convention; the *content* the client and the public see is wholly the client's brand. The review link and the published hub are the client's content asset — Sagemark is invisible in the artifact.

### AI disclosure policy (YMYL)

For YMYL content (Whispering Willows is squarely YMYL — memory care), trust signals are **veto-enforced data, not free-floating prose**:

- **Provable byline.** `author_id` resolves server-side at publish from the `voice_specs.authors[]` registry (`{id, name, credentials}`). The publish path **never trusts a request-supplied author** (the inherited `origin/preview` hole); an uncredentialed or fabricated byline cannot ship. `VETO_YMYL_NO_BYLINE` blocks a YMYL piece lacking a named credentialed author.
- **Medical disclaimer + source-grounding.** Disclaimer text and source attribution ("every figure traces to a named authority" — Alzheimer's Association, NIA) are resolved into the body from voice-spec / brief-snapshot data, scored by the `eeat` dimension, and required for YMYL publish.
- **License / trust badge.** The DSHS license badge ("Deficiency-free 2025 Washington State DSHS annual inspection · License #2726") is structured data, not prose, and is treated as a fabrication risk if invented (Never-list #1).
- **Recorded human release.** `canPublish()` requires a recorded credentialed-reviewer release for YMYL — client approval is advisory only. The reviewer's credential feeds the "Reviewed by [Name, Credential]" accountability trail.

The on-page disclosure stance is honesty about provenance and authority: the byline, credentials, citations, and disclaimer are surfaced to the reader (and to the answer-engine crawler) as the E-E-A-T signal — and as the trust strip the operator can curate for a client presentation. What is *not* disclosed on the client/public surface is the raw gate scorecard (an internal trust signal — exposing the 8-dimension math invites arguing with the math instead of the prose).

### Persona / voice-drift regression — the golden set

Because the runtime is an autonomous loop **running the existing four-skill `seo-copywriter` suite directly** (the real `seo-strategist` / `seo-assistant` / `seo-blog-writer` / `seo-audit` `SKILL.md` skills, not re-authored prompts) against the host-enforced `/content/api/*` kernel routes, **the dominant silent-failure mode is methodology-fidelity / voice drift**: a model bump or a tool-order/skill-config change quietly producing lower-quality, off-voice content than the labeled baseline, invisible to CI. The mitigation is mechanical and non-optional:

- **Capture the live Whispering Willows hub as a human-labeled golden set in Phase 0, *before the suite is wired into the worker*** — all ~8 pieces + the homepage, with per-piece `cluster_role`, `funnel_stage`, expected dimension scores, and expected Stage-A clean/veto, committed under `apps/seo/golden/whispering-willows/`.
- **Regress every model/tool-order/skill-config change against the golden set.** Every change to a model id, the tool order, or a suite skill's configuration re-runs generation against the golden corpus and diffs the resulting dimension scores and voice-gate outcomes. A regression below the labeled baseline fails the change — this is the only guard against silent drift in a nondeterministic loop.
- **The golden set doubles as the voice anchor.** `samplePassages[]` in the voice spec and the golden corpus together define "in-voice for this client"; the `voice` dimension and `VETO_VOICE_FAIL` are calibrated against them, so "drift" is measurable, not a matter of taste.

*References: ch. 05 (bible v1.0.0, sha: 2c02fe80), ch. 17 (bible v1.0.0, sha: 2c02fe80)*

---

## 4 · Architecture

The one-line thesis the rest of this plan hangs on: **the model is the replaceable middle; the harness is the moat.** The deterministic engine — the 22 scorers, the cross-model faithfulness gate, the non-compensatory `seo-gate`, the fail-closed `lifecycle-fsm`, the per-tenant voice/byline boundary — is **ported verbatim from `flywheel-main` `origin/preview` (PRs #1668–1684) into `@sagemark/core`**, not reinvented. What is net-new in this plan is the *topology* the locked decisions force: an autonomous Claude Agent SDK worker (D5) on Vercel Sandbox (D9), a thin Vercel orchestration layer, and the streaming transport that joins them. Honor DECISIONS.md over the analysis docs 01/03 wherever they conflict — those docs recommended a native in-process AI SDK v6 loop, which D5 **overrode**.

### 4.0 The four-skill suite chain + the kernel route contract

The worker does **not** carry re-authored prompts. It **loads and runs the existing `seo-copywriter` suite directly** — four real `SKILL.md` skills in pipeline order, each consuming the prior stage's typed artifact:

1. **`seo-strategist` — Stage 0, a human-gated STRATEGY layer** (runs FIRST, upstream of the brief). It turns client + business goal + market into an operator-approved **`ContentStrategy`**: a topic-cluster map across the funnel, a competitive-gap + keyword/intent analysis (gap-first, not volume-first), an E-E-A-T / named-author plan, a GEO/AEO + schema plan, the conversion architecture, and a prioritized roadmap. Lightly kernel-backed (optional live-SERP gap scan). Each roadmap item then enters the chain at `seo-assistant`.
2. **`seo-assistant` — Stage 1 (Brief).** Drives the brief route — live SERP fetch, intent lock to the dominant SERP format, YMYL classify → a typed extended **`ContentBrief`** (`serpEvidence`, pillar/internal links, `dataPointsNeeded`, `isYmyl`, author/credentials).
3. **`seo-blog-writer` — Stage 2 (Draft).** Drives the draft route — render the per-client approved voice spec to a brand guide, grounded long-form generation (every stat traced to a supplied source or omitted), `[photo:]`/`[cta:]` placeholders, a structured FAQ block; persists a `content_pieces` row in `draft` status → **`ContentDraft`**.
4. **`seo-audit` — Stage 3 (Audit, the load-bearing one).** Drives the audit + publish routes — the two-stage `seo-gate` (Stage-A hard vetoes → Stage-B 8-dimension weighted composite), persist scorecard, advance the lifecycle FSM with a version snapshot before each forward move, fail-closed publish (PUBLISH verdict AND recorded human release AND eval-actually-ran; YMYL adds a named author + credentials + authoritative citations) → **`AuditResult`**.

**The typed handoff chain:** `ContentStrategy → ContentBrief → ContentDraft → AuditResult`. On a non-PUBLISH verdict the fixed failure codes feed back to `seo-blog-writer` for a revise loop **capped at 3 cycles** (the 4th force-routes to human review).

**Kernel-backed via a host-enforced route contract (critical).** Each skill **orchestrates the content kernel via HTTP routes — `/content/api/brief`, `/content/api/draft`, `/content/api/audit`, `/content/api/publish` — plus the `src/lib/content` kernel** (seo-gate, lifecycle-fsm, content-store). The skills do **not** re-implement the gate / scorers / FSM / persistence in markdown; that fork is an explicit anti-pattern ("the agentic path and the operator-console path must never fork"). These routes are verified to exist on the internal origin/preview branch (`apps/agents/src/app/content/api/{brief,draft,audit,publish}/route.ts`). Therefore the port **stands up that exact route contract in `apps/seo`** (the four content routes backed by the ported seo-gate / lifecycle-fsm / content-store / scorers), and the **worker's kernel-host base URL points at `apps/seo`** — the host-side tools the worker exposes to the agent *are* these content routes, which is how the gate stays host-enforced (the agent can reach publish only through the fail-closed audit/publish routes). **Kernel-host-unreachable is a hard, non-silent failure:** a kernel-backed step that cannot reach the host stops with a clear `kernel host unreachable` (naming route + base URL) and an explicit worker error state — never a fabricated brief/draft, never a skipped gate.

### 4.1 Runtime — split topology: thin Vercel layer + autonomous worker

The runtime splits in two across two deploy targets, joined by a streaming hop. This split is the direct consequence of D5: the `@anthropic-ai/claude-agent-sdk` spawns and supervises a `claude` CLI subprocess with a shell and an on-disk working directory — it is a long-lived, stateful, Node-only process that **cannot run inside a Vercel serverless function**. So the autonomous loop moves to its own host.

```
 CLIENT (three-zone canvas)        apps/seo  (Vercel — THIN)                Agent-SDK WORKER (Vercel Sandbox)        @sagemark/core (host-side, deterministic)
 ──────────────────────────        ───────────────────────────             ──────────────────────────────────      ─────────────────────────────────────────
 1. operator approves       ─POST─▶ /api/run                                                                          
    typed BRIEF                     │ auth → workspace → client RLS
                                    │ CostAccountant.reserve(pre-flight)
                                    │ provision/attach Sandbox microVM ──▶  ToolLoopAgent (SDK autonomous loop)
                                    │ hand off { brief, workspaceId,        │  self-directs: fetch→outline→draft
                                    │   clientId, runId }                   │  →verify→revise→gate
 2. ◀── SSE token deltas ───────────  relay SDK events as SSE ◀────emit───  │  KERNEL ROUTE CONTRACT (worker→host boundary,
    (live thinking + tool-use)      │  to three-zone canvas                 │  the four-skill suite orchestrates these):
                                    │                                       │   ├─ /content/api/brief  ─(serpFetch SSRF-guarded)─▶ brief.sources
                                    │                                       │   ├─ /content/api/draft  ─────────────────────────▶ content_pieces (draft)
                                    │                                       │   ├─ /content/api/audit  ─(RO gate)──▶ seo-gate Stage-A→B + 22 scorers
 3. ◀── artifact (markdown) ────────  │                                     │   └─ /content/api/publish ─(host-enforced canPublish)─▶ FSM transition
    rendered in CENTER editor       │                                       │                                          + content_piece_versions snapshot
 4. ◀── gate scorecard ─────────────  │  HOST enforces Stage-A veto +        (Sandbox FS is EPHEMERAL — never durable;
    Stage-A chips + Stage-B bars    │  canPublish() — never inside loop      all run state persists to Supabase via host tools)
```

**Three runtime facts that are now load-bearing:**

1. **D5 delivers D1 for free.** The autonomy decision (D1 = full autonomous `ToolLoopAgent`, self-directing fetch→outline→draft→verify→revise→gate) and the runtime decision (D5 = Claude Agent SDK worker) **consolidate**: the SDK's built-in agentic loop *is* the `ToolLoopAgent` D1 asked for. We no longer hand-build the loop — we get it, plus subagents, hooks, and context compaction, from the SDK. The cost is a second deploy target and the SDK's coding-agent-shaped defaults (a shell + filesystem workspace we do not strictly need for markdown). **Stated plainly: the SDK autonomous loop is simultaneously the single biggest scope-saver in the plan (it deletes the hand-built `ToolLoopAgent`) and the single biggest new risk surface (nondeterministic methodology drift, §4.4 / §14) — which is exactly why the golden-set regression is mandatory and the deterministic gate sits outside the loop.**
2. **The Sandbox is compute-only; Supabase is the system of record.** D9 picks Vercel Sandbox — ephemeral Firecracker microVMs, closest to the rest of the stack. **No per-run session/agent/working-dir state may live on the Sandbox filesystem across runs.** Every durable fact — the brief, the draft, every version snapshot, the scorecard, the cost ledger entry — is written back to Supabase through host tools during the run. A crashed or expired Sandbox must be fully reconstructable from Postgres alone. The latency-amortizing **warm pool** (RFC §7) does not soften this: a pooled VM holds **no tenant binding while idle**, and `/api/run` wipes its working dir + restarts the `claude` subprocess on lease handoff — so even a *reused* VM is, to the next tenant's run, indistinguishable from a fresh per-run Sandbox. "Per-run Sandbox" is the contract; the warm pool is a boot-latency optimization underneath it, never a shared-state surface.
3. **Streaming spans a hop.** The worker emits SDK events (thinking deltas, tool-use rows, article deltas); `apps/seo` relays them to the browser as Server-Sent Events into the three-zone canvas. This is the single most "harness-like" demo beat (the body types in live) and it is also the most fragile new surface — the worker→Vercel→browser SSE relay must survive a Fluid-window timeout, a Sandbox cold start, and a dropped connection without losing the run. On a `last_event_id` reconnect the relay **re-reads the persisted `content_pieces` (+ its persisted scorecard/verdict on the piece/version row) as the truth snapshot** (no separate `gate_results` table — DR-039) and resumes only the deltas after the cursor (the canonical artifact is the persisted row, never the stream). The worker→host bridge is authenticated by a **per-run JWT minted by `/api/run`**, scoped to exactly `(workspace_id, client_id, run_id)` and expiring at the run-budget ceiling (~90s) — so a leaked or stale token cannot cross runs or tenants. Plan and test this transport in Phase 1, on the thinnest end-to-end slice (the SSE-vs-poll call, RFC OQ-1, resolves here), before the surface widens.

The worker's loop **runs the existing `seo-copywriter` suite directly** — the four real `SKILL.md` skills (`seo-strategist` → `seo-assistant` → `seo-blog-writer` → `seo-audit`, from the in-repo vendored package `skills/seo-copywriter-skill-package/seo-copywriter/*` — per DR-022), loaded and run by the Agent-SDK worker, **not re-authored as prompts**. They are **kernel-backed**: each skill orchestrates the content kernel via the HTTP routes `/content/api/{brief,draft,audit,publish}` plus the `src/lib/content` kernel (seo-gate, lifecycle-fsm, content-store), and never re-implements the gate/scorers/FSM/persistence in markdown — "the agentic path and the operator-console path must never fork." The PORT is therefore not just lifting lib functions: `apps/seo` must **stand up that exact route contract** (`/content/api/{brief,draft,audit,publish}` backed by the ported seo-gate / lifecycle-fsm / content-store / scorers), and the worker's **kernel-host base URL points at `apps/seo`** — so the host-side tools the worker exposes to the agent *are* these content routes, which is exactly how the gate stays host-enforced (the agent can only reach publish through the fail-closed audit/publish routes). There is exactly one gate module behind those routes, never a drifted copy. **Kernel-host-unreachable is a hard, non-silent failure:** a kernel-backed step that cannot reach the host **STOPS** with a clear `kernel host unreachable` message (naming the route + base URL), never fabricates a brief/draft and never skips the gate — reflected as an explicit worker error state, not a degraded run. The model ids re-baseline off the stale `anthropic/claude-sonnet-4.5` to the trailhead-current ids: **`claude-sonnet-4-6` drafter / `claude-haiku-4-5` faithfulness verifier / `claude-opus-4-7` judge**, dropping `budget_tokens` on 4.6+/Opus. The drafter≠verifier invariant in the faithfulness gate is preserved — collapsing it turns the gate into a self-consistency check, which is worthless against confident-but-wrong YMYL claims.

*References: ch. 01 (bible v1.0.0, sha: 2c02fe80), ch. 06 (bible v1.0.0, sha: 2c02fe80), ch. 09 (bible v1.0.0, sha: 2c02fe80)*

### 4.2 The "App" / tenant abstraction

A platform, not a one-off site, needs a clean unit of multi-tenancy. The unit here is the **content client** (`content_clients`), and it is deliberately *not* the same thing as the agency's accounting `clients` table — overloading them would couple billing identity to publishing namespace and leak one into the other. A content client is the tenant root: it owns a public URL namespace (`blog_slug`, UNIQUE), an approved brand-voice corpus (`voice_specs`), an author registry, a cluster of content pieces, and their version history.

```
workspace  (the agency seat boundary — workspace_id)
 └─ content_client  (the tenant: name, blog_slug UNIQUE, workspace_id)
     ├─ voice_specs        (approved brand voice + author registry — the E-E-A-T boundary)
     ├─ content_pieces     (the artifact units — pillar + cluster of guides)
     │   └─ content_piece_versions  (immutable forward-move snapshots)
     ├─ review_comments    (client feedback: pins + section verbs)
     └─ share_of_model  (per-client citation / share-of-model telemetry)
```

Three properties make this a framework-to-platform abstraction rather than a single configurable site:

- **The engine is built once; the tenant data compounds per client.** The reusable template — the 22 scorers, the gate composer, the FSM, the cross-model faithfulness gate, the `/content/api/{brief,draft,audit,publish}` kernel routes the four-skill `seo-copywriter` suite orchestrates, the SSR render route, the net-new resource-library homepage template — is shared platform code in `@sagemark/core` and the `apps/seo` content routes + public SSR routes. Everything client-specific (the `content_clients` row, the `voice_specs` corpus, the pieces, the cluster map, the gate-threshold instance overrides) is per-tenant data. Adding a client is a data operation, never a code fork.
- **A client is self-describing.** Generation for a client is fully parameterized by its `voice_specs` (tone, banned lexicon, author registry, attribution sources, sample passages) plus its brief — there is no per-client branch in the engine. This is what lets the agency onboard the second, fifth, fiftieth client without touching the worker or the gate.
- **The namespace is a hard boundary, enforced at the data layer (§4.5), not by convention.** A `blog_slug` from one client can never resolve a piece under another client's namespace; the render route 404s rather than crossing the boundary.

*References: ch. 14 (bible v1.0.0, sha: 2c02fe80)*

### 4.3 Action-tier classification

Every capability the worker can invoke is classified by tier, and the gate/permission posture is set per tier. The principle (ch. 15): the agent gets **read-only** access to anything that grades it, **host-validated** access to reversible writes, and **no autonomous path at all** to the external public web — publish is a human-gated, host-enforced transition the agent cannot reach.

| Tier | Class | Examples (worker tools) | Reversible? | Gate / permission posture | In v1? |
|---|---|---|---|---|---|
| **Tier 1** | Read / observe | `serpFetch` (DDG, SSRF-guarded), `runScorers` (RO), `runGate` (RO), read voice spec, read prior versions | n/a (no state change) | Allowed freely inside the loop. Fetched web content is **untrusted** — treated as data, never as instructions (prompt-injection discipline). The gate tools are read-only: the agent sees scores but cannot mutate thresholds or verdicts. | ✅ |
| **Tier 2** | Reversible write (draft / version) | `persistPiece` (draft upsert), append `content_piece_versions` snapshot, write `brief_snapshot` | Yes — every write is an immutable, append-only version; nothing is destroyed | Host-validated: tenancy keys (`workspace_id`/`client_id`) injected host-side and never seen by the agent; SHA-256 stale-edit guard (409), per-tenant rate limit (429), workspace-ownership check (403). Edits legal only while `status='draft'`. | ✅ |
| **Tier 3** | External / public-web mutation | **publish to the public web** (`status → 'published'`, render at `/clients/[client]/blog/[slug]`) | Reversible (unpublish reverts render), but **externally observable** — crawlers and AI engines may cite it | **The agent has NO tool for this.** Publish is a host-only transition behind `canPublish()` — the canonical predicate is defined once in §9.1. The kill switch lives here. | ✅ (human-gated only) |
| **Tier 4** | Irreversible / destructive | hard-delete a client or piece; mutate another tenant's data; spend past the cost cap | No | **None — not built in v1.** Deletes are out of scope; the `CostAccountant` fail-closed-aborts before spend exceeds the per-run ceiling. | ❌ |

The classification is enforced structurally, not by prompt instruction: a Tier-3 action simply has no corresponding tool in the worker's tool registry, so the autonomous loop can produce a *perfect, eligible* draft and still have no path to publish it. That gap between "eligible" and "published" is the whole point.

*References: ch. 15 (bible v1.0.0, sha: 2c02fe80)*

### 4.4 The judge / gate — host-enforced, non-compensatory, outside the loop

The gate is the moat made mechanical. It is **host code outside the agent loop** (D2). The agent gets a read-only `runGate` tool so it can *see* its score and self-revise; it can never reason past a veto or talk past `canPublish()`. This is the non-negotiable invariant of the whole design: if the vetoes lived inside the LLM loop, a persuasive fine-tune instruction ("just drop the disclaimer") could argue its way past a YMYL or faithfulness veto. They live in host code precisely so it cannot.

The gate runs in two **strictly ordered** stages. Stage-A is non-compensatory: the first veto short-circuits, sets `eval_score = null`, and **Stage-B is never computed**. A high Stage-B composite can never rescue a Stage-A failure — that is the difference between this and every competitor's compensatory 0–100 score (Surfer's Content Score, which we explicitly AVOID because a green composite buys past a hard fault and drives keyword-stuffing).

**Stage A — the draft-eligibility gate, ordered hard vetoes (first hit wins, `score=null`).** This gate runs at the `draft→review` edge and decides whether a draft is *eligible to enter review*. It checks source/faithfulness, byline *presence*, thin-content, and voice defects ONLY — it deliberately does **not** require a recorded review, because requiring a review to enter review would be circular (a YMYL piece could never reach the reviewer who releases it). The credentialed-reviewer release is enforced separately, on the `review→approved` edge, by `canPublish()` (§9.1) — never as a Stage-A veto.

1. `VETO_BROKEN_CHUNK` — unrenderable / information-island chunk
2. `VETO_UNSOURCED_STAT` — faithfulness `UNFAITHFUL`, or any `UNSOURCED`/`CONTRADICTED` claim. **For a YMYL piece, a *skipped* faithfulness gate is itself a hard block** — you cannot publish a memory-care claim you could not verify.
3. `VETO_KEYWORD_STUFF` — keyword density `status='stuffed'`
4. `VETO_YMYL_MISCLASSIFIED` — the body carries medical-claim signals (the auditable `ymylSignals` detector fires) but `is_ymyl=false`. A YMYL **false-negative is itself a hard block** — the gap *inside* the gate: if a misclassified piece slipped through, the byline/faithfulness YMYL vetoes below would never run. The piece is forced back to `review` for `is_ymyl` re-confirmation; it cannot be dodged by clearing the flag.
5. `VETO_YMYL_NO_BYLINE` — YMYL piece without a named, credentialed author *present* (byline-presence check; the reviewer-release check is on `review→approved`, not here)
6. `VETO_THIN_CONTENT` — originality / content-density at the floor (≤20)
7. `VETO_BANNED_LEXICON` — AI-slop or client banned terms
8. `VETO_VOICE_FAIL` — brand-voice contradiction
9. `VETO_EVAL_FAILED` — any deterministic scorer threw (fail-closed)

There is **no** Stage-A veto that requires a recorded review (no `VETO_YMYL_NO_REVIEW`): the credentialed-reviewer release is a `canPublish()` precondition on `review→approved` (§9.1), and any final pre-publish check that wants to *re-confirm* release is a distinct publish-precondition check that runs AFTER release evidence exists — never a draft-eligibility veto.

**Stage B — only if Stage A is clean.** An 8-dimension weighted 0–100 composite → `PUBLISH ≥85 / REVIEW 70–84 / REVISE 50–69 / REJECT <50`. Weights sum to exactly 1.0 with **faithfulness strictly heaviest (0.20)** — the confident-but-wrong / CNET failure is the costliest harm, so it carries the most weight.

| Dimension | Weight | Scores |
|---|---|---|
| **faithfulness** | **0.20** | every claim traces to a `brief.sources` entry (cross-model: sonnet drafter vs haiku verifier) |
| voice | 0.15 | adherence to the approved voice spec |
| geo | 0.15 | answer-first capsules, quotable fact sentences, self-contained FAQ answers |
| readability | 0.10 | Flesch-Kincaid grade control |
| keyword | 0.10 | density without stuffing |
| structure | 0.10 | headings, lists, internal links |
| originality | 0.10 | unique data / non-duplicate |
| eeat | 0.10 | byline, credentials, disclaimer, trust signals |

`canPublish()` (in `lifecycle-fsm.ts`) is the final, separate host check on the `approved→published` edge — **its full predicate is defined once, canonically, in §9.1** (kill-switch ON ∧ `verdict==='PUBLISH'` ∧ `evalRan` ∧ recorded human release ∧ (YMYL ⇒ named credentialed author + citations)). The part that matters here at the gate: a skipped, thrown, or timed-out eval makes `evalRan===false` and therefore **blocks** (this fixes the inherited fail-open non-fatal-publish bug, the ER-4 class). Rejections return stable machine codes (`ILLEGAL_EDGE`, `EVAL_DID_NOT_RUN`, `NO_HUMAN_RELEASE`, `YMYL_NO_BYLINE`), never prose the agent can negotiate with.

Because D1 makes the loop autonomous and nondeterministic, the gate alone is not enough to guard against silent methodology drift. The **golden-set discipline is mandatory, not optional**: capture the live Whispering Willows hub as a human-labeled golden set *before* a single prompt is written, and regress every prompt/model/tool-order change against it. The `opus-4-7` judge and the repurposed `judge-prompt.md` domain checks are the runtime acceptance-test spec.

**Gate adjudication — the gate can be wrong, and that is governed too.** Several Stage-A/heuristic vetoes are themselves fallible: `VETO_VOICE_FAIL`, the faithfulness verdict, `VETO_YMYL_MISCLASSIFIED`, and `VETO_THIN_CONTENT` can false-positive (block a sound piece) or false-negative (pass a bad one). The response is a **gate-adjudication protocol**, not a softer gate:

- **A human override is still non-publish unless the underlying evidence is fixed.** An operator who believes a veto is wrong can *dispute* it, but disputing does not flip the verdict: the piece does not publish until the evidence the gate keys on is actually corrected (e.g. a real authoritative citation is added, the byline is genuinely credentialed). There is **no "override and publish anyway" path** — that would re-open exactly the compensatory hole the wedge exists to close. The override is a labeled disagreement, not a bypass.
- **Disputes are logged and labeled.** Each disputed gate result is recorded with the veto code, the operator's claimed correct outcome, and the eventual resolution — building the labeled corpus the false-positive/false-negative metrics (§9.5) and the golden set are calibrated against.
- **False-positive / false-negative rates are tracked per veto code.** §9.5 carries an FP/FN metric per Stage-A code so a detector that is systematically too aggressive or too lax is *visible* rather than a matter of operator anecdote — calibration drift is measured, like methodology drift.
- **Changes to medical/YMYL detectors are release-blocking reviewed.** Any change to the `ymylSignals` detector, the faithfulness check, or the YMYL byline/review vetoes is a release-blocking review (not a quiet config tweak) and re-regresses against the golden set before shipping — these are the detectors a false-negative on which is catastrophic, so they get the highest change-control bar.

*References: ch. 15 (bible v1.0.0, sha: 2c02fe80), ch. 17 (bible v1.0.0, sha: 2c02fe80)*

### 4.5 Multi-tenancy from day one

Cross-tenant leakage / voice bleed is the **#1 agency-ending risk** — a memory-care guide published under the wrong client's byline, or one client's brand voice bleeding into another's content, is unrecoverable reputationally. Tenancy is therefore a **fail-closed boundary at the data layer**, enforced by Postgres RLS, not by application convention. This is built in from day one (Phase 1), never retrofitted.

Every content row is scoped by `workspace_id` + `client_id`. The RLS posture, ported from the `origin/preview` migration:

- **The only anon policy is `content_pieces_public_read`:** `FOR SELECT TO anon USING (status = 'published')`. Anonymous (public-web / crawler) reads see published pieces and nothing else.
- **`voice_specs`, `content_piece_versions`, `review_comments`, and the cost/metrics tables have NO anon policy at all** — drafts, scorecards, brand voice, author credentials, feedback, and spend are never publicly readable.
- **Operator queries run service-role and explicitly scope by `workspace_id`/`client_id`.** The worker's host tools (§4.3 Tier 1/2) have these keys injected host-side from the run context and **never expose them to the agent**, so the model has no token it could leak or mis-target.
- **The render route resolves `<client>` → `content_clients.blog_slug` → `client_id` and a slug from another client resolves to `null` → 404** — a piece can never render under the wrong namespace.
- **The client-review surface is a tokenized route scoped to exactly one piece/version** (D8), with the same fail-closed RLS — no credits, no Improve-Draft, no raw markdown, no access to siblings.

The default is *deny*: a missing or mismatched tenancy key returns nothing, never the whole table. `voice_specs.approved_at IS NULL` is itself a hard stop (`requireApprovedVoiceSpec()`) — **no approved spec ⇒ no generation, with no default-voice fallback** — which closes the most likely accidental-bleed path (a new client generating against a stale or shared voice).

*References: ch. 14 (bible v1.0.0, sha: 2c02fe80)*

### 4.9 Memory model

The worker is stateless across runs (the Sandbox is ephemeral, §4.1); all durable memory lives in Supabase. There is no cross-tenant memory of any kind — the per-client voice corpus is the only "learned" memory, and it is scoped, approved, and human-curated, never silently accreted from generations.

| Scope | What's stored | Boundary | TTL / lifecycle |
|---|---|---|---|
| **Run / session** | active brief, in-flight draft, the agent's thinking + tool-use ledger for one generation | one `runId`, one `client_id`; lives on the Sandbox FS only for the run's duration | **Ephemeral** — torn down with the microVM. Anything durable is flushed to `content_pieces` / `content_piece_versions` *during* the run, so a crash loses no committed state. |
| **Piece** | current `body`, `dimensions` scorecard, `verdict`, `brief_snapshot`, `is_ymyl`, `author_id` | one `content_pieces` row, scoped `workspace_id`/`client_id` | Lives until archived; mutable only while `status='draft'`. |
| **Version history** | immutable `{body, dimensions, verdict, snapshot_at}` per forward FSM move | one `content_piece_versions` row chain per piece, `client_id` denormalized | **Permanent / append-only** — written before every forward move; never deleted (audit trail + reversibility). |
| **Client voice corpus** | `voice_specs.spec` jsonb: tone, banned lexicon, `authors[]` registry, attribution sources, sample passages, pillar/internal links | one `voice_specs` row per `client_id`; **no cross-client read, ever** | Long-lived; versioned by `approved_at`. A draft (`approved_at IS NULL`) is unusable until human-approved. |
| **Cost ledger** | per-run AI-Gateway spend, reserved + actual, per `client_id` | `seo_cost_ledger`, scoped per tenant; separate SEO ledger (D4) | Permanent — the margin input; never expires. |
| **Share-of-model telemetry** | AI-answer-engine citation / share-of-model observations per client/piece | `share_of_model`, scoped per `client_id` | Long-lived time series — the north-star KPI. |

The cardinal rule: **the voice corpus is the only memory that shapes generation, and it is per-client, human-approved, and fail-closed-scoped.** The agent never carries memory from one client's run into another's. The Sandbox holds nothing of value past a run; Postgres holds everything that matters.

*References: ch. 04 (bible v1.0.0, sha: 2c02fe80)*

---

## 6 · Knowledge architecture

Generation is grounded by two distinct knowledge sources, and the quality of the first is the binding throughput constraint on the whole engine.

**1. The grounding brief (`brief.sources`) — D3 free DuckDuckGo scraping.** The intake act opens with a **live SERP fetch**: the `serpFetch` host tool scrapes 3 DuckDuckGo HTML result pages (first ~2,000 chars each) behind the existing `brief.sources` contract. Intent is *observed* from this fetch, not asserted from the query string. The scraped sources populate `brief.sources`, which is the **grounding contract the faithfulness gate verifies against** — every figure and claim in the draft must trace to a named source in that set, cross-checked by the haiku verifier against the sonnet drafter. Fetched web content is treated as **untrusted input**: SSRF-guarded at fetch time, and never interpreted as instructions to the agent (prompt-injection from a fetched page is the ingestion-surface risk, covered despite the artifact being private-by-default).

**Source-quality policy (YMYL source TRUST, distinct from SSRF source SAFETY).** SSRF guards *where* a fetch may go; it says nothing about whether a source is *trustworthy enough to ground a memory-care medical claim*. A passing SSRF check on a random DDG snippet does not make that snippet an acceptable authority — and the whole wedge is that the engine refuses to publish what it cannot credibly source. So `brief.sources` carries a per-source quality layer, fail-closed for YMYL:

- **Three authority CLASSES, not one allowlist — and they ground different claim types.** Sources are classified into three distinct classes, and the class determines what a source is *allowed to ground*:
  - **(a) Medical/statistical authority** — the Alzheimer's Association, NIA/NIH, CDC, recognized medical nonprofits, and `.gov`/`.edu` medical/statistical domains. **Required** to ground any medical or statistical YMYL claim.
  - **(b) Client-fact authority** — the client's own facts: license numbers, services offered, facility/operational facts, sourced from the client's curated `voice_specs.attributionSources[]`. May ground **client-specific facts only** (e.g. "License #2726," "offers respite care").
  - **(c) Low-authority web** — an arbitrary scraped page; grounds nothing on a YMYL piece by itself.
- **A client `attributionSources[]` entry CANNOT, by itself, satisfy medical/statistical YMYL sourcing.** A client-fact-authority source grounds client-specific claims; it does **not** make a memory-care medical/statistical claim sourced — *unless* that specific entry has been explicitly classified **and approved** as a class-(a) medical authority (an explicit operator action, not the default). The common failure this closes: a client adding its own marketing page or a vendor blog to `attributionSources[]` and that page then "grounding" a dementia-prevalence statistic. It cannot — only a class-(a) authority can.
- **Canonical-URL + source-metadata capture (incl. authority class).** Each source records its canonical URL, domain, fetched-at timestamp, and its **authority class** (medical/statistical-authority / client-fact-authority / low-authority-unknown). The metadata travels with `brief.sources` so the gate (and an auditor) can see *what class of source* grounded each claim, not just that some text existed.
- **Minimum-authority threshold for medical/statistical claims = a class-(a) source.** A medical or numeric claim requires at least one **class-(a) medical/statistical authority**; a figure traceable only to a class-(b) client-fact source or a class-(c) low-authority/unknown snippet is treated as **unsourced** for gate purposes — it cannot satisfy `VETO_UNSOURCED_STAT` even though the string technically appears in a fetched page or in the client's `attributionSources[]`.
- **robots/ToS compliance + duplicate/spam filtering.** The fetch honors `robots.txt`/ToS for scraped pages, and near-duplicate or content-farm/spam snippets are filtered out of `brief.sources` so a claim cannot be "corroborated" by three copies of the same low-quality page.

This is the **trust** half of the ingestion surface; §11.2 is the **safety** half. Together they mean a claim is grounded only when its source is both reachable-safely *and* authoritative-enough — and a low-quality scraped DDG snippet, by itself, can never clear the YMYL sourcing bar.

**2. Per-client voice specs — the brand-grounding corpus.** Each client's approved `voice_specs.spec` supplies the second knowledge layer: tone and register, the banned-lexicon extension (which feeds the `VETO_BANNED_LEXICON` veto on top of the built-in AI-slop floor), the `authors[]` credential registry (the E-E-A-T byline source), attribution sources, sample passages (the voice exemplar fed to the LLM voice gate), and the pillar/internal-link map (so a spoke is never an orphan by construction). This is the "AirOps Brand Kit" pattern we STEAL — per-tenant brand grounding — with the gate AirOps lacks bolted on top. `approved_at IS NULL` is a hard stop: no approved corpus, no generation.

**The D2×D3 grounding tension — instrumented, measured, reversible.** This is the binding tension on the record. The hard faithfulness gate and the `UNSOURCED_STAT` veto are only as good as `brief.sources` — and 3 DDG pages × ~2,000 chars is *thin* grounding for memory-care medical claims that the artifact promises to trace to named authorities (Alzheimer's Association, NIA). Combined, D2 and D3 mean **the engine will frequently veto or revise its own YMYL drafts** — the gate doing its job correctly, but grounding (not the model) becoming the throughput bottleneck. This is exactly the thin-content posture that got the AI content farms deindexed post-Helpful-Content — which is *why* it must be measured rather than assumed safe.

The mitigation is built into Phase 1: **instrument the share of gate-blocks attributable to sourcing** — the count of `UNSOURCED_STAT` vetoes plus low-faithfulness Stage-B scores traceable to thin sources, as a fraction of all gate blocks. This metric is the **D3 reversal trigger**: if sourcing is the top blocker after the first cluster, D3 flips from "keep free DDG scraping" to "fund a SERP / retrieval API." Engineering wires either source **behind the same `brief.sources` contract**, so the reversal is a config change, not a rewrite — D3 is a *measured, reversible* call, not a permanent one. The reversal decision is an owned open question (James, tech-spike, after the first cluster).

*References: ch. 04 (bible v1.0.0, sha: 2c02fe80), ch. 02 (bible v1.0.0, sha: 2c02fe80)*

---

## 10 · Data model

System of record is **Supabase Postgres**, mirroring the `origin/preview` Drizzle schema with the D7 additive columns — *not* the shipped wizard's `localStorage` (cap 50), whose cross-tenant leakage is the flagged agency-ending bug. The artifact **unit** is a `content_piece`; the **deliverable** is a cluster of pieces forming a hub. Every row is scoped by `workspace_id` + `client_id` under fail-closed RLS (§4.5).

| Table | Purpose | Owner | RLS | PII? | Retention |
|---|---|---|---|---|---|
| **`content_clients`** | Tenant root: the content client (≠ accounting `clients`). Holds `name`, `blog_slug` (UNIQUE, the public URL namespace), `workspace_id`. | Operator / agency | Service-role scoped by `workspace_id`; **no anon policy**. | No (org metadata) | Indefinite (tenant lifetime). |
| **`content_pieces`** | The artifact unit. Cols incl. `id`, `client_id` FK (ON DELETE RESTRICT), `slug` (UNIQUE per client), `title`, `body` (markdown), `excerpt`, `meta_description`, `status` (draft·review·approved·published·archived), `version`, `is_ymyl`, `author_id`, `eval_score` (null on Stage-A veto), `verdict`, `dimensions` jsonb, `faq_data` jsonb, `brief_snapshot` jsonb, `published_at`, **`cluster_role`** (pillar·cornerstone·spoke·faq·checklist), **`funnel_stage`** (awareness·consideration·decision·retention). | Agent (host-validated write) + operator | Anon `SELECT` **only** `status='published'` (`content_pieces_public_read`); operators service-role scoped by `client_id`. | No (published marketing content; bylines are professional identities, not private PII) | Indefinite; archived rows retained, never hard-deleted in v1. |
| **`content_piece_versions`** | Immutable forward-move history. `{piece_id, client_id, version, body, dimensions, verdict, snapshot_at}`. Written **before every forward FSM move** (draft→review, review→approved, approved→published). | Host (append-only) | **No anon policy**; service-role scoped by `client_id` (denormalized for a future tenant-RLS path). | No | **Permanent / append-only** (audit trail + reversibility). |
| **`voice_specs`** | Per-client approved brand voice + author registry. `spec` jsonb (`tone[]`, `bannedLexicon[]`, `authors[]`={id,name,credentials}, `attributionSources[]`, `samplePassages[]`, pillar/internal links), `approved_at` (NULL = draft = hard stop). | Operator (human-approved) | **No anon policy** — brand voice & credentials never publicly readable. | **Yes — author names + professional credentials** (the E-E-A-T byline registry). | Long-lived; versioned by `approved_at`. |
| **`gate_results` / scores** | The materialized gate outcome per piece/version: Stage-A veto code (or null), Stage-B 8-dim `dimensions` scorecard, composite `eval_score`, `verdict`, `evalRan` flag. **In v1 these are persisted ON the `content_pieces` / `content_piece_versions` rows — there is NO separate `gate_results` audit table** ([[DR-039]], reconciled to shipped reality per audit-005). The D3 gate-block-by-sourcing metric is computed from existing gate-result data through the data-access seam (`getGateResult` → `PersistedGateResult.sourcingBlocked`); **revisit if a queryable cross-run audit row becomes required.** | Host (gate is host code) | **No anon policy** (lives on the piece/version rows); service-role scoped by `client_id`. | No | Retained with the version chain (audit). |
| **`review_comments` (comments / threads)** | Client feedback on the tokenized review surface: pin threads + section verbs. `{id, piece_id, version, client_id, anchor (normalized 0..1 + elementHint), body, author, status (open·resolved), kind (pin·section-approve·request-changes)}`. A "request-changes" comment routes into `/api/edit`. | Client (reviewer) + operator | **No anon policy**; tokenized route scoped to exactly one piece/version; service-role otherwise. | **Yes — reviewer/commenter identity** | Retained for the piece's life (feedback audit). |
| **`client_signoffs`** | **Advisory** client/agency-contact approval — resolves a comment thread / records client intent, but **never** a release. `{id, piece_id, version, client_id, release_type='client_signoff', actor_id (client/agency contact), release_scope (piece·section), released_at}`. Carries **no `credential` and no `authorization_id`** — structurally cannot satisfy `canPublish()` nor populate a byline. | Client / agency contact | **No anon policy**; service-role scoped by `client_id`. | **Yes — client/agency-contact identity** | Retained for the piece's life (approval audit). |
| **`credentialed_releases`** | The **only** record that satisfies `canPublish()`'s human-release precondition (D6 credentialed reviewer). `{id, piece_id, version, client_id, release_type='credentialed_release', actor_id (reviewer), credential jsonb (snapshot of {name, credentials} at release — the "Reviewed by [Name, Credential]" byline evidence), authorization_id (FK → `byline_authorizations`), release_scope, released_at}`. UNIQUE(`piece_id`,`version`). `canPublish()` reads this table as the source of truth; a `client_signoff` can NEVER substitute. | Credentialed reviewer (D6, server-recorded) | **No anon policy**; service-role scoped by `client_id`. | **Yes — reviewer name + credential** | **Permanent / append-only** (release accountability + byline evidence). |
| **`byline_authorizations`** | The first-class consent/authorization record that backs every published byline (§11.5): a clinician/author is only attachable to a piece while an **active** authorization exists. `{id, client_id, author_id (→ `voice_specs.authors[]` entry), credential jsonb (snapshot of {name, credentials} at grant), scope (e.g. client·cluster·piece), granted_at, expires_at (nullable), revoked_at (nullable), authorized_by (operator)}`. `credentialed_releases.authorization_id` is an FK against this table; a release whose authorization is missing, revoked, or expired is rejected (and thus publish is blocked). | Operator (authorization workflow) | **No anon policy**; service-role scoped by `client_id`. | **Yes — author name + credential** | **Permanent / append-only** (consent + authorization audit; a revocation is a new state, never a delete). |
| **`seo_cost_ledger`** | Separate SEO AI-Gateway spend ledger (D4): per-(run,stage) reserved + actual USD (+ `latency_ms`, `model`), per `client_id`/`runId`. The margin input; the `CostAccountant` fail-closed-aborts at the per-run ceiling. | Host (`CostAccountant`) | **No anon policy**; service-role scoped by `client_id`. | No (usage/cost metadata) | **Permanent** (margin + cost-per-asset analysis, incl. reviewer time). |
| **`seo_cost_run_budget`** | The **per-run accumulator / conditional-UPDATE lock-row** that enforces the cap atomically (one row per `runId`: `cap_usd`, `reserved_usd`). `reserved_usd` is incremented under the DB row lock with the `reserved_usd + cost <= cap_usd` guard, so a concurrent over-cap reservation is rejected by the predicate (no sum-then-check race). **This is what makes the cost-cap atomicity guarantee runnable on the live schema**, not just the in-memory `CostAccountant`. (Shipped in the `0039` migration per audit-005.) | Host (`CostAccountant` / reservation SQL) | **No anon policy**; service-role scoped by `client_id`. | No (usage/cost metadata) | Permanent (per-run cap audit). |
| **`share_of_model`** | The north-star KPI: AI-answer-engine citation / share-of-model observations per client/piece across engines (ChatGPT/Claude/Gemini — DR-038, reconciled to shipped reality per audit-005; Perplexity = deferred 4th). The GEO-tracker pattern we STEAL as a downstream measure. | Host / ingest job | **No anon policy**; service-role scoped by `client_id`. | No (aggregate telemetry) | **Long-lived time series** (the outcome metric). |

**Schema notes:**

- **`cluster_role` and `funnel_stage` are first-class, indexed columns (D7), not `brief_snapshot` jsonb.** *Rationale:* the deliverable is a hub, and the generated resource-library homepage (D7, Phase 1 migration) plus the related-guides nav need a *queryable* pillar↔spoke edge and funnel stage. You cannot drive a homepage template or a sibling-guides rail off a value buried in an unindexed jsonb blob. This is the single schema change the artifact model forces on the ported engine, and DECISIONS.md makes it a **Phase-1 migration, not a Phase-3 deferral.**
- **Byline resolves server-side from `content_pieces.author_id` → `voice_specs.authors[]` at publish** — never from a request body. The `origin/preview` publish path trusts `request.author`, a YMYL credential hole through which an uncredentialed byline could ship memory-care content; resolving from persisted data at publish closes it.
- **`voice_specs.approved_at IS NULL` is a hard stop** at generation time — no approved spec ⇒ no generation, no default-voice fallback — which is simultaneously the E-E-A-T boundary and the anti-bleed boundary.
- **PII posture (regulated=false, `sensitive_pii=no`):** the only personal data is *professional* identity — author names and credentials in `voice_specs`, and commenter/reviewer identity in `review_comments`. Both sit behind no-anon-policy RLS. End families / prospective residents never appear as data subjects; the artifact is published marketing content, and the private surfaces (drafts, voice, comments, cost) are never publicly readable.

*References: ch. 03 (bible v1.0.0, sha: 2c02fe80), ch. 04 (bible v1.0.0, sha: 2c02fe80), ch. 14 (bible v1.0.0, sha: 2c02fe80)*

---

## 9 · Lifecycle & operations

The artifact's spine is a **fail-closed lifecycle FSM** ported verbatim from `lifecycle-fsm.ts` (origin/preview). The autonomous Agent-SDK loop (D5) — running the existing four-skill `seo-copywriter` suite directly — authors and revises pieces, but the loop never owns the state transitions: the FSM and `canPublish()` run **host-side, behind the `/content/api/{audit,publish}` routes the `seo-audit` skill orchestrates, as tools the agent calls into and cannot reason past** (D1 does not soften D2). The suite advances along the **typed handoff chain** `ContentStrategy → ContentBrief → ContentDraft → AuditResult` (one stage per skill); on a non-PUBLISH `AuditResult` verdict the fixed failure codes feed back from `seo-audit` to `seo-blog-writer` for a **revise loop capped at 3 cycles** (the 4th force-routes to human review — the `forcedToHumanReview` hold-state below). Because the Vercel Sandbox worker (D9) is ephemeral, every state transition is a write to Supabase (system of record), never a fact held in worker memory or on the Sandbox filesystem. State is reconstructed on each run from Supabase; the Sandbox is compute-only.

### 9.1 The lifecycle FSM

The piece moves through five states with exactly one terminal sink:

```
draft ─→ review ─→ approved ─→ published ─→ archived
  ↑         │           │            │
  └─revise──┘      (unpublish reverts the render)     archived = terminal
```

Transitions are pure (`lifecycle-fsm.ts`, no I/O, exhaustively unit-tested) and every forward move is **snapshot-gated**: `requiresSnapshot()` enumerates the three edges (`draft→review`, `review→approved`, `approved→published`) that must write an immutable `content_piece_versions` row *before* the move commits. A move with no preceding snapshot is an `ILLEGAL_EDGE` reject. Rejections return **stable machine codes, never prose** — `ILLEGAL_EDGE`, `EVAL_DID_NOT_RUN`, `NO_HUMAN_RELEASE`, `YMYL_NO_BYLINE` — so the worker, the orchestration API, and CI all branch on the same enum.

**Who triggers each edge (actor-per-edge).** The transitions are not all the same kind of act — the load-bearing distinction is that the client's on-screen Approve is *advisory* and never performs `review→approved`:

| Edge | Actor | What it is |
|---|---|---|
| `draft→review` | **operator** (or the agent at the N=3 revise cap → `forcedToHumanReview`) | submit a gated draft for release review; the gate runs at this boundary |
| `review→approved` | **the credentialed reviewer** (D6, server-recorded release) — **NOT the client** | the human release that `canPublish()` requires; for YMYL it must be the credentialed reviewer |
| `approved→published` | **host** (orchestration API, after `canPublish()` returns true) | the public transition; the agent has no tool for it |
| `revise` (`review→draft`) | operator/agent | send back for a bounded fine-tune turn; capped at N=3 |
| `*→archived` | operator/host | retire or unpublish (the kill-switch path) |

The client's section-level Approve on the review surface (doc 04) is captured as a row in the **`client_signoffs` table — advisory only** — a separate persisted record from the reviewer's `credentialed_releases` row (§10), with its own actor, permissions, timestamp, and UI label, and carrying **no `credential` and no `authorization_id`**. It records client intent and resolves a comment thread, but it does **not** perform `review→approved`, cannot release a YMYL piece, and can **never** supply reviewer credentials or populate the byline. Release authority on YMYL sits with the credentialed reviewer's `credentialed_releases` row — the only record `canPublish()` reads as its human-release source of truth, and the only source of the "Reviewed by [Name, Credential]" byline (resolved server-side from that row's `credential` snapshot + `authorization_id` evidence).

**The publish predicate is the whole product compressed into one boolean** — and this table is its **canonical definition** (§4.3, §4.4, and the §5 capability row all defer here). `canPublish()` permits the `approved→published` edge **only** when every one of these holds:

| Precondition | Source of truth | Failure code |
|---|---|---|
| Publish kill-switch is ON | `workspace`/global feature-flag (§9.2) | `PUBLISH_DISABLED` |
| `verdict === 'PUBLISH'` | `seo-gate` Stage-B composite ≥ 85 with a clean Stage A | `VERDICT_NOT_PUBLISH` |
| `evalRan === true` | gate execution receipt; a skipped/thrown/timed-out eval is `false` | `EVAL_DID_NOT_RUN` |
| A recorded human release exists (a `credentialed_releases` row, not a `client_signoffs` row) | the `credentialed_releases` table (§10) — the persisted source of truth `canPublish()` reads, carrying `actor_id` + `credential` snapshot + `authorization_id`; for YMYL it must be the credentialed reviewer's `credentialed_release`, and a `client_signoffs` row never satisfies this | `NO_HUMAN_RELEASE` |
| **(YMYL only)** named author + credentials + ≥1 citation | `author_id` → voice-spec `authors[]` registry, resolved **server-side** | `YMYL_NO_BYLINE` |

These are **AND-ed, non-compensatory** — a perfect Stage-B score makes a draft *eligible*, not *published*. The eval-ran clause is load-bearing: a skipped or crashed eval **blocks** rather than waves through (this is the explicit fix for a known fail-open non-fatal-publish bug (the ER-4 class), where a thrown eval defaulted to publish). There is no autopilot edge to `published`; the human release is a distinct, recorded act, not a side effect of a green gate.

**Stage-A vetoes short-circuit before Stage B is ever computed.** When the gate runs (at the `review` boundary, host-side), the first Stage-A veto sets `eval_score = null`, records the veto code, and the 8-dimension composite is never calculated — so a vetoed piece cannot accumulate a misleading partial score. The veto order is fixed canon: `VETO_BROKEN_CHUNK` → `VETO_UNSOURCED_STAT` → `VETO_KEYWORD_STUFF` → `VETO_YMYL_MISCLASSIFIED` → `VETO_YMYL_NO_BYLINE` → `VETO_THIN_CONTENT` → `VETO_BANNED_LEXICON` → `VETO_VOICE_FAIL` → `VETO_EVAL_FAILED` (the `MISCLASSIFIED` check is net-new on top of the ported set — it guards the YMYL false-negative gap so the YMYL vetoes below cannot be dodged by clearing `is_ymyl`). **This draft-eligibility gate runs at `draft→review` and does NOT include a `VETO_YMYL_NO_REVIEW`** — requiring a recorded review to *enter* review would be circular. The credentialed-reviewer release is enforced separately, on `review→approved`, as the `NO_HUMAN_RELEASE` precondition of `canPublish()` (the table above). For a YMYL piece a *skipped* faithfulness check is itself `VETO_UNSOURCED_STAT` — you cannot publish a memory-care claim you could not verify.

**Autonomous-loop containment.** The agent gets a read-only `runGate` tool and a validated `persistPiece` tool (the latter writes only `draft`/`review` rows and the keys never reach the agent). It has **no tool that can set `status='published'`** — that edge is reachable only through the host-side orchestration API after `canPublish()` returns true. The `MAX_REVISE_CYCLES` cap (N=3) holds: the loop may `draft→review→revise→draft` at most three times; the 4th failure parks the piece at `review` with `forcedToHumanReview=true` rather than spinning tokens forever. This bounds the autonomous loop's cost and guarantees a human chokepoint on persistently-failing YMYL drafts.

*References: ch. 09 (bible v1.0.0, sha: 2c02fe80)*

### 9.2 Publish chokepoint + kill switch

There is exactly **one** transition that produces public output — `approved → published` through `canPublish()` — and it is therefore the single chokepoint to instrument and the single thing the kill switch disables. Drafting, gating, fine-tuning, and client review all continue while publishing is halted; the switch severs *only* the public transition, not the engine.

Three nested kill scopes, fail-closed at each level:

| Scope | Mechanism | Effect | Blast radius |
|---|---|---|---|
| **Global publish disable** | feature flag read inside `canPublish()` | every `approved→published` edge returns `PUBLISH_DISABLED`; drafting/gating/review unaffected | all clients |
| **Per-workspace / per-client pause** | `content_clients` flag, checked in the orchestration API before the FSM call | one tenant's publishes halt; others proceed | one client |
| **Unpublish a live piece** | `published → archived` (or `→ draft`) FSM move | render route stops returning the row (SSR filters `status='published'`); emit instant `410 Gone` + Search Console Removals request; `noindex` with a **lint forbidding a co-existing `robots.txt` Disallow** (a Disallow blocks the recrawl that would see the noindex) | one piece |

The kill switch is **fail-closed by construction**: it is the *absence* of an enabling flag, not the presence of a blocking one, so a missing/unreadable flag halts publishing rather than permitting it. A wedged worker or a Supabase read failure during `canPublish()` resolves to "cannot publish," never "publish anyway." The Slice-4 acceptance test is explicit: the kill switch must **demonstrably unpublish a live piece** (verify the SSR route 404/410s for that slug within one render cycle), not merely flip a flag.

*References: ch. 09 (bible v1.0.0, sha: 2c02fe80), ch. 16 (bible v1.0.0, sha: 2c02fe80)*

### 9.3 Cost ledger (separate SEO AI-Gateway ledger)

D4: a **separate SEO ledger via AI Gateway usage**, not the VideoGen credits wallet. Every model call the worker makes — drafter, faithfulness verifier, the four-skill suite stages (`seo-strategist` / `seo-assistant` / `seo-blog-writer` / `seo-audit`), fine-tune turns — routes through `resolveGatewayModel()` (copied verbatim from `apps/trailhead/src/lib/ai.ts`) so every token is attributed by `workspace_id` / `client_id` / `piece_id` / pipeline stage. The ledger is the **margin input**, not a vanity counter: it measures **cost-per-asset**, and the per-asset row must include the human reviewer's time as a line item (see §13) because the credentialed reviewer — not tokens — dominates blended cost.

**The control point — reconciling "every call routes through the seam" with "the worker is the real `claude` harness."** There is a real tension to resolve: the Agent SDK worker drives its own model calls inside the `claude` subprocess, so the seam cannot be a function the worker chooses to import. The control point is therefore **injected configuration, not a code path the worker can bypass**: `/api/run` provisions the Sandbox with the **AI-Gateway base URL + the per-run bridge JWT as the worker's *only* model credential**, injected into the worker env (the Agent SDK's provider base-URL / `ANTHROPIC_BASE_URL`-style setting points at the accounted Gateway proxy, never the raw Anthropic endpoint). **The direct-Anthropic BYOK branch of `resolveGatewayModel()` is host/non-worker-only** — it is never reachable from the worker runtime, and a CI assertion (RFC PR 001) fails the build if any worker env/config carries a raw Anthropic endpoint + provider key. Because the §11.3 egress allowlist permits exactly the Gateway endpoint and the host-tool bridge — and the worker holds **no** direct provider API key — the SDK's model calls *can only* exit through the metered Gateway seam. `resolveGatewayModel()` runs host-side to mint that injected config; the worker never sees a raw provider key it could use to make an unaccounted call. So "every model call routes through the seam" is true by **capability denial**, not by convention.

**Hard test (the accounted-seam guarantee).** Two assertions gate this:
- **Gateway-disabled ⇒ zero model calls.** A worker run launched with the Gateway base URL absent/disabled (and no fallback provider key, per §11.3) can make **no** model call at all — the run fails fast with a stable "no model seam" error rather than silently reaching the raw Anthropic endpoint. The test asserts a network attempt to the raw provider endpoint is refused by the egress allowlist.
- **Per-run reconciliation.** Per-run token/cost records in the ledger reconcile against the Gateway's own reported usage for that `run_id` (within a tolerance), so a model call that somehow escaped the seam would show up as an unreconciled gap and fail the check. The DoD is reconciliation, not an asserted estimate.

Mechanics ported and hardened:

- **Pre-flight cost reservation, not sum-then-check.** Before a run starts, reserve against the client's budget with a **lock-row conditional UPDATE** (`UPDATE ... WHERE remaining >= cost`), not a read-then-write — two concurrent runs can never both pass a stale check. A failed reservation refuses the run with a stable code; it never silently overspends.
- **The autonomous loop raises per-asset cost.** D1's tool-using loop makes more model round-trips per piece than a fixed pipeline would (fetch → outline → draft → verify → revise, each a turn, up to the N=3 revise cap). The ledger is therefore *more* important under D1, not less — it is the only instrument that catches a loop that has started thrashing.
- **The cross-model invariant has a cost shape.** `drafter !== faithfulnessVerifier` (sonnet drafter / haiku verifier) is enforced in `@sagemark/core` config and asserted in a unit test; collapsing them to save a model would turn the faithfulness gate into a self-consistency check (the costliest YMYL failure) — so the ledger and the invariant are co-defended.
- **Per-stage attribution** feeds the observability slide (§9.5): cost and latency are bucketed by stage so a blowout localizes to *fetch* vs *draft* vs *verify* rather than a single opaque per-piece number.

The ≤$2 editorial-cost target is a **PRD aspiration, not a measured number**; Slice 4's definition of done is that per-piece cost is *measured from the live ledger*, and the first-cluster ledger calibrates final pricing (§13).

*References: ch. 16 (bible v1.0.0, sha: 2c02fe80), ch. 13 (bible v1.0.0, sha: 2c02fe80)*

### 9.4 Share-of-model instrumentation

The north-star KPI is **AI-answer-engine citation / share-of-model** — whether the published hub gets *quoted* by ChatGPT / Claude / Gemini (DR-038, reconciled to shipped reality per audit-005; Perplexity = deferred 4th) when a family asks "what's the difference between memory care and assisted living," not merely where it ranks in classic SERPs. This is the outcome the entire artifact (SSR full-body, FAQ JSON-LD, answer-first capsules, named authority sourcing) is engineered to win, so it must be a first-class, instrumented metric — not a quarterly anecdote.

What we instrument and where it persists (Supabase, scoped per client):

- **A per-client query bank.** The funnel-staged questions the hub targets (seeded from the `clusterRole`/`funnelStage` map promoted in Phase 1, §12). A weekly GEO cron poses each query to the tracked answer engines and records: was the client cited, which piece/URL, in what position, with what surrounding sentiment.
- **Citation events as durable rows**, not a dashboard-only number: `{client_id, query, engine, cited boolean, cited_url, captured_at}`. Share-of-model is then a derived ratio — citations won / queries posed — trendable per client and per piece, so we can see *which guide* earns citations and feed that into winner-amplification sibling briefs (§12 / compounding loop).
- **It is a measurement subsystem, not a one-shot fetch** (engineered in RFC PR 021): provider-specific adapters per engine (ChatGPT/Claude/Gemini — DR-038, reconciled to shipped reality per audit-005; Perplexity = deferred 4th, Gemini-via-Gateway replaces Google-AIO), the *normalized prompt + raw response + parser-confidence + geo/device profile* stored alongside each `cited` boolean so a citation is auditable, per-engine rate-limit budgets, manual-audit sampling so parser error is measured, ToS compliance, and a **fallback to the vendor's official API where direct querying isn't permitted or reliable** — so the metric is trustworthy and a blocked engine degrades to its API path rather than going dark.
- **Read-only by design.** Per the steal-vs-avoid call, the GEO-tracker pattern (Profound / Goodie / AthenaHQ) is a *measurement complement*, not the core — we instrument the outcome ourselves rather than rebuilding their analytics. We may integrate a tracker's API downstream, but the citation ledger is ours so the metric is not hostage to a vendor.
- **Paired with a client-outcome metric later.** Share-of-model is the leading indicator; tour-request / inquiry attribution is the lagging business metric, added once the first cluster has citation history to correlate against.

The crawler-reachability gate (§12 Phase 1/render) is the *precondition* for share-of-model: if the body is CSR-only, the answer engines never see it and the KPI is structurally zero. That is why SSR full-body is a CI-enforced gate, not a best-effort.

*References: ch. 17 (bible v1.0.0, sha: 2c02fe80), ch. 13 (bible v1.0.0, sha: 2c02fe80)*

### 9.5 Observability & gate metrics

The system is operated by **three governors and a set of always-on signals** that surface drift *before a reader sees it*. Because the worker is ephemeral and spans a network hop to `apps/seo`, observability cannot live in worker memory — every signal is an event streamed to `apps/seo` and persisted to Supabase.

**Streaming spine (the trust surface).** The autonomous loop emits SDK events on the worker; `apps/seo` relays them to the browser as SSE (worker → `apps/seo` → browser). The operator canvas renders these as live tool-use traces ("fetching SERP, running faithfulness gate, Stage-A clean, scoring 8 dimensions") and the Inspector renders Stage-A veto chips (stable codes, blocking, red) then the Stage-B 8-dimension 0–100 bars with the verdict band, faithfulness visibly dominant. The scorecard *is* the observability surface for a single piece.

**Gate metrics (the operating dashboard).** Persisted per gate run, aggregated per client and per cluster:

- **Gate-block-by-cause distribution** — the share of blocks attributable to each Stage-A veto code. This is the **D3 reversal trigger** (the binding D2×D3 tension): if `VETO_UNSOURCED_STAT` + low-faithfulness-from-thin-sources is the *top* blocker after the first cluster, DuckDuckGo grounding is the throughput bottleneck and D3 flips to "fund a SERP/retrieval API." The metric is wired in Phase 1 specifically so this call is data-driven, not a guess.
- **Eval-score distribution over time** — the canary for **methodology-fidelity drift**. Because D1's autonomous loop makes nondeterminism the dominant failure surface, the eval-score distribution against the **golden set** (the captured Whispering Willows hub, §12 Phase 0) must be regressed on every model/tool-order/skill-config change. A distribution that quietly slides down is the four-skill suite underperforming its labeled baseline (a model bump or tool-order change degrading the real `SKILL.md` skills) — invisible to ordinary CI, caught only here.
- **Per-stage cost + latency** (from §9.3) — localizes blowouts; feeds the cost slide.
- **Approval debt** — open client-comment-thread count and approval-cycle time per client (§12 Slice 3/4). Surfaces that **release, not generation, is the binding constraint** — the credentialed reviewer and client sign-off are the bottleneck, so the dashboard must make that queue depth visible.
- **Gate false-positive / false-negative rate per veto code** — from the gate-adjudication protocol (§4.4): the share of `VETO_VOICE_FAIL`, faithfulness, `VETO_YMYL_MISCLASSIFIED`, and `VETO_THIN_CONTENT` outcomes later labeled wrong (disputed-and-upheld vs. disputed-and-corrected). This is the **calibration-drift** canary, sibling to the methodology-drift canary above: a detector trending too aggressive or too lax is visible here, not in operator anecdote. A change to any medical/YMYL detector is release-blocking reviewed and re-regressed against the golden set before shipping. Two labeled-data sources feed the **false-negative** half of this metric (the dangerous half — a bad piece the gate *passed*):
  - **Mandatory reviewer gate-correctness label on every YMYL release.** When the credentialed reviewer releases a YMYL piece (the `credentialed_release` on `review→approved`, §9.1), they record a required gate-correctness label — did the gate's verdict (clean / which veto) match their own judgment of the piece's sourcing and claims? A reviewer-flagged miss (the gate passed something the reviewer would have blocked, or blocked something sound) is a labeled FP/FN row.
  - **Periodic sampling/audit of PUBLISH outcomes.** A sampled fraction of already-`published` pieces is re-audited (source + claim checks against `brief.sources` and the authority classes of §6) to catch false-negatives that no dispute ever surfaced — a claim that cleared the gate but does not actually trace to a class-(a) authority. Sampled audits write labeled FP/FN rows the same way.
  - **Calibration telemetry only — never an override path.** Both feeds are *measurement*: they tune detector thresholds and prioritize detector fixes (re-regressed against the golden set). They are **not** a path to publish past a veto and **not** a path to retroactively bless a piece — fixing a false-negative means fixing the detector and the evidence, exactly as the §4.4 adjudication protocol forbids any "override and publish" route.

**The three governors + heartbeats.** (1) the cost-reservation governor (§9.3); (2) a circuit breaker that **pauses generation, not serving** — a wedged or thrashing loop stops drafting while already-published pieces keep rendering; (3) the publish-rate / kill-switch governor (§9.2). Cron jobs (freshness, the GEO query bank) emit **heartbeats**; a missed heartbeat raises an alert rather than letting a wedged generation stall silently — Phase 4's DoD requires that a wedged generation triggers an alert, not a silent stall.

*References: ch. 13 (bible v1.0.0, sha: 2c02fe80), ch. 17 (bible v1.0.0, sha: 2c02fe80), ch. 10 (bible v1.0.0, sha: 2c02fe80)*

### 9.6 Ops runbook, incident response & SLOs (pilot go-live gate)

Observability surfaces drift; a **runbook** says what a human does when a signal fires at 2am. Because the live surface is YMYL memory-care content, a written ops runbook is a **go-live precondition for Whispering Willows** (RFC NE-4) — not the build, but the launch. It is a non-engineering deliverable owned by James, and it must exist before the first piece publishes publicly:

- **Alerting + paging + escalation.** Alert thresholds for each governor (a missed cron heartbeat, a wedged/zombie worker run, a cost-cap abort spike, an SSR-availability dip, a gate-latency breach), *who is paged* for each, and the escalation path when the first responder can't clear it.
- **Rollback commands.** The exact operations to halt harm: flip the publish kill switch (§9.2), unpublish a specific live piece (`published→archived` + 410 + Removals + `noindex`), and disable the worker behind its feature flag — each as a copy-pasteable command, not a description.
- **Data-repair scripts.** Cleanup for an orphaned/half-written run, and replay of a piece from its last `content_piece_versions` snapshot (the Supabase-is-system-of-record property made operational).
- **Customer incident templates.** What the agency tells *its* client when a published memory-care piece must be pulled — a pre-written, honest disclosure so a 2am incident isn't drafted under pressure.
- **Audit-log queries.** The canned queries to answer "who released this piece, when, against which evidence, and which reviewer credential" — the accountability trail the YMYL release model promises.
- **SLOs.** The numeric spine the alerts key on (RFC NE-4 table): **publish/SSR availability** (99.9% monthly), **worker-run completion liveness** (≥99% of runs reach a terminal state, zero silent zombies), **gate latency** (≤15 s p95), and **unpublish/Removals propagation** (404/410 within one render cycle; Removals request ≤5 min). These pair with the §1 latency budgets, which cover *speed*; the SLOs cover *availability + liveness + how fast harm comes down*.

The runbook is fail-closed in spirit: a missing answer to "how do we take a bad YMYL claim down, and how fast" is itself a go-live blocker, sibling to the unstaffed-reviewer constraint (NE-1).

*References: ch. 13 (bible v1.0.0, sha: 2c02fe80), ch. 16 (bible v1.0.0, sha: 2c02fe80)*

---

## 11 · Privacy, consent, regulatory

`regulated=false`, and the data posture keeps it that way: the engine handles **business content, never personal health information**. The YMYL sensitivity here is *editorial* (memory-care medical claims must be sourced and credentialed), not *data-protection* (we store no resident records, no patient data, no end-user PII). The privacy surface is correspondingly narrow and concentrates on two real risks: an untrusted public-web ingestion path, and cross-tenant leakage / voice bleed (the #1 agency-ending risk).

### 11.1 Data posture

- **No PHI, no end-user PII.** The data classes are: client/tenant metadata (`content_clients`: name, public `blog_slug`, workspace), brand voice (`voice_specs`: tone, banned lexicon, the `authors[]` byline registry, sample passages), the content pieces and their immutable versions, and the grounding briefs (public-web snippets + entity lists). None of these are personal health data. The named author in `voice_specs.authors[]` is a **published professional byline** (name + credentials, intended for public attribution), not protected personal data.
- **Private by default; publish is an explicit, gated, public transition.** Every row is private until the single `approved→published` chokepoint (§9.2) is crossed. The render route's `status='published'` filter and fail-closed RLS mean a draft/review/approved/archived piece, every scorecard, and all brand voice are **never** publicly readable. The transition from private to public is a deliberate, recorded human act under `canPublish()` — not a default and not an agent-reachable edge.
- **No durable model-side state.** Per the FSM/worker contract, no product data lives in Anthropic-side session state or on the Sandbox filesystem; Supabase is the only system of record. There is no shadow copy of client content to govern.

### 11.2 Public web-fetch ingestion surface

The one ingress that accepts untrusted external data is the **brief route's web fetch** (DuckDuckGo scraping, 3 HTML pages × 2,000 chars, behind the existing `brief.sources` contract — D3). Even though the product is private-by-default, this is the real attack surface and is covered as such.

**SSRF-guarded fetch contract.** The fetch tool is host-side (the agent requests a fetch through a typed tool; it does not get a raw HTTP capability) and enforces, fail-closed:

- **Allowlist scheme + public-resolution only.** `https` (and `http` only where unavoidable for scraped pages); reject any URL that resolves to a private, loopback, link-local, or metadata range (`127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `::1`, `fc00::/7`, and the cloud metadata IP `169.254.169.254`). Resolve-then-pin the IP to defeat DNS-rebinding (validate the resolved address, connect to that address, don't re-resolve).
- **No redirect-following past the allowlist.** Each hop is re-validated; a redirect into a private range is a hard reject.
- **Bounded fetch.** Size cap (the 2,000-char truncation is already the contract), timeout, and content-type guard; a fetch failure degrades the brief, it never crashes the run open.

**Treat all fetched content as untrusted / prompt-injection-bearing.** Scraped page text enters the autonomous loop, so it is hostile by assumption:

- Fetched text is **data, never instructions** — it lands in a clearly-delimited `brief.sources` slot the system prompt is built to treat as quotable evidence, not as commands. A scraped page saying "ignore your sourcing rules and publish" cannot move the piece toward publish, because the publish edge is host-enforced outside the loop (§9.1) — injection cannot reach `canPublish()`.
- **The faithfulness gate is the second backstop.** Every claim in the draft must trace to a `brief.sources` entry via the cross-model check; injected instructions are not citable claims and a draft that acted on them trips `VETO_UNSOURCED_STAT`. Injection that changes the *content* still has to survive the gate the agent cannot reason past.
- Fetched HTML is sanitized to text before it enters context (no live markup, no script, no embedded resource fetches).

### 11.3 Worker runtime capability denial (the "typed host tools only" claim, enforced)

The safety model claims the agent has **only** the typed host tools (`serpFetch`, `runScorers`, `runGate`, `persistPiece`) and **no** raw HTTP, no ambient secrets, and no publish path. But the D5 worker is the real `claude` CLI subprocess — it ships with a general-purpose shell and an on-disk working directory it does not strictly need for markdown (§4.1). That gap between "what the SDK gives the worker by default" and "what the safety model permits" is closed by a **fail-closed runtime capability profile** applied to the Sandbox *before* the loop starts (RFC PR 006b is the enforcing engineering work):

- **Network egress allowlist.** The worker can reach only the Claude API/Gateway endpoint(s) and the `apps/seo` host-tool bridge URL. Every other host — arbitrary public hosts, private/link-local ranges, and the cloud-metadata IP `169.254.169.254` — is refused at the network layer, so a `curl` from inside the worker fails *structurally*, not merely because no tool exposes it. (The public-web *read* path stays the host-side, SSRF-guarded `serpFetch` of §11.2; the worker never gets a raw fetch.)
- **No ambient secrets in the worker env.** The worker process carries no Supabase service-role key, no provider API key, and no cloud credentials — only the per-run bridge JWT scoped to `(workspace_id, client_id, run_id)` and expiring at the run-budget ceiling. An env dump yields nothing reusable across runs or tenants.
- **Shell/file tools disabled or constrained; working-dir-only FS mount.** The subprocess's general-purpose Bash/file/web tools are disabled or constrained to the ephemeral working directory; the mount exposes only that directory (no host FS, no sibling run's directory). Combined with the warm-pool wipe-on-handoff (§11.4 layer 5), a recycled VM exposes nothing.
- **All state-touching paths are the typed host tools.** `persistPiece` (host-validated write) and `runGate` (read-only) are the worker's only ways to reach Supabase or the gate; there is no direct DB or publish API the worker can call. Publish remains a host-only, human-gated `canPublish()` transition the worker has no tool for (§9.1).

The acceptance bar is **adversarial, not aspirational**: an integration test feeds a malicious brief and a malicious fetched-source string that instruct the agent to raw-`curl` an external host, dump environment variables, read another run's working-dir files, and write the DB/API directly — and **all four must fail** (RFC PR 006b). If any capability control fails to apply, the worker refuses to boot rather than running under a weaker profile. This makes "the agent has only typed host tools" a runtime-enforced fact, the same fail-closed property the deterministic gate has.

### 11.4 Tenant isolation enforcement

Cross-tenant leakage / voice bleed is the **#1 flagged, agency-ending risk** — a memory-care client's content rendered under, or grounded in, another client's voice or facts. Isolation is therefore enforced **fail-closed at five independent layers**, no single one trusted alone:

| # | Layer | Mechanism | What it stops | Fail mode |
|---|---|---|---|---|
| 1 | **DB row-level security** | RLS enabled on all three content tables. The *only* anon policy is `content_pieces_public_read` = `FOR SELECT TO anon USING (status='published')`. `voice_specs` and `content_piece_versions` have **no anon policy at all**. | A public reader (or a leaked anon key) reading any draft, any scorecard, any brand voice, or any other client's unpublished work. | Closed — no matching policy ⇒ zero rows, never an error-open. |
| 2 | **Service-role query wrapper** | All operator queries run service-role through a wrapper that **requires** a `workspace_id` + `client_id` and injects them into every `WHERE` (and write). The bridge `content_clients.workspace_id` resolves the workspace→client edge once, server-side. | An authenticated operator in workspace A reading or writing workspace B's rows; a missing scope clause silently returning the whole table. | Closed — a query with no resolved tenant scope throws before execution, it does not run unscoped. |
| 3 | **Worker tenant-resolution** | The Sandbox worker is **handed a single resolved `{workspace_id, client_id}` per run** and all host-side tools (`runGate`, `persistPiece`, the brief fetch, the voice-spec read) are **keyed to that pair** — the worker has no tool that takes an arbitrary tenant id. Voice/corpus is a hard namespace boundary; there is **no default-voice fallthrough** (`requireApprovedVoiceSpec()` hard-stops a client with no approved spec rather than borrowing another's). | The agent loop reaching across clients — fetching client B's voice spec or persisting into client B's namespace — even under a confused or injected prompt. | Closed — a tool call outside the run's pinned tenant is rejected host-side; no approved spec ⇒ generation refused, never a borrowed voice. |
| 4 | **CI contract tests** | A standing test asserts cross-tenant `SELECT` of another workspace's draft returns **zero rows**, that the review token is scoped to exactly one piece/version, and that the service-role wrapper refuses an unscoped query. Run on every change. | Regressions that quietly widen retrieval — a new tool, a new route, or a relaxed policy reopening the boundary. | The build fails; the boundary cannot silently erode. |
| 5 | **Compute-substrate isolation** | A warm-pool Sandbox microVM holds **no tenant binding while idle** (no `workspace_id`/`client_id`, no scoped tools, no bridge token); `/api/run` binds it only on lease and **wipes the working dir + restarts the `claude` subprocess on handoff**, so a recycled VM is indistinguishable from a cold boot to the next run. | A recycled microVM leaking the prior run's working-dir or session state into the next tenant's run — compute-side voice bleed, the same agency-ending failure one layer down. | Closed — recycled VM carries no residue; a PR-006 residue test fails the build if it does. |

The client-review token (D8) inherits this posture: it is scoped to **exactly one piece/version**, fail-closed, and grants no listing capability — a reviewer with a token for piece X cannot enumerate or reach piece Y or any other client.

### 11.5 Consent, identity & licensing (not HIPAA-grade, but contractually + operationally explicit)

`regulated=false` and there is no PHI — but the engine **does** attach real professional identities (author + reviewer names and clinician credentials) to published memory-care content, and that creates obligations that are contractual and operational rather than HIPAA-grade. Making them explicit is part of the YMYL credibility the product sells:

- **Consent + authorization for bylines.** A credentialed author or reviewer's name + credential is published as a byline only with a **recorded authorization** — a first-class **`byline_authorizations`** record (§10: `author_id`, credential snapshot, scope, `granted_at`, `expires_at`, `revoked_at`, `authorized_by`) keyed to the `voice_specs.authors[]` registry, **not** a free-text flag. `credentialed_releases.authorization_id` is an FK against it. A byline cannot be attached to a piece unless an **active** authorization exists (granted, not revoked, not expired); a **revoked, expired, or inactive authorization blocks the credentialed release — and therefore blocks publish.** Revoking removes the person as an eligible byline going forward (a withdrawn byline is not re-published, §retention below). This is the consent counterpart to the server-side byline resolution (§10): the credential is not just *real*, it is *authorized for this use*.
- **Byline-authorization workflow.** Adding a clinician to a client's author registry is an explicit operator workflow that captures the authorization record before the author is selectable — not a free-text field. For YMYL, the credentialed-reviewer assignment (D6) carries the same authorization capture.
- **Retention / deletion / export policy.** Professional identities (`voice_specs.authors[]`) and client/reviewer comment identities (`review_comments.author`) have a stated retention policy, a deletion path (authorization revocation + removal from the registry; comment-identity deletion on client request), and an export path (a client can obtain its own brand voice, author registry, comments, and pieces). The append-only `content_piece_versions` audit trail is retained for accountability, but a *withdrawn* byline is not re-published.
- **Source + image licensing rules.** Every cited source carries its canonical URL + attribution (§6), and every generated/used image carries a recorded license/provenance record — an unlicensed asset is blocked from publish by construction (Never-list #8). Quoted/source material respects the origin's license/ToS (§6 robots/ToS compliance).
- **Contract boundary with the agency.** The agency supplying a clinician's credentials warrants, by contract, that those credentials are accurate and that it holds the clinician's authorization to publish them as a byline; Sagemark resolves and renders what the agency authorized but is not the credential's verifier of record. This boundary is stated in the agency agreement so the responsibility for credential accuracy + authorization sits where the relationship is — explicit, not assumed.

The posture in one line: **not HIPAA-grade (no PHI, no patient data), but every published professional identity is consented, authorized, retained/deletable on a stated policy, and contractually bounded** — the trust the YMYL surface depends on, made operational rather than implicit.

*References: ch. 03 (bible v1.0.0, sha: 2c02fe80), ch. 10 (bible v1.0.0, sha: 2c02fe80), ch. 16 (bible v1.0.0, sha: 2c02fe80)*

---

## 12 · Phased build plan

The sequencing rule is **the deterministic moat ships before the agent, the gate ships before any publish, and the golden set is captured before a single prompt is written** — then the *thinnest end-to-end slice* is proven on real infra before the surface area widens. This directly answers the flagged Phase-1 scope inflation (D1 + D2 + D5 + D7 stack, plus D5's second deploy target): we prove the worker topology, the autonomous loop, and the hard gate on **one piece for one client** before adding the homepage, the cluster, imagegen, and client review.

| Phase | Goal | Duration | Ship gate (definition of done) |
|---|---|---|---|
| **0 — Foundations** | Port the engine, schema, and tenancy; capture the golden set. De-risk before estimating. | ~0.5 wk | `git fetch origin preview`; the **golden corpus** (Whispering Willows pillar + ~8 spokes + homepage) committed under `apps/seo/golden/` with human labels (cluster role, funnel stage, expected dimension scores, expected Stage-A clean/veto); `gate-spec.ts` enumerates every Stage-A veto code + Stage-B verdict bands; a one-page diff doc states what ports verbatim vs. what is net-new; **a dry-run of the credentialed reviewer over the golden corpus yields an early pages/week number** (the go-live constraint + pricing floor + throughput ceiling — NE-1, §13). **No prompt is written before the golden set exists.** |
| **1 — Pilot (thinnest slice → full hub for Whispering Willows)** | Prove every load-bearing decision at once on real infra, then widen to the full hub. | ~9–11 wk (assumes ~2 engineers) | See sub-gates below. **Phase-1 is shippable only when all behavioral journeys pass AND the credentialed YMYL reviewer (D6) is staffed with a named backup.** |
| **Slice 4 / Phase-4 — north-star feed + go-live hardening** *(in v1 scope; the closing slice of Phase 1)* | Stand up the share-of-model citation-ingestion cron + the freshness cron, the kill-switch DoD, and the cost-ledger calibration — the instrumentation the north-star KPI and the compounding loop actually run on. | within the ~9–11 wk Phase-1 envelope | SoM ingestion cron **populates `share_of_model`** against ≥3 answer engines (RFC PR 021, owner James); freshness cron emits refresh *drafts only* (never auto-publish); kill switch demonstrably unpublishes a live piece within one render cycle; per-asset cost measured from the live ledger. |
| **2 — GA / multi-client scale** | Generalize beyond the pilot: self-serve client onboarding, billing automation, broad multi-tenant load, the full compounding/refresh loop at scale. | **Out of scope for v1** | n/a — explicitly deferred; v1 is one real client end-to-end, not a self-serve product. |

**Phase 1 is built as an ordered stack of thin vertical slices, not horizontal layers** — each slice is demoable:

1. **Slice 1 — the thinnest end-to-end vertical (build this first).** **Canonical DoD (identical in §0 and RFC §4/§7):** Slice 1 = **a single worker-hosted drafter call + the SSE relay + the host-enforced gate (the `/content/api/audit` route) + a MINIMAL SSR render + one bounded edit → re-gate → a gated version — NOT the full self-revising autonomous loop/canvas, which arrives in Slice 2.** For **one client with one approved voice spec**, generate **one YMYL piece**: brief (SERP-grounded, deterministic, SSRF-guarded per §11.2) → a single worker-hosted drafter call streamed back over the SSE relay → faithfulness gate → `seo-gate` Stage-A vetoes then Stage-B composite → persist as `draft` in Supabase scoped by `workspace_id`/`client_id` → a **minimal body-only SSR render** of the published piece → **one bounded edit that re-runs the full gate and writes a gated version**. **Prove it cannot reach `published`** without `PUBLISH` verdict + `evalRan` + recorded human release + a server-resolved credentialed byline. This slice exercises the ported `@sagemark/core` moat, the worker topology + SSE relay (proven here on the thinnest slice), the host-enforced non-compensatory gate, the fail-closed FSM, multi-tenant RLS, the voice-spec hard stop, the provider seam + cost ledger, the minimal render, one bounded re-gate, and golden-set regression — **deliberately omitting** the full self-revising autonomous loop/canvas, the hub homepage, imagegen, the multi-piece cluster, and client review (those widen the surface in Slice 2+). *Sub-gate:* generation against the golden brief reproduces the expected Stage-A clean/veto; the published piece renders body-in-HTML; one bounded edit re-gates and writes a version; a cross-tenant `SELECT` returns zero rows; `drafter !== verifier` asserted.

2. **Slice 2 — the full self-revising autonomous loop + canvas (D5/D1).** Slice 1 already proved the worker-hosted drafter path + SSE relay + a minimal render + one bounded edit/re-gate; Slice 2 widens that to the **full self-revising autonomous loop and the three-zone canvas**. The SDK's autonomous loop runs the full four-skill suite chain (`seo-strategist`→`seo-assistant`→`seo-blog-writer`→`seo-audit`) fetch→outline→draft→verify→revise→gate self-directing (the full loop, not the single drafter call of Slice 1); the three-zone canvas streams token deltas + tool traces + the live two-stage scorecard. The **full multi-turn conversational fine-tune** widens Slice 1's single bounded edit: chat/inline/section instruction → bounded body diff → append-only version → **full gate re-runs** → guarded by SHA-256 stale-edit (409) + per-tenant rate-limit (429) + workspace-ownership (403). *Sub-gate:* a faithfulness-breaking fine-tune is caught and blocked from advancing; all four suite skills pass golden regression within tolerance.

3. **Slice 3 — schema migration + render + hub homepage (D7).** Promote **`clusterRole` + `funnelStage` to first-class indexed columns** (Phase-1 migration, not a Phase-3 deferral). SSR per-client render with **full body in initial HTML** (CI reachability gate: sitemap == published-and-indexable set, both directions), FAQ JSON-LD, placeholder-stripping, sitemap/robots. **Generate the resource-library homepage** (D7) off the cluster columns — hero, statistic callout, three-stage cluster section, guide-card grid, tour CTA + license badge. Imagegen resolves `[photo:]` placeholders with recorded provenance (no-provenance asset is blocked). *Sub-gate:* the full Whispering Willows hub renders SSR with body-in-HTML, valid FAQPage JSON-LD, no leaked tokens; reachability gate green both directions.

4. **Slice 4 — client review + go-live hardening + the north-star feed.** Tokenized hosted client preview (D8, one piece/version, fail-closed); pinned comments + section Approve/Request-changes (a "Request changes" routes into the §7 edit loop); named undeletable sign-off version. **Client approval is advisory on hard gates** — a client can never approve past a YMYL/faithfulness/thin-content veto. Cost ledger measured from live Gateway usage; kill switch demonstrably unpublishes a live piece; approval-debt instrumented. **The share-of-model citation-ingestion cron and the freshness cron land here** (RFC PR 021, owner James): the SoM cron poses each client's query bank to ≥3 answer engines and **populates `share_of_model`** (the north-star feed is rows landing, not a dashboard), and the freshness cron emits refresh *drafts only* (never auto-publish, per RFC §1 non-goals) that re-enter the gate + human-release path. *Ship gate for Phase 1:* all behavioral journeys pass **and** D6 is resolved (named reviewer + named backup + pages/week ceiling) — **no YMYL page goes live until the backup-reviewer path exists.**

**Why this order honors the overrides.** The thinnest slice (Slice 1) proves D2's hard gate and the ported moat with the *least* surface area; D5's worker topology and D1's loop are added in Slice 2 *on top of a gate that already works*, so a nondeterministic loop is introduced only once the deterministic backstop is green; D7's homepage + schema migration come in Slice 3 once there is a cluster to render; D6 (the binding go-live constraint) gates the *final* slice, not the build start. This is the explicit mitigation for the Phase-1 scope-inflation tension on the record.

*References: ch. 07 (bible v1.0.0, sha: 2c02fe80), ch. 11 (bible v1.0.0, sha: 2c02fe80), ch. 09 (bible v1.0.0, sha: 2c02fe80)*

---

## 13 · Pricing & packaging

**Model: per-seat / per-piece SaaS, with a *separate* AI-Gateway SEO ledger as the margin instrument** (D4). The two are deliberately decoupled — the customer pays a productized SaaS price (predictable, value-based), while the ledger measures the true *cost-per-asset* behind that price so margin is observed, not assumed.

**Packaging.**

- **Per-seat** for the operator surface (agency editors who run the console, drive the autonomous loop, and manage clients). Seats price the *workbench*.
- **Per-piece** (or per-cluster) for the output — a published, gated, YMYL-credible hub piece is the unit of value the client buys. Per-piece aligns price with the artifact the customer actually receives (a governed, crawlable asset), not with token consumption they don't see.

**The separate SEO ledger is the margin input, and it must capture more than tokens.** Cost-per-asset = model spend (from the per-stage Gateway attribution, §9.3) **+ the human reviewer's time**, line-itemed per piece. This is the decisive packaging insight on the record:

- **The human reviewer dominates blended cost.** With D2's hard YMYL gate, every memory-care page requires a *credentialed* reviewer's release (D6) — and a credentialed health reviewer's time is far more expensive per piece than the model spend. The ≤$2 editorial *token* target is real but is **not** the cost that sets the price; reviewer minutes-per-piece is. Pricing that ignores reviewer time will look margin-positive on the Gateway ledger and lose money in reality.
- **The reviewer is also the throughput ceiling.** Per the binding D6 constraint, the credentialed reviewer's pages/week capacity caps how many YMYL pieces can ship regardless of how cheaply the model drafts them. So reviewer time is simultaneously the **dominant cost line** and the **rate limiter** — both arguments for pricing per-piece (which prices the scarce reviewed-asset) over a flat all-you-can-generate seat (which would sell capacity that doesn't exist).
- **The D2×D3 tension feeds the cost model too.** If thin DDG grounding drives a high self-veto / revise rate (the instrumented gate-block-by-sourcing metric, §9.5), cost-per-published-asset rises through wasted revise cycles — another input the ledger surfaces, and another reason the D3 reversal (fund a SERP API) is a *margin* decision, not just a quality one.

**Calibration is data-driven, not guessed.** Per-piece and per-seat prices are **finalized from the live SEO ledger after the first Whispering Willows cluster** (a logged open question, owner James) — once we have a measured per-asset cost (model spend + observed reviewer minutes + revise-cycle overhead), not the PRD's estimated target. The autonomous loop's higher round-trip count (D1) and the reviewer's blended rate are the two numbers that move the floor; both are measured, then priced with margin on top.

*References: ch. 16 (bible v1.0.0, sha: 2c02fe80), ch. 14 (bible v1.0.0, sha: 2c02fe80)*

---

## 14 · Risks and mitigations

The dominant failure surface for SEO Creator is not "the model writes a bad sentence" — it is **governance failure under autonomy**: a multi-tenant, fully-autonomous loop (D1/D5) publishing YMYL memory-care content into AI answer engines. The risks below are ordered by blast radius, not likelihood. The #1 risk (cross-tenant voice bleed) is agency-ending; the YMYL faithfulness risk is the one the entire competitive wedge exists to neutralize. Every mitigation is a structural control enforced **outside** the agent loop in host code (the ported deterministic kernel), never a prompt instruction the agent could reason past.

| Risk | Likelihood | Blast radius | Mitigation |
|---|---|---|---|
| **Cross-tenant leakage / voice bleed** — a host tool, the review token, or a retrieval call widens scope across clients; Client A's corpus, byline, or voice spec contaminates Client B's piece. The single agency-ending failure. | Medium | **Catastrophic** — one leak ends the agency relationship and the product's credibility simultaneously; unrecoverable trust loss in a vertical that runs on referrals. | Tenancy is a **hard fail-closed boundary**, not a filter: every Supabase row scoped by `workspace_id` + `client_id`; fail-closed RLS (anon `SELECT` only `status='published'`); host-side tools keyed to exactly one `workspace_id`/`client_id` at construction, never widened by agent argument; **no default-voice fallthrough** — a piece with no `approved_at` voice spec is refused at creation, never silently grounded on a sibling's voice; review token scoped to exactly one piece/version (D8); corpus namespace as a hard boundary the worker cannot cross. Cross-tenant `SELECT` returning zero rows is a Phase-1 DoD test and a standing regression. *Ref: ch. 03 (permissions), ch. 10 (failure-modes).* |
| **Ungoverned YMYL content / faithfulness failure** — the loop publishes a memory-care medical claim that is unsourced, fabricated, or attributed to a faked credential (the CNET/Sports Illustrated/Babylon failure class). | Medium | **Catastrophic** — deindexing risk under the next Helpful-Content core update, regulatory exposure (mandatory AI-health-disclaimer pressure), real-world harm to families making memory-care decisions, and client reputational damage. | The product **is** the mitigation. Hard fail-closed non-compensatory gate (D2): Stage-A vetoes (`UNSOURCED_STAT`, fabricated-data, missing-byline) short-circuit to `score=null` before Stage-B ever runs; cross-model faithfulness check with the enforced `drafter !== verifier` invariant (a self-grade is structurally impossible); E-E-A-T as a **provable publish precondition** — named credentialed `author_id` resolved server-side from the voice-spec registry (never `request.author`) + citations present + recorded human release, all required before a YMYL piece can leave `draft`. The agent gets a read-only `runGate` tool and can never reason past a veto or `canPublish()`. *Ref: ch. 15 (judge-pattern), ch. 09 (modes-state), ch. 10 (failure-modes).* |
| **D2×D3 thin-grounding → high self-veto throttles throughput** — the hard gate is only as good as `brief.sources`; 3 DDG HTML pages × 2,000 chars cannot ground claims to the named authorities (Alzheimer's Association, NIA) the artifact promises, so the engine correctly but frequently vetoes/revises its own YMYL drafts. Grounding, not the model, becomes the throughput bottleneck. | **High** | Moderate — no published harm (the gate is working), but throughput collapses and per-asset cost/latency spike from repeated revise loops, eroding the margin thesis. | This is a **measured, reversible** lean-startup posture, not a permanent call. Instrument the **gate-block-by-sourcing rate** in Phase 1: the share of Stage-A `UNSOURCED_STAT` vetoes + low-faithfulness verdicts attributable to thin sources. **D3 reversal trigger:** if sourcing is the top blocker after the first Whispering Willows cluster, D3 flips to "fund a SERP/retrieval API." Engineering wires either source behind the same `brief.sources` contract, so the reversal is a config change, not a rebuild. The bet is explicitly falsifiable. *Ref: ch. 17 (evals-learning-loop), ch. 10 (failure-modes).* |
| **AirOps (or another funded incumbent) adds a gate — displacement** — the $40M-Series-B, agency-credible AI-search platform converges on the same SEO+GEO surface and ships the refuse-to-publish governance layer that today only we have. | Medium | High — erases the wedge; collapses pricing power toward commodity per-seat SaaS. | The wedge (the gate) is a 6-month head start, not the moat. The **durable moat is what a horizontal toolkit will not prioritize**: the opinionated fail-closed lifecycle FSM (vs. AirOps' un-opinionated build-your-own pipeline) + **vertical senior-living E-E-A-T depth** (care-level schema, named clinician bylines, memory-care-specific faithfulness checks) + per-client voice corpus. Defense is to deepen the vertical (more memory-care-specific gate rules, the credentialed-reviewer relationship, share-of-model proof in the exact vertical) faster than a horizontal player will choose to. *Ref: ch. 14 (framework-to-platform), ch. 15 (judge-pattern).* |
| **Credentialed-reviewer single point of failure (D6 unstaffed)** — with D2 = hard gate, the credentialed YMYL reviewer holds release authority and is the binding throughput constraint; D6 is currently unstaffed with no backup. | **High** (currently unresolved) | High — **blocks go-live entirely**; once live, one reviewer's absence (illness, churn) halts all YMYL publishing. | No YMYL page goes live until D6 resolves into a **named reviewer + a named backup + a pages/week capacity ceiling** (top open-question, owner James, target 2026-08-15). Disabling release halts public output without stopping drafting (the FSM kill-switch), so the reviewer is a chokepoint by design, not an accident. The approval-debt KPI (open-thread count + approval-cycle time per client, Slice 3/4) surfaces reviewer saturation before it stalls the pipeline. Pre-go-live gate: a backup-reviewer path must exist. *Ref: ch. 09 (modes-state), ch. 16 (control-plane).* |
| **Autonomous-loop nondeterminism / methodology drift** — D1/D5 give a self-directing `ToolLoopAgent` running the four-skill `seo-copywriter` suite; a model or tool-order/skill-config change silently degrades the suite below its labeled baseline, invisible to CI because content has no compiler. | Medium | High — silent quality decay erodes the very faithfulness the product sells; caught only after a reader (or a crawler) sees it. | **Golden-set discipline is non-negotiable** (DECISIONS D1): the live Whispering Willows hub (pillar + ~8 spokes + homepage) is captured as a human-labeled golden corpus *before the suite is wired into the worker* (Phase 0), with per-piece cluster role, funnel stage, expected dimension scores, and expected Stage-A clean/veto. **Every** model/tool-order/skill-config change regresses against it within tolerance. The deterministic kernel is ported verbatim and the suite skills are run directly (not re-authored), so the drift surface is the model + tool-order + skill config — and that is exactly what the golden set guards. *Ref: ch. 17 (evals-learning-loop), ch. 13 (observability).* |
| **Vercel Sandbox cold-start / state-loss** — the D9 ephemeral microVM hosting the long-lived Agent-SDK loop is recycled mid-run, or its on-disk working directory is treated as durable across runs. | Medium | Moderate — a dropped run, a half-written piece, or (worst case) a lost session if state lived only in the Sandbox FS. | **Sandbox is compute-only; Supabase is the system of record** (D9). All per-run session/agent/working-dir state persists to Supabase, never the Sandbox filesystem across runs. A recycled VM resumes from the last persisted FSM state; an interrupted draft is never half-published because the publish transition is fail-closed (requires `verdict==='PUBLISH'` AND recorded release AND eval-ran). If a single pipeline outgrows one Fluid/Sandbox timeout, adopt `DurableAgent` (Workflow DevKit) checkpointing (Phase 4, conditional). Cron heartbeats alert on a wedged loop rather than a silent stall. *Ref: ch. 09 (modes-state), ch. 13 (observability).* |
| **SSRF via brief fetch** — the web-fetch brief route fetches attacker-controlled URLs (or follows redirects to internal addresses); fetched page content carries prompt-injection into the autonomous loop. | Low | Moderate — internal-network exposure or a hijacked loop, despite the artifact being private-by-default. | SSRF-guarded fetch contract (preserved from the ported brief route): allowlist/denylist on resolved IPs (block private/link-local/metadata ranges), no following redirects to internal hosts, bounded response size. **All fetched content is treated as untrusted data, never as instructions** — the loop's grounding tools surface fetched text as quoted source material the gate scores, not as agent directives. The agent's tool permissions are read-only for retrieval; only host-validated `persistPiece`/`runGate` can mutate state. *Ref: ch. 03 (permissions), ch. 10 (failure-modes).* |

*References: ch. 03, ch. 09, ch. 10, ch. 13, ch. 14, ch. 15, ch. 16, ch. 17 (bible v1.0.0, sha: 2c02fe80)*

---

## 15 · Open questions

These are the unresolved calls carried out of discovery (manifest `discovery.open_questions`). The first is the **binding go-live constraint** — the product can be fully built and still cannot ship YMYL pages until it resolves. The other two are calibration calls that resolve from live data after the first cluster, not before the build.

| # | Question | Why it matters | Target resolution | Owner | Date by |
|---|---|---|---|---|---|
| **OQ-1** | Name the credentialed YMYL reviewer **and a backup**, and set the pages/week capacity ceiling. (D6 — currently unstaffed, no engineering default.) | With D2 = hard gate, the credentialed reviewer holds release authority and is the binding constraint on YMYL publish rate. No YMYL page can go live until a named reviewer + backup-reviewer path + a capacity number exist. This is the **top go-live blocker** — it gates the Whispering Willows launch, not the build start. | specialist-review (name + credential + pages/week ceiling + named backup) | James | **2026-08-15** |
| **OQ-2** | Calibrate per-asset cost and finalize per-piece / per-seat pricing from the **live SEO ledger** after the first cluster. | The ≤$2 editorial-cost target is a PRD target, not a measured number; D1's autonomous loop raises round-trips per piece, so real cost-per-asset (including reviewer time) is unknown until the first cluster runs. This number sets margin and validates the per-piece-SaaS pricing assumption. | tech-spike (measure from live AI-Gateway ledger after first Whispering Willows cluster) | James | After first cluster (pre-pricing-lock) |
| **OQ-3** | Decide the **D3 reversal**: if gate-block-by-sourcing is the top blocker after the first cluster, fund a SERP/retrieval API. | The D2×D3 tension is the binding architectural bet: thin DDG grounding may throttle throughput via correct self-vetoes. The reversal is cheap (same `brief.sources` contract) but must be triggered by the instrumented metric, not vibes. | tech-spike (read gate-block-by-sourcing rate after first cluster; fund SERP API if it is the top blocker) | James | After first cluster (data-triggered) |

*References: ch. 16, ch. 17 (bible v1.0.0, sha: 2c02fe80)*

---

## 15a · Assumption / evidence ledger

Every load-bearing claim the plan rests on, graded by evidence strength and source. **ASSUMED** rows are the bets — each carries an explicit `validation_path` that resolves it from real data, not opinion. The two strongest claims (the wedge and the Whispering Willows validation) are externally grounded; the riskiest (per-piece pricing, reviewer throughput, DDG-grounding sufficiency) are bets we have instrumented to resolve fast.

| Claim | Evidence strength | Evidence type | Source | Validation path | Owner |
|---|---|---|---|---|---|
| **Wedge — no shipping competitor can refuse to publish on faithfulness/YMYL grounds; the field is empty on governance.** | **Strong** | competitor-precedent | Phase 2 research across ~12 products (Jasper, Surfer, Frase, Byword, Writesonic, Search Atlas, AirOps, Profound, Goodie, AthenaHQ); every tool nudges via a compensatory score or voice-consistency, none refuses. | Re-run competitive scan by 2026-09-23 (commercial +90d trigger); watch AirOps + AthenaHQ for gate-language drift. | James |
| **Validation — Whispering Willows is a real paying client engagement; the demo reflects real client work.** | **Strong** | shipped-feature | Signed client engagement; live reference hub at whispering-willows-content-demo.vercel.app (manifest stakeholders). | First paid pilot live + client sign-off on a generated cluster (success-§16, 60-day). | James |
| **Moat — vertical senior-living E-E-A-T depth + opinionated fail-closed FSM is what a horizontal incumbent (AirOps) won't prioritize for 6+ months.** | **Medium** | analyst-intuition | Discovery Q1.2; AirOps ships an un-opinionated toolkit, not a vertical gate (research-brief). | Track AirOps/competitor roadmap quarterly; measure vertical-depth lead (memory-care-specific gate rules + clinician bylines) shipped vs. incumbent. | James |
| **Share-of-model is the right north-star KPI (AI-answer-engine citation, not rank).** | **Medium** | competitor-precedent | GEO trackers (Profound $35M Sequoia, Goodie, AthenaHQ) productize share-of-model; A Place for Mom's Nov-2025 AIO pivot in our exact vertical; research-brief industry context. | Instrument hub citation frequency across ≥3 answer engines; confirm it moves with the client-outcome metric over the first 90 days. | James |
| **≥3 answer engines expose a legal/reliable citation-measurement channel we can use to instrument share-of-model.** | **ASSUMED** | none | RFC PR 021 assumes ≥3 engines (ChatGPT/Claude/Gemini — DR-038, reconciled to shipped reality per audit-005; Perplexity = deferred 4th) can be probed via sanctioned APIs or a contracted vendor; DR-038 resolves the engine set + the Gateway-direct-query method, but the per-engine ToS/quota feasibility of direct querying is still confirmed by the spike below. | **Run the PR 021 measurement-feasibility spike before building adapters: name a candidate sanctioned API/provider per engine and record its quota + per-run cost (the channel matrix); gate PR 021 on real adapter credentials / a contracted measurement vendor (not mocked adapters only). If only 1–2 engines expose reliable citation behavior, ship the DEGRADED v1 metric (a labeled single-/dual-engine citation rate, uncovered engines recorded as a known gap), never a faked ≥3-engine number.** | James |
| **Per-piece / per-seat SaaS pricing clears margin at the measured per-asset cost.** | **ASSUMED** | none | Discovery Q6.2 default; ≤$2 editorial target is a PRD target, not a measured number. | **Measure cost-per-asset (incl. reviewer time) from the live AI-Gateway SEO ledger after the first Whispering Willows cluster; lock pricing only then** (OQ-2). | James |
| **One credentialed reviewer clears enough pages/week to make YMYL publish-rate viable.** | **ASSUMED** | none | D6 unstaffed; no engineering default; reviewer is the binding constraint under D2. | **Staff the reviewer + backup (OQ-1), then measure actual pages/week cleared and approval-debt (open-thread count + cycle time) per client in Slice 3/4; set the capacity ceiling from observed throughput.** | James |
| **DuckDuckGo scraping (3 pages × 2,000 chars) grounds memory-care YMYL claims sufficiently to clear the hard faithfulness gate at acceptable throughput.** | **Weak / ASSUMED** | analyst-intuition | D3 [OVERRIDE]; flagged D2×D3 tension; content-farm deindexing tales show thin grounding is exactly what fails. | **Instrument gate-block-by-sourcing rate (`UNSOURCED_STAT` + low-faithfulness from thin sources) in Phase 1; if sourcing is the top blocker after the first cluster, flip D3 to a funded SERP/retrieval API behind the same `brief.sources` contract** (OQ-3). | James |
| **Vercel Sandbox + the Claude Agent SDK can actually enforce the worker capability-denial controls** (network egress allowlist, env scrub, constrained shell/file, boot-refusal) — the platform assumption the entire worker safety model rests on. | **ASSUMED** | none | RFC §2 / §3.4-layer-5 / PR 006b assume the controls are enforceable on Vercel Sandbox; not yet proven with a real adversarial run, and the SDK ships a general-purpose shell + on-disk workspace by default. | **Run the Phase-0 capability-enforcement spike (RFC PR 000) *before* the worker architecture locks: exercise each control with a real adversarial run on Vercel Sandbox; if any control is unenforceable, adopt the defined fallback runtime (egress proxy / isolated container service / no-shell-capable Agent-SDK worker in v1) and re-scope PR 006/006b against it before building the loop.** | James |
| **The warm-pool keeps worker first-token latency inside the ≤4 s p95 budget** (Sandbox cold-start is amortized, not eliminated). | **ASSUMED** | none | RFC §1 budget table + §7 warm-pool design; no measured Sandbox boot number yet. | **Run a Phase-1 Sandbox cold/warm-boot spike: measure first-token p95 with and without a warm hit; size the pool from observed boot time, or fall back to the poll transport if the budget can't be met.** | James |
| **Single-piece generation holds ≤90 s p95 under up to N=3 revise cycles** (the autonomous loop does not blow the budget when it self-revises). | **ASSUMED** | none | RFC §1 budget table; D1's loop adds round-trips and the N=3 cap allows up to three revise turns. | **Measure brief→gated-draft p95 over the first Whispering Willows cluster, including pieces that hit the revise cap; if p99 outgrows a Fluid/Sandbox window, adopt `DurableAgent`/checkpointing (RFC OQ-2).** | James |
| **The kill switch propagates within one render cycle** — unpublish emits a 410 Gone + Search Console Removals request + `noindex` and the SSR route stops serving the slug. | **ASSUMED** | none | §9.2 kill-switch design; the propagation timing is asserted, not measured. | **Measure propagation in the kill-switch definition of done (Slice 4): verify the SSR route 404/410s for the slug and the Removals request fires within one render cycle, not merely that the flag flipped.** | James |
| **The on-page AI-disclosure-to-reader posture (provable byline + credentials + citations + medical disclaimer, surfaced to reader and crawler) satisfies current YMYL AI-health-disclosure expectations.** | **ASSUMED** | analyst-intuition | §8 AI-disclosure policy; floating AI-health-disclaimer regulation is sharpening but unsettled. | **Confirm the disclosure posture with the credentialed YMYL reviewer (D6) and a one-line legal check before Whispering Willows go-live; revisit on the +90d competitive/regulatory scan.** | James |
| **The ported deterministic engine (seo-gate, lifecycle-fsm, 22 scorers, voice/faithfulness gates) behaves identically to the flywheel-main origin/preview source.** | **Medium** | internal-data | Engine confirmed present at origin/preview (PRs #1668–1684); ported verbatim with production bug-fix scars preserved (faithfulness 12s timeout + 25-claim cap; voice 3s timeout; `drafter !== verifier` invariant). | **Golden-set regression: capture Whispering Willows as a human-labeled corpus (Phase 0); assert ported gate reproduces expected Stage-A clean/veto + Stage-B verdict bands before any prompt is written, and on every kernel change.** | James |

*References: ch. 15, ch. 17 (bible v1.0.0, sha: 2c02fe80)*

---

## 16 · What success looks like

Success is defined against the north-star KPI — **AI-answer-engine citation / share-of-model** — paired with the operational truth that, under a hard gate, **release (not generation) is the bottleneck.** Leading indicators stage the proof: first that the moat works (gate refuses correctly), then that the artifact is visible (cited), then that the loop is economical (cost + reviewer throughput at quality).

**30-day leading indicators (the moat is real)**
- Phase-1 thinnest slice green: one YMYL Whispering Willows piece generates, runs the real two-stage gate, and is **provably blocked from `published`** without `verdict==='PUBLISH'` AND `evalRan===true` AND a recorded human release AND (YMYL) a server-resolved credentialed byline + citations.
- Golden-set regression in place: the ported gate reproduces the expected Stage-A clean/veto on the Whispering Willows corpus; cross-tenant `SELECT` returns zero rows.
- The gate-block-by-sourcing metric is emitting (the D3 reversal trigger is instrumented from day one).
- A live demo where the gate **blocks** a Stage-A-tripping draft with a stable code and `score=null`, then passes a fixed brief to Stage-B — and a `PUBLISH` verdict still sits at `draft` until a human releases. "Harness, not write-my-blog-toy" is demonstrable.

**60-day leading indicators (the artifact ships and is visible)**
- D6 resolved: a named credentialed reviewer + named backup + pages/week ceiling (OQ-1) — the go-live gate is unlocked.
- **First paid pilot live**: a full Whispering Willows hub (homepage + pillar + cluster) renders SSR with body in initial HTML, valid FAQPage JSON-LD, no leaked placeholder tokens; CI reachability gate green both directions.
- Client review loop closes end-to-end: a pinned "Request changes" comment becomes an agent edit → new version → re-gated diff; sign-off recorded as a named, undeletable version.
- Share-of-model instrumentation live: hub pieces tracked for citation frequency across ≥3 AI answer engines; baseline captured. **Per the hybrid channel model (DR-038 addendum), the baseline keeps the two signals distinct — a `direct-citation`/`vendor` citation rate vs. a `direct-proxy` "API-answer mention rate (proxy)"; a proxy mention is never reported as a won citation.**
- Per-asset cost measured from the live SEO ledger (OQ-2 calibration begins).

**90-day leading indicators (the loop is economical at quality)**
- Multi-client tenancy proven: a second client runs a full hub end-to-end with a cross-tenant leak test passing — zero voice/fact bleed across namespaces.
- Measured per-asset cost (incl. reviewer time) sets pricing; per-piece/seat pricing locked (OQ-2 resolved).
- Approval-debt KPI (open-thread count + approval-cycle time per client) is the binding-constraint dashboard; reviewer saturation is visible before it stalls the pipeline.
- D3 call made on data: gate-block-by-sourcing rate either confirms DDG grounding is sufficient or triggers the funded-SERP-API reversal (OQ-3 resolved).
- Kill-switch demonstrably unpublishes a live piece (instant 410 + noindex + Search Console Removals); a wedged loop triggers a heartbeat alert, not a silent stall.

**12-month outcome**
- **Measurable share-of-model:** Whispering Willows hub pieces are cited by AI answer engines for target memory-care queries at a rate that moves with a client-outcome metric — the GEO thesis proven in the real vertical, not just instrumented.
- **Throughput at quality:** the engine sustains a publish cadence bounded by reviewer capacity (not by gate self-vetoes), with the per-asset cost inside a margin that makes per-piece SaaS viable.
- **The wedge held or deepened:** governance (refuse-to-publish) remains differentiated; if an incumbent added a gate, the vertical E-E-A-T depth + reviewer relationship + share-of-model proof in senior-living is the moat that outran them.
- **The asset compounds:** the freshness/refresh-as-a-draft loop and winner-amplification sibling briefs make the hub a growing, gated asset across human readers, crawlers, and answer engines — not a one-shot printer.

*References: ch. 16, ch. 17 (bible v1.0.0, sha: 2c02fe80)*

---

## 17 · Mapping to agentic bible

Every architecture/ops decision in this PRD traces to a chapter of the agentic bible (v1.0.0, sha `2c02fe80`). Deviations are where SEO Creator's commercial/YMYL shape required going beyond or against the bible's default guidance — chiefly that the kernel is **ported verbatim from flywheel-main origin/preview**, not authored fresh, and that the D5 self-hosted-worker topology splits the runtime across two deploy targets.

| Bible chapter | PRD sections citing | Version pinned | Deviations |
|---|---|---|---|
| **01 — anatomy** | §1 Architecture overview, §3 Artifact model | v1.0.0 / 2c02fe80 | None — the worker/orchestration/render split maps cleanly to the standard agent anatomy. |
| **02 — tools** | §1 Architecture, §8 Capabilities | v1.0.0 / 2c02fe80 | Tools are **host-side and read-only for scoring** (`runGate`); mutation tools (`persistPiece`) are host-validated and keys never reach the agent — stricter than the default. |
| **03 — permissions** | §14 (cross-tenant leakage, SSRF), §1 tenancy | v1.0.0 / 2c02fe80 | Tenancy is a **hard fail-closed boundary** (RLS + tool keying to one `workspace_id`/`client_id` + no default-voice fallthrough), not an advisory scope — the #1 agency-ending risk forces this. |
| **04 — context** | §2 Interface/UX (streaming canvas), §3 brief-first checkpoint | v1.0.0 / 2c02fe80 | Context (the brief) is human-reviewed at a checkpoint before the 2,200-word draft; fetched content treated as untrusted data, never instructions. |
| **05 — system-prompt** | §15a (ported-engine fidelity), Phase 0 golden set | v1.0.0 / 2c02fe80 | **Deviation:** there is no net-new system-prompt authoring — the worker **runs the existing four-skill `seo-copywriter` suite directly** (real `SKILL.md` skills, kernel-backed via the `/content/api/*` routes), golden-regressed; the drift surface is the model + tool-order + skill config, not free-written prompts. |
| **06 — delegation** | §1 Architecture (worker topology, D5/D9) | v1.0.0 / 2c02fe80 | **Deviation:** the autonomous loop runs in a separate self-hosted Agent-SDK worker on Vercel Sandbox (not in-process); streaming spans worker → apps/seo → browser. Driven by the D5 override. |
| **07 — extensibility** | §15a (ported engine), build sequencing | v1.0.0 / 2c02fe80 | **Deviation:** the deterministic kernel (gate, FSM, 22 scorers) is **ported verbatim from flywheel-main origin/preview, not reinvented** — extensibility is reuse-first, against the build-fresh default. |
| **08 — doctrines** | §14 mitigations (host-enforced gate), wedge framing | v1.0.0 / 2c02fe80 | None — "the harness is the moat, the model is the replaceable middle" is the bible's framework-to-platform doctrine applied directly. |
| **09 — modes-state** | §4 lifecycle/kill-switch, §14 (Sandbox state-loss, reviewer chokepoint) | v1.0.0 / 2c02fe80 | **Deviation:** ephemeral Sandbox forces **all state to Supabase as system of record** (never the worker FS across runs); the fail-closed publish transition is both the lifecycle chokepoint and the kill switch. |
| **10 — failure-modes** | §14 Risks and mitigations (all rows) | v1.0.0 / 2c02fe80 | None — the risk table is structured directly on the failure-modes taxonomy; YMYL/tenancy failures are the designed-against harms. |
| **11 — checklist** | §16 success leading indicators, Phase DoDs | v1.0.0 / 2c02fe80 | None — DoD gates and 30/60/90 indicators follow the readiness checklist. |
| **13 — observability** | §14 (drift, Sandbox, reviewer), §16 (heartbeats, kill-switch) | v1.0.0 / 2c02fe80 | Adds **gate-block-by-sourcing rate** and **approval-debt** as first-class product metrics beyond standard cost/latency observability — the D2×D3 tension and reviewer-bottleneck demand them. |
| **14 — framework-to-platform** | §14 (AirOps displacement), §15a (moat), positioning | v1.0.0 / 2c02fe80 | None — vertical E-E-A-T depth + opinionated FSM as the platform moat vs. a horizontal toolkit is the canonical framework-to-platform move. |
| **15 — judge-pattern** | §14 (YMYL faithfulness, gate), §15a (wedge) | v1.0.0 / 2c02fe80 | **Deviation:** the non-compensatory gate is **hard fail-closed** (Stage-A vetoes short-circuit to `score=null`) with a **cross-model `drafter !== verifier` invariant** — stronger than the bible's compensatory-judge default, because YMYL content has no compiler. |
| **16 — control-plane** | §15 open questions, §16 (cost ledger, approval-debt) | v1.0.0 / 2c02fe80 | Adds a **separate AI-Gateway SEO ledger** (cost-per-asset incl. reviewer time) and a reviewer-capacity control as the binding constraint — control-plane extended for the commercial margin model. |
| **17 — evals-learning-loop** | §14 (methodology drift, D2×D3), §15 (OQ-3), §15a, §16 | v1.0.0 / 2c02fe80 | **Golden-set discipline is non-negotiable** under D1's autonomy (capture before any prompt); the D3 reversal is a data-triggered eval-loop decision — the learning loop is load-bearing, not optional. |

*References: ch. 01, ch. 06, ch. 07, ch. 09, ch. 14, ch. 15, ch. 16, ch. 17 (bible v1.0.0, sha: 2c02fe80)*
