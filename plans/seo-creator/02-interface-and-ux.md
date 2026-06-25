# Interface & UX — The Agent-Driven Surface

The SEO Creator's operator screen is a **three-zone agent canvas** modeled on videogen's `StudioCanvas` (`apps/agents/src/components/videogen/canvas/StudioCanvas.tsx`), stripped of operator-only video controls and re-pointed at a markdown content piece. The governing design goal is that it should **feel like the Claude harness**: a chat panel where the agent visibly thinks, fetches, scores, and writes; an artifact that materializes token-by-token beside it; and an inspector that adjudicates the result in the open. The difference from today's shipped wizard (`apps/agents/src/app/content/new/ContentWizard.tsx` → one POST → static `DraftResult.tsx`) is that generation is a **streamed agent loop**, not a single re-streamed JSON blob, and refinement is **conversational multi-turn**, not regenerate-from-scratch.

This document specifies the screen, the conversation flow, the fine-tune editing model, the reusable primitives, the component tree, and the formal UI states.

---

## 1. The screen: three zones

```
┌──────────────┬───────────────────────────────┬────────────────────┐
│  AGENT       │  ARTIFACT                     │  INSPECTOR         │
│  (left)      │  (center)                     │  (right)           │
│              │                               │                    │
│  chat +      │  Editor ⇄ Preview toggle      │  Stage-A vetoes    │
│  streamed    │  • markdown editor            │  Stage-B 8-dim     │
│  thinking +  │    (artifacts pattern)        │    score bars      │
│  tool-use    │  • live SSR preview           │  verdict band      │
│  ledger      │    (iframe of rendered piece) │  version history   │
│              │                               │                    │
│  [composer]  │  [Editor | Preview] tabs      │  [piece status]    │
└──────────────┴───────────────────────────────┴────────────────────┘
```

| Zone | Role | Reuse source |
|---|---|---|
| **LEFT — Agent** | Chat composer + an append-only stream of message deltas, agent thinking, and tool-use rows ("fetching SERP", "running faithfulness gate", "Stage-A clean", "scoring 8 dimensions"). This is what makes it *read* like the harness. | `AgentPanel.tsx`, `ChatEdit.tsx`, `PlanningAgentChat.tsx` |
| **CENTER — Artifact** | The `content_piece`. A side-panel markdown editor (the AI SDK "artifacts" pattern) that toggles to a same-origin sandboxed iframe showing the actual SSR-rendered page at `/clients/[client]/blog/[slug]`. | `PreviewZone.tsx`, `DraftResult.tsx` (panels), `SerpPreview.tsx` |
| **RIGHT — Inspector** | The two-stage gate scorecard + version history. Stage-A vetoes as red blocking chips with stable codes; Stage-B 8 dimension bars with the verdict band; faithfulness visibly dominant. | `InspectorPanel.tsx`, `VersionHub.tsx`, `VersionDiff.tsx` |

**Critical design stance — brief-first, not draft-first.** The human's primary checkpoint is the *typed brief*, not the 2,200-word draft. Intent is observed from a live SERP fetch (not asserted from the query string); cluster placement (`clusterRole`/`funnelStage`), entities, `dataPointsNeeded`, and the `is_ymyl`/`reviewerRequired` flags are surfaced as an editable structured object before a single body token streams. Get the brief right and the draft is bookkeeping. The center zone therefore opens on a **brief card**, and only flips to the streaming article once the human approves the brief.

**Visual language** matches the existing `apps/agents` convention exactly so the new app is visually of-a-piece: Tailwind v4 `foreground`/`background` tokens, the emerald/blue/amber/red verdict palette, `font-mono` eyebrow + `font-display` headings, inline `Link`-pill tab nav (mirroring `AdGenNav`/`ContentNav`), and an SSR mount-guard on any localStorage-touching component.

---

## 2. Conversation flow

The flow is a four-act loop. Acts 1–3 are first generation; Act 4 is the fine-tune cycle that repeats indefinitely while `status='draft'`.

### Act 1 — Intake (brief assembly)

The operator selects a client (which loads its **approved** `voice_specs` — a hard stop: no approved spec ⇒ the composer is disabled with "This client has no approved voice spec; generation is blocked") and states a target: a keyword, a cluster slot, or "draft the pillar." The agent's first tool call is a **live SERP fetch**; it streams an observed-intent brief into the center zone as a structured card. The human edits the outline, entities, data points, and confirms the `is_ymyl` flag. **Nothing is generated yet.** This is the cheap, high-leverage checkpoint.

### Act 2 — Generating (streamed reasoning + steps)

