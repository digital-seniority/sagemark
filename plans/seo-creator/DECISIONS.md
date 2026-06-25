# Locked Decisions — SEO Creator

The authoritative record of what we're building. The numbered docs (00–06) hold
the *analysis and options*; this file holds the *resolved calls*. Where James
overrode the plan's recommendation, it's marked **[OVERRIDE]** with the
consequence spelled out. Decided 2026-06-25.

## The calls

| # | Decision | Locked choice | Source |
|---|---|---|---|
| **D1** | Agent autonomy | **Full autonomous `ToolLoopAgent`** — the agent self-directs fetch→outline→draft→verify→revise→gate | **[OVERRIDE]** James (plan recommended fixed pipeline) |
| **D2** | Gate posture | **Hard fail-closed gate** — Stage-A vetoes short-circuit; named-author/credentials/citations are a hard stop | James (matches recommendation) |
| **D3** | Grounding source | **Keep free DuckDuckGo scraping** for now | **[OVERRIDE]** James (plan recommended funding a SERP API) |
| **D4** | Wallet / cost | Separate SEO ledger via AI Gateway usage | Default (recommended) — not yet contested |
| **D5** | Harness runtime | **Claude Agent SDK (self-hosted worker)** — run the real Claude Code harness (autonomous loop + subagents + hooks + `SKILL.md` skills) as a long-lived worker container; `apps/seo` on Vercel orchestrates it | **[OVERRIDE]** James (plan recommended native AI SDK v6 in-process) |
| **D6** | Reviewer capacity + backup | **PENDING — James must supply a number + a name** | Open — no engineering default |
| **D7** | Generated hub homepage | **Generate it in v1** (curated resource-library homepage as a real artifact) | **[OVERRIDE]** James (plan recommended hand-building for the pilot) |
| **D8** | Client-review hosting | In-app tokenized route (one piece/version, fail-closed RLS) | Default (recommended) |

## What the four overrides change

**D5 — Claude Agent SDK self-hosted worker (supersedes the runtime pick in docs 00/01).**
This is the most architecturally consequential override. The plan recommended a
native AI SDK v6 loop running in-process on a Vercel route (Approach B); James chose
to run the **real Claude Code harness as a library** instead. Verified fact (current
docs): the Claude Agent SDK **spawns and supervises a `claude` CLI subprocess** with
a shell + on-disk working directory and is a long-lived, stateful process — it does
**not** run in a Vercel serverless function. Consequences:
- **Topology splits in two.** `apps/seo` (Vercel) becomes a thin UI + orchestration
  API; a **separate long-running Agent-SDK worker container** runs the autonomous
  loop. Host the worker on Modal / Trigger.dev / Vercel Sandbox / Bedrock AgentCore /
  a plain Node container — **this is a new open decision (D9, below).**
- **The gate/scorers/DB are exposed to the worker as host-side tools**, not rebuilt.
  The worker's loop calls back into the deterministic kernel (the ported `seo-gate`,
  22 scorers, `canPublish()`, Supabase writes) as tools the agent cannot reason past —
  same fail-closed property as every other runtime, now enforced at the worker→host
  tool boundary.
- **The SEO `SKILL.md` skills are the native unit** the SDK consumes — closest thing
  to "keep the harness we love." But our skills are *kernel-backed* (thin `SKILL.md`
  delegating into host code), so the kernel still rides as host tools; the win is the
  loop + subagents + hooks + context compaction, not zero wiring.
- **D5 delivers D1 for free.** The Agent SDK's built-in autonomous loop *is* the
  `ToolLoopAgent` D1 asked for — we no longer hand-build it. The two decisions
  consolidate.
- **Streaming spans a hop.** Worker → `apps/seo` → browser. The worker emits SDK
  events; `apps/seo` relays them as SSE to the three-zone canvas. Plan this transport
  in Phase 1.
- **No beta dependency, no Anthropic-only lock-in** (the SDK can even run on Bedrock).
  The cost is the worker ops surface Vercel doesn't natively give us + the SDK's
  coding-agent-shaped defaults (shell/filesystem workspace).

