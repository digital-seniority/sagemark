# Discovery Log — SEO Creator

*Phase 3 output. Condensed discovery: the approved plan (`../00`–`../06`, `../DECISIONS.md`)
pre-answered most domains; this log records the playback interpretations + the live
interview on the genuine gaps. Canonical state: `flywheel.manifest.json`.*

## Domain 1 — Intent & strategic

- **Wedge** (evidence: **strong** — Phase 2 web research): No shipping competitor can
  *refuse to publish* on faithfulness/YMYL grounds. The field is crowded on generation,
  funded on GEO measurement (AirOps $40M, Profound $35M), and **empty on governance**.
  *Per ch. 15 (judge pattern) + ch. 17 (evals).*
- **Moat** (evidence: **medium**): opinionated fail-closed lifecycle FSM + vertical
  senior-living E-E-A-T depth + per-client voice corpus. Defensible vs a horizontal
  toolkit; AirOps is the displacement risk (could add a gate). *Per ch. 14, ch. 16.*
- **Validation** (evidence: **strong**): **Whispering Willows is a real client
  engagement** — the demo reflects real client work, not a spec. Trigger-3 (no-validation)
  does NOT fire.
- **Audience**: senior-living marketing agencies/operators; beachhead = memory care.

## Domain 2 — User & product

- **Personas**: *operator* (agency editor — shapes briefs, releases pieces), *client*
  (reviews/signs off the hub), *credentialed reviewer* (holds YMYL release authority).
- **JTBD**: "produce a search- and AI-visible, trustworthy content hub for a YMYL
  senior-living client that won't get deindexed or embarrass the brand." Today done by
  hand or by ungoverned AI tools that need heavy editing. *Per ch. 02, ch. 05.*
- **Capabilities** (evidence: **strong** — docs 02/03): autonomous brief→draft→gate→render
  loop; per-client voice; hub (pillar + funnel-staged cluster) generation incl. the
  resource-library homepage; conversational fine-tune; on-screen client feedback;
  share-of-model instrumentation.

## Domain 3 — Technical & AI

- **Runtime**: Claude Agent SDK self-hosted worker on Vercel Sandbox (D5/D9); `apps/seo`
  on Vercel = thin UI + orchestration. *Per ch. 06 (delegation/subagents), ch. 09 (modes/state).*
- **Judge/gate**: host-enforced non-compensatory gate (Stage-A vetoes → Stage-B 8-dim
  composite) + 22 scorers + cross-model faithfulness, ported from `origin/preview`. The
  agent gets read-only scoring tools; cannot reason past a veto or `canPublish()`.
  *Per ch. 15, ch. 03 (permissions).*
- **Knowledge/grounding**: brief sources via DuckDuckGo scraping (D3); per-client voice
  specs as grounding corpus. *Per ch. 04 (context), ch. 02 (tools).*
- **Multi-tenancy**: Supabase, `workspace_id` + `client_id`, fail-closed RLS (anon
  SELECT only `status='published'`). *Per ch. 14, ch. 16.*

## Domain 4 — Operational

- **Lifecycle**: fail-closed publish (verdict=PUBLISH AND recorded human release AND
  eval-ran; YMYL adds named author + credentials + citations). *Per ch. 09, ch. 17.*
- **State**: Vercel Sandbox is ephemeral → all per-run session/agent/working-dir state
  persists to Supabase (system of record), never the Sandbox filesystem.
- **Observability**: gate metrics + a separate SEO cost ledger via AI Gateway. *Per ch. 13.*
- **Kill switch**: publish transition is the chokepoint; disabling release halts all
  public output without stopping drafting.

## Domain 5 — Risk & safety

- **YMYL governance**: provable byline/credentials/citations + disclaimers as hard
  publish preconditions (market-validated by the CNET/SI/Google-AIO cautionary tales).
- **Cross-tenant leakage / voice bleed**: the **#1 agency-ending risk** — fail-closed
  tenancy boundary, no default-voice fallthrough. *Per ch. 03, ch. 10 (failure modes).*
- **Public ingestion surface**: the web-fetch brief route (SSRF / prompt-injection from
  fetched pages) — covered in the RFC despite the system being private-by-default.
- **D2×D3 tension**: hard gate + thin DDG grounding → high self-veto on YMYL drafts;
  instrument the gate-block-by-sourcing rate as the D3 reversal trigger.

## Domain 6 — Constraints

- Existing Sagemark monorepo (`apps/*`, `packages/*`, `@sagemark/core`); ported engine
  collapses build cost to ~4 producer prompts + the worker topology + transport.
- Phase-1 scope inflated by D1 (autonomous) + D2 (gate/FSM/reviewer queue) + D5 (worker +
  transport) + D7 (homepage + `clusterRole`/`funnelStage` schema migration).
- Timeline/budget/team: not pinned (solo founder + agents); sequence the thinnest
  end-to-end slice first.

## Live interview — the gaps (verbatim)

**Q (Validation, BLOCKING):** Customer validation? → **A: Whispering Willows is a real
client engagement.** *Interpretation: strong validation; commercial audit proceeds.*

**Q (Pricing/wallet, D4):** Pricing/packaging + wallet model? → **A: Per-seat / per-piece
SaaS + separate ledger.** *Interpretation: productized SaaS pricing; separate AI-Gateway
SEO ledger measures cost-per-asset (incl. reviewer time) — the margin input.*

**Q (D6, BLOCKING for go-live):** Credentialed YMYL reviewer capacity + backup? → **A: Not
staffed yet — log as the #1 go-live open-question.** *Interpretation: blocking open-question
+ launch-gating risk; build proceeds, YMYL publish cannot go live until resolved.*

**Q (North-star KPI):** Primary success metric? → **A: AI-answer-engine citation /
share-of-model.** *Interpretation: instrument hubs for answer-engine citation as the
north-star; pair with a client-outcome metric later.*

## Mid-domain synthesis (confirmed)

- After D1→D2: "the wedge is governance, not speed; the moat is the FSM + vertical depth"
  — confirmed by the research and the founder's framing.
- After D5: "the binding constraint at go-live is the credentialed reviewer (D6), not
  tokens or infra" — confirmed; logged as the top open-question.

## Open questions (carried to PRD §15)

1. **D6 — credentialed YMYL reviewer + backup** (owner: James; resolve before any YMYL
   client goes live). BLOCKING for go-live, not for build. Target: specialist-review.
2. **Per-asset cost / pricing calibration** (owner: James; resolve via the separate SEO
   ledger after the first cluster). Target: internal-data.
3. **D3 reversal trigger** — if gate-block-by-sourcing rate is the top blocker after the
   first cluster, fund a SERP/retrieval API. Target: internal-data.
