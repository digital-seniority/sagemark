# HANDOFF — SEO Creator

**Status:** Ready for build — Phase 6 complete; Phase 7 retro pending
**Mode:** commercial · **Runtime profile:** claude-code · **Blueprint:** v1.0 · **Bible:** v1.0.0 (sha `2c02fe80`)
**Agent:** `seo-creator` — agent-driven, gate-governed SEO/GEO content hubs for senior-living agencies (lands at `apps/seo` in the Sagemark monorepo)
**Pilot client:** Whispering Willows (live engagement) · **Author:** James (with claude-opus-4-8) · **Date:** 2026-06-25

---

## What's in this packet

| File | Role |
|---|---|
| `prd.md` | Product requirements — positioning, surfaces, capabilities (§5), phasing (§12), risks (§14), open questions (§15), assumption ledger (§15a), bible mapping (§17) |
| `engineering-rfc.md` | Engineering spec — budgets (§1), architecture + topology (§2), data model + 5-layer tenancy (§3), PR slices (§4), lanes (§5), non-eng deliverables (§6), rollout/kill-switch (§7) |
| `journeys.md` | Behavioral journeys — the Phase-1 ship gate (Phase-1 is shippable only when **all journeys pass** AND D6 is staffed). *Phase-6 deliverable* |
| `flywheel.manifest.json` | **Canonical** — mode, locked decisions, review_log, stakeholders, open_questions, research |
| `DECISIONS.md` | Locked D1–D9 (in parent `../DECISIONS.md`) — **authoritative over the analysis docs 00–06** wherever they conflict |
| Review log | Phase-5 6-round adversarial review — recorded in the manifest `review_log` (and surfaced via the PRD §15a appendix) |
| Phase-7 retro | **Pending** — written after this handoff, before build kickoff |

---

## Headlines (the load-bearing decisions)

- **Gate-is-the-wedge governance moat.** The field is empty on governance: across ~12 surveyed products none can *refuse to publish*. SEO Creator wins on a non-compensatory, host-enforced fail-closed gate + cross-model faithfulness check + fail-closed lifecycle FSM — "the model is the replaceable middle; the harness is the moat." Speed is table stakes; refusal is unoccupied ground.
- **Run the existing 4-skill `seo-copywriter` suite DIRECTLY.** A Claude Agent SDK self-hosted worker on a Vercel Sandbox microVM (D5/D9) loads and runs the real `seo-strategist → seo-assistant → seo-blog-writer → seo-audit` `SKILL.md` skills — **not re-authored prompts**. Net-new IP is *wiring*, not an engine.
- **PORT the deterministic kernel + stand up the `/content/api/*` route contract; don't reinvent.** The 22 scorers, faithfulness gate (`drafter ≠ verifier` invariant), non-compensatory `seo-gate`, fail-closed `lifecycle-fsm`, and `content_pieces` schema are ported verbatim from flywheel-main `origin/preview` (PRs #1668–1684) into `@sagemark/core`. `apps/seo` stands up the `/content/api/{brief,draft,audit,publish}` route contract the suite skills orchestrate — the host-side tools the agent can never reason past.
- **Reuse the VideoGen canvas.** The three-zone operator studio + client-review pin-drop UX reuse videogen's `StudioCanvas` / `useIframePinDrop`; imagegen rides in-process for `[photo:]` heroes.
- **North-star KPI = share-of-model** (AI-answer-engine citation, not rank). Hubs are instrumented for citation across ≥3 engines; the artifact is crawlable SSR full-body HTML.

---

## Phasing

- **Phase 0 — Foundations (~0.5 wk):** `git fetch origin preview`; port engine/schema/tenancy; capture the Whispering Willows hub as a human-labeled **golden set** *before any prompt is written*; dry-run the reviewer over it for an early pages/week number. No runtime ships.
- **Phase 1 — Pilot (~9–11 wk):** thinnest end-to-end slice first (brief → single drafter call → host-enforced gate → minimal SSR render → one bounded edit/re-gate → gated version), then widen to the full hub. **Shippable only when all behavioral journeys pass AND the credentialed YMYL reviewer (D6) is staffed with a named backup.**
- **Phase 2 — GA / multi-client scale:** **out of scope for v1** (v1 is one real client end-to-end, not self-serve).

