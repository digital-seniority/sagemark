# SEO Creator — Plan

The plan for Sagemark's first app: **`apps/seo`**, an agent-driven engine that
produces and governs **SEO/GEO content hubs** (a pillar page + a funnel-staged
cluster of long-form, E-E-A-T-grade guides) for agency clients — many of them
YMYL (memory care, finance, health).

Reference artifact (the real output, not a brochure site):
<https://whispering-willows-content-demo.vercel.app/>

## The headline decision

Build as a **native AI SDK v6 agent loop** in a new `apps/seo` service, and
**port — not reinvent — the deterministic moat** that already exists on
`origin/preview` (PRs #1668–1684): the 22 scorers, the cross-model faithfulness
gate, the non-compensatory `seo-gate`, the fail-closed `lifecycle-fsm`, and the
`content_pieces`/`voice_specs` Drizzle schema. Re-author only the four producer
prompts (strategist, assistant, writer, audit). The UI reuses videogen's agent
canvas (`PinOverlay`, `PreviewClickHandler`, `useIframePinDrop`, `VersionHub`,
`ApprovalBeat`). The model is the replaceable middle; **the harness is the moat.**

> All load-bearing claims above were verified against git: the engine exists on
> `origin/preview` (local schema stops at `0029`), and the trailhead model seam
> (`resolveGatewayModel` + `CostAccountant`) and videogen UI primitives are
> present in the tree.

## Documents

> **Locked calls live in [DECISIONS.md](DECISIONS.md)** — James resolved D1/D2/D3/D7
> on 2026-06-25 (three overrode the plan's recommendation). The docs below are the
> *analysis*; DECISIONS.md is the *resolution* and the build's source of truth.

| # | Doc | What it covers |
|---|---|---|
| — | [**DECISIONS.md**](DECISIONS.md) | **The locked D1–D8 calls + the two flagged tensions** (authoritative) |
| 00 | [Vision & Top-Level Decisions](00-vision-and-decisions.md) | North star, the decisions table, **the five questions answered**, what "on-thesis" means |
| 01 | [Architecture](01-architecture.md) | Agent runtime, harness port, request/stream lifecycle, data model, inter-service calls |
| 02 | [Interface & UX](02-interface-and-ux.md) | The three-zone agent canvas, streaming, conversational fine-tune, UI states |
| 03 | [Artifact Model](03-artifact-model.md) | The content-hub data shape, piece archetypes, render/version/export, template vs client-specific |
| 04 | [Client Presentation & Feedback](04-client-presentation-and-feedback.md) | Hosted preview, pinned comments, section approve/request-changes, sign-off |
| 05 | [Build Roadmap](05-build-roadmap.md) | Phased MVP→v1, what to port first, milestones, thinnest end-to-end slice |
| 06 | [Open Decisions for James](06-open-decisions.md) | The 8 calls only the founder can make (D1–D8) |

`_decision.json` is the raw architect decision object (machine-readable reference).

## The five questions (quick answers)

1. **Interface** — a three-zone agent canvas: Agent chat (streams real token
   deltas + tool use) · rendered-piece preview · Inspector showing the two-stage
   gate scorecard. Brief-first, behaves like the Claude harness.
2. **Output artifact** — a `content_piece` (long-form E-E-A-T markdown article
   with cluster role, FAQ schema, citations, named byline); the deliverable is a
   **cluster of ~8 forming a hub**.
3. **Resembles prior work** — yes: the `apps/agents` content engine + the
   videogen agent canvas. **Not** the removed retirement-pilot brochure.
4. **Client presentation** — a tokenized, workspace-scoped hosted live preview of
   the actual SSR-rendered hub (full body in HTML, FAQ JSON-LD), plus a
   SERP-snippet preview.
5. **Client feedback** — on the preview itself: pinned comments anchored to page
   elements + section-level Approve/Request-changes; "Request changes" routes
   straight into the agent's edit loop as a new gated version.

## Status & next step

Plan authored 2026-06-25 via a 17-agent research/synthesis workflow, then
git-verified. **D1/D2/D3/D5/D7 are locked** (see [DECISIONS.md](DECISIONS.md)) —
notably **D5 = Claude Agent SDK self-hosted worker** (overrides the in-process AI SDK
runtime in docs 00/01: `apps/seo` on Vercel orchestrates a separate Agent-SDK worker
container that runs the autonomous loop and calls host-side tools for the gate).
**D9 = Vercel Sandbox** (the worker host) is now locked too. **Still open:** **D6**
(reviewer ceiling + backup name), **D4** (ledger confirm) — neither blocks the build.
**Next:** run the plan through `plan-flywheel` to compile a build-ready, audit-passed
PR map for the worker↔Vercel slice.
