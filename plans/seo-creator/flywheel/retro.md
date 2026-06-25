# Retro — SEO Creator (Phase 7 self-eval)

*The meta-flywheel. Canonical state: `flywheel.manifest.json`. Completed 2026-06-25.*

## Trust signal (the gate)

**0.85 — "would ship confidently."** Gate threshold (commercial) = 0.70 → **PASSED.**
Would run `/seo-creator-build` next session = **yes**. The open items (D6 reviewer
staffing, pricing calibration) are tracked as go-live/launch concerns, not build blockers.

> *Why 0.85:* research-grounded wedge, a 6-round cross-model gauntlet that converged at
> 0.93, git-verified reuse claims, and a clean lint. Held back from 0.95 only by the two
> genuine unknowns the plan honestly ledgers — Vercel Sandbox capability-denial
> enforceability (de-risked by the PR-000 spike) and DDG-grounding sufficiency under the
> hard YMYL gate (instrumented as the D3 reversal trigger).

## 6-category self-eval

| # | Category | Assessment |
|---|---|---|
| 1 | Discovery quality | Condensed (plan pre-existed); interviewed only the load-bearing gaps — the commercial **validation** check (real client → no Trigger-3 abort), pricing, D6 reviewer, north-star KPI. Sharp. |
| 2 | Plan quality | Strongest on gate/governance/tenancy + the corrected four-skill kernel-route architecture. Thin spots (release records, byline auth, runtime confinement) were caught and fixed by the gauntlet. |
| 3 | Research utility | High — confirmed the wedge (no competitor can refuse to publish), surfaced AirOps ($40M) as the displacement risk, and the CNET/SI/Google-AIO-44% cautionary tales that ground the YMYL thesis. |
| 4 | Review effectiveness | High — Claude found topology/contract holes, Codex found Agent-SDK-runtime-confinement + durability holes (genuinely complementary). Trust 0.72 → 0.93 over 6 rounds (4 Codex, floor met). |
| 5 | Journeys + lint | 12 journeys (happy/sensitive/adversarial/surface/wedge); wedge demo (gate refuses unsourced YMYL stat) is J4. Lint caught a real "a prior-build product" leak + schema completeness gaps. |

## Phase friction

Phase 1 low · Phase 2 low · Phase 3 low (pre-answered) · Phase 4 medium (large authoring) ·
Phase 5 high (6-round cross-model gauntlet + a mid-phase skill-reference correction) ·
Phase 6 low.

## The single most important correction

Mid-Phase-5, the founder corrected the build to **run the existing `seo-copywriter`
suite skills directly** (seo-strategist → seo-assistant → seo-blog-writer → seo-audit)
via the Claude Agent SDK worker, **not** re-author them as system prompts — and the
skills are kernel-backed, so the port must stand up the `/content/api/{brief,draft,audit,
publish}` route contract in `apps/seo`. This materially raised methodology fidelity and
removed a pre-D5 ambiguity. Both verified against `origin/preview` (routes + libs exist).

## Improvements

| Target | Category | Note | Action |
|---|---|---|---|
| this-flywheel | lint | A prior-build product name leaked into the PRD (3x) as an inherited-bug reference | applied (generalized to "fail-open / ER-4 class") |
| this-flywheel | plan | review_log entries missing `completed_at`; top-level `handoff` object not in schema | applied (fixed manifest) |
| blueprint | lint | lint #8–10 read PRs from a `manifest.pr_map` the schema doesn't define → always N/A; should parse the RFC `### PR NNN` markdown | filed |
| blueprint | lint | HANDOFF template instructs writing a `handoff` manifest object the schema forbids (`additionalProperties:false`) | filed |
| blueprint | journeys | journey-measurability (#12) doesn't detect table-format metric thresholds → false-negative on well-formed journeys | filed |

## Gate result

`bootstrap_state.status = complete`. Trust 0.85 ≥ 0.70 (commercial) and
would_run_build_next_session = true. No override needed.