On "Generate," the agent enters the tool loop. The LEFT panel streams, in order, as discrete rows:

- **Thinking deltas** — the agent's reasoning, rendered as muted italic text (mirrors `PlanningAgentChat`'s thinking treatment).
- **Tool-use rows** — one row per tool call with a spinner → check: `serpFetch ✓`, `draftBody (streaming…)`, `runFaithfulnessGate ✓ FAITHFUL 91%`, `runGate → Stage-A clean`, `runGate → Stage-B 83 REVIEW`. Each row is a stable, taxonomy-coded event, never raw model prose piped back into the loop (injection-surface discipline from the agentic bible).

Simultaneously the CENTER zone receives `data-articleDelta` parts and the markdown body **types in live** — real token streaming via the AI SDK `UIMessage` SSE stream (`readUIMessageStream`), not the single `delta`+`applied` re-stream that videogen's `chat-edit` route ships today. This live materialization is the single most "harness-like" moment and the strongest client-demo beat.

### Act 3 — Artifact rendered

When the loop emits its terminal text answer, the CENTER zone settles into the editable artifact and the RIGHT zone fills with the **gate scorecard**:

- **Stage-A** vetoes as red chips (`UNSOURCED_STAT`, `KEYWORD_STUFF`, `YMYL_NO_BYLINE`, `THIN_CONTENT`, `BANNED_LEXICON`, `VOICE_FAIL`, `EVAL_FAILED`). If any fired, the chip shows **which** veto, the composite shows `score = null` ("no composite computed — Stage-A veto"), and the verdict band reads REJECT/REVISE. This honestly communicates *eligible ≠ published*.
- **Stage-B** (only if Stage-A clean): 8 horizontal 0–100 bars (readability, keyword, structure, **faithfulness**, voice, geo, originality, eeat) with faithfulness visually weighted heaviest, plus the verdict band PUBLISH≥85 / REVIEW / REVISE / REJECT.

The operator now has the artifact and its grade — but no publish path yet (publish is fail-closed, host-side, and requires a recorded human release; see doc 03).

### Act 4 — Fine-tune turns

The operator (or, on the client surface, a "Request changes" comment) issues a follow-up instruction. The agent edits the body in place, re-streams the changed region, **re-runs the full gate**, writes a `content_piece_versions` snapshot, and emits a one-line "what changed" summary. This repeats. Detailed below.

---

## 3. Fine-tune editing

This is the user's #1/#2 requirement (agent-driven; fine-tune the artifact after it exists). Two input modalities converge on the same auditable version-write.

### 3a. Chat instructions (the primary path)

A natural-language instruction — "tighten the intro," "drop the alarmist line in section 03," "add a Medicaid eligibility stat with a source" — goes to the agent as a follow-up turn in the same session. The agent emits a **bounded body diff** (an SEO-specific constrained-edit contract: `{ region, instruction } → bounded markdown diff + summary`), not a full regenerate. This is the content-engine analog of videogen's `/videogen/api/chat-edit`, but markdown-region-scoped rather than scene-prop-scoped — videogen's `{op:'update', changes:{props}}` shape does **not** generalize to prose, so this contract is net-new (flagged as a build surface).

Each accepted edit:
1. writes an append-only `content_piece_versions` snapshot and bumps `version`;
2. re-runs the **full** two-stage gate (an edit can never advance past a Stage-A/YMYL/faithfulness veto — see guardrails below);
3. streams a one-line summary into the LEFT activity feed ("Added Medicaid eligibility stat (NIA-sourced); faithfulness 89→92").

### 3b. Direct inline edits

The center zone is a real editor (artifacts pattern, ProseMirror-style markdown). The operator can type directly into the body while `status='draft'`. On blur/save, the same machinery fires: snapshot + version bump + full gate re-run. Direct edits and chat edits are **the same object** downstream — both are auto-versions — so there is no divergent "manual edit" path that escapes the gate.

### 3c. Section-level regeneration