**D1 — autonomous loop.** The runtime is a real tool-using `ToolLoopAgent`, not a
fixed sequence (now **provided by the D5 Agent SDK**, not hand-built). Consequences
to honor:
- The gate stays **host-enforced outside the loop** — the agent gets a read-only
  `runGate` tool and can never reason past a Stage-A veto or `canPublish()`. D1
  does not soften D2.
- Nondeterminism is now the dominant failure surface. The **golden-set discipline
  is no longer optional**: capture the live Whispering Willows hub as a
  human-labeled golden set *before* writing a prompt, and regress every
  prompt/model/tool-order change against it. This is the only guard against silent
  methodology drift in an autonomous loop.
- Expect more model round-trips per piece → higher per-asset cost and latency.
  This makes D4 (a real per-asset ledger) more important, not less.

**D7 — generated homepage.** Promote `clusterRole` / `funnelStage` to **first-class
schema columns in Phase 1** (the ported `content_pieces` schema persists neither
pillar↔spoke edge today). This is a Phase-1 migration, not a Phase-3 deferral, and
it drives the generated homepage + related-guides nav.

**D3 — free scraping (see tension below).** No new budget line; the brief route
keeps scraping 3 DDG HTML pages behind the existing `brief.sources` contract.

## Two tensions on the record

### ⚠️ D2 (hard gate) ↔ D3 (thin grounding) — the binding one

The hard faithfulness gate and the `UNSOURCED_STAT` Stage-A veto are only as good
as `brief.sources`. DuckDuckGo scraping (3 pages × 2,000 chars) is too thin to
ground memory-care medical claims to the named authorities the artifact promises
(Alzheimer's Association, NIA). **Combined, these mean the engine will frequently
veto/revise its own YMYL drafts** — the gate doing its job correctly, but grounding
becoming the throughput bottleneck rather than the model.

This is a defensible lean-startup posture *if we measure it*. **Mitigation (build
into Phase 1):** instrument the share of gate-blocks attributable to sourcing
(`UNSOURCED_STAT` + low faithfulness from thin sources). If sourcing is the top
blocker after the first cluster, D3 flips to "fund a SERP API" — engineering wires
either behind the same contract, so the reversal is cheap. D3 is thus a **measured,
reversible** call, not a permanent one.

### ⚠️ Phase-1 scope inflation — D1 + D2 + D5 + D7 stack

Each override/confirmation adds to v1: the autonomous loop (D1, now via the SDK),
**standing up the Agent-SDK worker + worker↔Vercel↔browser transport (D5)**, the FSM +
credentialed-reviewer queue + server-side byline resolution (D2), and a `clusterRole`/
`funnelStage` schema migration + generated homepage template (D7). Phase 1 is now
materially heavier than the recommended-path Phase 1 — and D5 adds a second deploy
target. Recommend sequencing the **thinnest end-to-end slice first** (one piece:
brief → autonomous draft on the worker → host-enforced gate → render → one fine-tune
turn → gated version) and adding the homepage generation + multi-piece hub *after*
that slice is green, so the worker topology, autonomous loop, and hard gate are proven
before the surface area widens.

## Still needed from James

- **D9 — where the Agent-SDK worker runs (new, opened by D5).** The self-hosted
  harness needs a long-lived container host. Candidates: **Vercel Sandbox** (closest
  to the rest of the stack, ephemeral microVMs), **Modal** or **Trigger.dev** (purpose-
  built for long agent jobs, durable), a **plain Node container** (Fly/Render/ECS), or
  **Bedrock AgentCore** (if AWS-aligned). This decides the worker's persistence,
  scaling, and per-run cost model, and gates the Phase-1 transport design. No default
  yet — needs a call before the worker is stood up.
- **D6 — reviewer ceiling + backup name.** With D2 = hard gate, the credentialed
  reviewer is the binding constraint on YMYL publish rate. No YMYL page should go
  live until a backup-reviewer path exists. This is a number (pages/week one
  reviewer clears) + a name (the backup). Needed before Whispering Willows go-live,
  not before the build starts.
- **D4 confirm.** Separate SEO ledger via Gateway is the default; confirm you don't
  want to reuse the VideoGen credits wallet.

Everything else (D8) stands at the recommended default unless contested.