---

## Lanes

`engine-port` (`@sagemark/core` scorers/gate/FSM) · `worker-runtime` (Agent-SDK worker on Vercel Sandbox + host-tool bridge) · `schema-tenancy` (`schema-flywheel` ports + release/signoff split + RLS) · `agent-ui` (`apps/seo` canvas + SSE relay) · `render-geo` (SSR full-body + hub homepage + sitemap/JSON-LD) · `client-review` (tokenized preview + pin/section threads + server-resolved byline).
Critical path: **engine-port → worker-runtime → agent-ui → client-review**; schema-tenancy parallels and must land cluster columns before render-geo's homepage.

---

## Non-engineering blockers

- **NE-1 — Credentialed YMYL reviewer staffed + backup named (D6). The top go-live blocker. Owner: James.** Under the hard gate the reviewer holds release authority on every YMYL piece and is the binding throughput ceiling. Supply a name + a backup + a pages/week capacity number (get the early read by dry-running the reviewer over the Phase-0 golden corpus). No memory-care page ships without it. Date-by 2026-08-15.
- **NE-2 — Whispering Willows content brief + sources** (pillar + ~8 spokes, named authorities Alzheimer's Association/NIA, DSHS license badge, disclaimer text, approved `voice_specs` row). Feeds the Phase-0 golden set + the first piece. Owner: James (with client).
- **NE-3 — Pricing calibration from the live SEO ledger** (per-seat / per-piece SaaS; cost-per-asset incl. reviewer time measured from `seo_cost_ledger` after the first cluster). Blocks commercial launch, not the build. Owner: James.

---

## Open questions before Phase 0

- **D6 reviewer staffing** — name + credential + backup + pages/week ceiling (OQ-1, the binding go-live constraint; target 2026-08-15).
- **Per-asset cost / pricing** — the ≤$2 editorial target is a target, not a measured number; lock pricing only from the live ledger after the first cluster (OQ-2).
- **D3 SERP reversal trigger** — thin DDG grounding may throttle throughput via correct self-vetoes; instrument the gate-block-by-sourcing rate and flip to a funded SERP/retrieval API (same `brief.sources` contract) if it is the top blocker (OQ-3).

---

## Trust signal

Phase 5 converged in **6 rounds** — 1 Claude adversarial (R1) + 4 Codex gpt-5.5 xhigh cross-model rounds (R2–R5, all redacted) + 1 Claude convergence round (R6). Final: **`ready_to_ship = true`, trust 0.93, anchor 0.95**. The ≥4-Codex floor is met; all external rounds redacted. Foundations: bible **v1.0.0**, deviations **0** (the kernel-port and D5 worker-topology deviations are documented, not unresolved).

---

## Source-of-truth after handoff

| Concern | Source of truth |
|---|---|
| Locked decisions (D1–D9) | `../DECISIONS.md` — authoritative over analysis docs 00–06 |
| Mode, stakeholders, research, review_log, open_questions | `flywheel.manifest.json` (canonical) |
| Product scope, capabilities, risks, success | `prd.md` |
| Engineering slices, data model, lanes, budgets | `engineering-rfc.md` |
| Acceptance behavior / Phase-1 ship gate | `journeys.md` |
| Quality canon / chapter references | Agentic Bible v1.0.0 (sha `2c02fe80`) |

---

## What's next

1. **Phase 7 retro** — write the run retrospective (pending).
2. **Hand to `build-flywheel`** — compile this packet into a runnable build orchestrator.
3. **`/seo-creator-build` orchestrator** — drive Phase 0 (fetch origin/preview, port engine + golden set) then the Phase-1 thinnest slice, gated by journeys + the staffed D6 reviewer.