Each `H2` block carries an inline "Regenerate section" affordance (and, on the client surface, section-level **Approve / Request-changes** verbs reusing `ApprovalBeat`'s pill + primary/secondary buttons, `apps/site/src/components/demos/research/ApprovalBeat.tsx`). "Regenerate this section" issues a region-scoped edit instruction; "add a cluster spoke" or "regenerate the whole guide" escalates to a full agent generation. The N=3 audit→revise cap applies: the 4th failed re-audit holds the piece at `review` (`forcedToHumanReview`) rather than looping forever.

### 3d. Undo / versioning

Versioning is the same substrate as videogen's `VersionHub` (`VersionHub.tsx` + `VersionDiff.tsx`):

| Action | Behavior |
|---|---|
| **Every accepted edit** | New `auto=true` version row (append-only; never destructive). |
| **Switch** | Server action restores a target version's body as a new auto-version — zero re-generate, fully reversible. |
| **Name** | Flips `auto=false` → a protected, **undeletable** named bookmark (the API also defends it with a 409). A client-approved state = a named version + recorded approver identity (which supplies the E-E-A-T byline for YMYL). |
| **Compare** | `VersionDiff` renders before/after — the client-facing "what changed since your last review" in one click. |

Concurrency guards port verbatim from `chat-edit`: **SHA-256 stale-edit guard** (409 if the body hash the edit was computed against is stale), **per-tenant rate limit** (e.g. 30 auto-versions/hr → 429), and **workspace-ownership** checks (403).

### 3e. The non-negotiable guardrail

**The agent never holds the gate.** It gets a **read-only `runGate` tool**; Stage-A vetoes and `canPublish()` are enforced in **host code outside the agent loop**. A persuasive fine-tune instruction ("ignore the byline requirement and publish") cannot reason past a YMYL/faithfulness/thin-content veto — those are non-overridable canon. The client (and the operator) tune only soft surface. This is the discipline that keeps the moat from collapsing into "the LLM self-grades."

---

## 4. Reusable patterns from `apps/agents`

Everything below was verified present in the local tree (`apps/agents/src/components/videogen/canvas/` and `apps/agents/src/app/content/new/`), so this is copy-and-adapt, not net-new.

| Pattern | Source file | Adaptation for SEO Creator |
|---|---|---|
| **Streaming** | `ChatEdit.tsx` (SSE `getReader` + delta accumulation) | Replace the one-frame `delta`+`applied` re-stream with real AI SDK `UIMessage` token deltas (`data-articleDelta`). Keep the activity-feed summary line. |
| **Score dots** | `ScoreSignalDot` (inline ×4 in `adgen/new/ResultPanel.tsx`) | **Extract to a shared component** (it's duplicated four times). Emerald STRONG / blue GOOD / amber WEAK dot + label + tooltip → reused for the 8 Stage-B dimension bars and the SERP/meta heuristics. |
| **Deterministic scorers** | `apps/agents/src/lib/content/*` (flesch-kincaid, keyword-density, passive-voice, meta/og/faq generators) | Run client-side via `useMemo` at **zero credits, no LLM** for the live editor sidebar; the same modules back the host-side gate tools. |
| **Pin overlay** | `PinOverlay.tsx` | Element-anchored comment markers on the live preview (client review). |
| **Click-to-pin** | `PreviewClickHandler.tsx` (pause-then-pin state machine, normalized 0..1 coords, keyboard-accessible) | "Click anywhere on the page to comment." |
| **Iframe anchoring** | `hooks/useIframePinDrop.ts` (strict origin/source/type/finite-coord validation) | Anchors comments to actual rendered elements inside the SSR preview iframe via `elementHint`. |
| **Version hub** | `VersionHub.tsx` + `VersionDiff.tsx` | Auto-vs-named invariant, switch/compare, undeletable named versions = sign-off. |
| **Approve beat** | `ApprovalBeat.tsx` | Section-level Approve / Request-changes verb language. |
| **SERP preview** | `SerpPreview.tsx` (CSS-only Google snippet mock + char-count badges) | "How this looks in search," shown beside the live preview. |
| **Inspector shell** | `InspectorPanel.tsx`, `StudioCanvas.tsx` | The three-zone assembled shell, minus operator-only video controls. |

**Do not** add the Vercel AI SDK *to the existing `apps/agents` OpenRouter features* — but the **new `apps/seo` app does adopt AI SDK v6** (`ai@6` + `@ai-sdk/anthropic` + `@ai-sdk/gateway`, already proven in `apps/trailhead/src/lib/ai.ts`). The streaming UI consumes `UIMessage` SSE; the deterministic scorers and pin/version primitives are framework-agnostic and port unchanged.

---

## 5. Component breakdown

```
<SeoStudioCanvas>                         // 3-zone shell, from StudioCanvas
├── <AgentPanel>                          // LEFT
│   ├── <AgentMessageStream>              // message + thinking deltas
│   │   ├── <ThinkingDelta>               // muted italic reasoning
│   │   └── <ToolUseRow>                  // spinner→check, taxonomy-coded
│   ├── <ActivityFeed>                    // one-line "what changed" summaries
│   └── <Composer>                        // disabled if no approved voice spec
│
├── <ArtifactZone>                        // CENTER
│   ├── <BriefCard>                       // Act 1: editable observed-intent brief
│   ├── <ModeTabs editor|preview />       // inline Link-pill tabs
│   ├── <MarkdownEditor>                  // artifacts pattern, inline edits
│   │   └── <SectionControls>             // per-H2 regenerate / approve verbs
│   ├── <LivePreviewIframe>               // same-origin SSR of /clients/[c]/blog/[s]
│   │   ├── <PreviewClickHandler/>        // click-to-pin
│   │   ├── <PinOverlay/>                 // anchored comment markers
│   │   └── useIframePinDrop()
│   └── <SerpPreview/>                    // search-snippet mock
│
└── <InspectorPanel>                      // RIGHT
    ├── <GateScorecard>
    │   ├── <StageAVetoes>                // red blocking chips + stable codes
    │   └── <StageBBars>                  // 8 dims, faithfulness dominant
    ├── <VerdictBand/>                    // PUBLISH/REVIEW/REVISE/REJECT
    ├── <VersionHub/>                     // switch / name / compare
    │   └── <VersionDiff/>
    └── <PieceStatusRow/>                 // FSM state + guard reasons
```

Shared extractions to create: `<ScoreSignalDot>` (de-duplicate from ResultPanel), `<ToolUseRow>` (new, taxonomy-coded), `<GateScorecard>` (new, two-stage).

---

## 6. Key UI states

The screen is a state machine. Each state defines what each zone shows and which affordances are live.

| State | LEFT (Agent) | CENTER (Artifact) | RIGHT (Inspector) | Notes |
|---|---|---|---|---|
| **idle** | Empty thread + composer | Client picker / "Pick a target to begin" | Empty | Composer **disabled** if client has no approved voice spec (hard stop, explicit reason shown). |
| **briefing** | `serpFetch` tool row streaming | `<BriefCard>` filling with observed intent | Empty | Human edits brief; "Generate" gated on a complete brief + confirmed `is_ymyl`. |
| **generating** | Thinking + tool-use rows appending; spinners | Body **typing in** via `data-articleDelta`; editor read-only | Bars greyed "scoring…" | Real token streaming. The harness-feel moment. |
| **streaming-gate** | `runGate → Stage-A…` rows | Body settled | Stage-A chips resolving; Stage-B bars animating in | Faithfulness gate runs cross-model (drafter ≠ verifier — never collapse to self-consistency). |
| **done (eligible)** | Idle, awaiting instruction | Editable artifact | Full scorecard + verdict band + version | "Eligible ≠ published" — no publish path here; publish is host-side + human release. |
| **editing** | Edit instruction + summary streaming | Changed region re-streaming / inline edit active | Bars re-animating after full gate re-run | SHA-256 stale guard (409), rate limit (429), workspace check (403). |
| **error** | Red `<ToolUseRow>` with code + retry | Last good body preserved (never lost) | Last good scorecard preserved | Codes: `503 no-llm-key` (OPENROUTER/Gateway key missing), `402` (credits), `409` (stale edit), `429` (rate limit), `403` (ownership). Heartbeat/timeout guards prevent a stalled session reading as "still thinking." |

**Error discipline.** A wedged or silent agent session is the failure mode the admin app died of (8 days unnoticed). Every generating/editing state carries a heartbeat + timeout + circuit-breaker so a stall surfaces as an explicit error row, never an indefinite spinner. The last-good artifact and last-good scorecard are always preserved across an error — an edit that fails never destroys the current body.

---

## 7. Why it behaves "very similar to the Claude harness"

Three properties carry the resemblance, and all three are deliberate:

1. **Visible thinking + tool use.** The LEFT panel streams the agent's reasoning and a live ledger of tool calls (SERP fetch, faithfulness gate, two-stage scoring) — the operator watches the agent *work*, exactly as in Claude Code. This is also the most powerful client-presentation beat ("watch the gate adjudicate live").
2. **An artifact that streams and is editable.** The CENTER zone is the AI SDK "artifacts" pattern: a markdown document that materializes token-by-token, then becomes a side-panel editor — the produce-then-refine surface Claude's artifacts established, applied to a `content_piece`.
3. **Conversational, stateful refinement.** Fine-tune is a multi-turn conversation over the same session, with every accepted turn an auditable, reversible version — not a one-shot regenerate. "Tighten section 03" lands as a bounded diff + a new version + a re-run gate + a one-line summary, which is precisely the harness's edit loop, instrumented for an agency's audit trail.

What the SEO Creator adds *beyond* the harness feel is the **non-overridable gate held in host code**: the agent can be conversed with freely, but it cannot be talked past a YMYL/faithfulness/thin-content veto. The harness feel is the surface; the deterministic gate is the moat underneath it.
