# Open Decisions for James

These are the calls only you can make. Engineering can build any of them — what it cannot decide is the scope, budget, governance posture, and pricing model that flow from each. Each decision below has a default recommendation already baked into the plan; this document surfaces the fork explicitly so you can confirm or override before Phase 1 starts. Several are coupled — D1 and D8 in particular gate the timeline — so resolve them as a set.

The architecture is settled: **Approach B** (native AI SDK v6 agent loop in a new `apps/seo` service, deterministic moat ported from `origin/preview`, gate enforced in host code). These decisions tune scope and governance on top of that spine; none of them reopen the runtime choice except D5.

---

## D1 — Autonomous agent loop, or a fixed pipeline with nice streaming?

**The decision.** Does v1 ship a real tool-using `ToolLoopAgent` (the agent decides: fetch SERP → outline → draft → run faithfulness → revise → run seo-gate in one self-directed loop), or a deterministic `brief → draft → gate` sequence wrapped in token streaming + conversational edits?

| Option | What you get | What it costs |
|---|---|---|
| **Fixed pipeline + streaming (recommended for v1)** | ~90% of the perceived value: real token deltas, the three-zone canvas, conversational fine-tune — all the "feels like the Claude harness" surface — with deterministic, bisectable, idempotent steps | The agent never "decides" its own next step; a genuinely novel multi-step research path can't emerge in one loop |
| **Full `ToolLoopAgent`** | True multi-step autonomy; the strongest "watch it think and use tools" demo moment | Nondeterminism becomes the dominant failure surface — bisecting a regression across model + prompt + tool-order is hard, and it fights the deterministic-gate thesis. Adds weeks |

**Tradeoff.** The agent abstraction buys autonomy at the cost of reproducibility. The product's entire moat is *deterministic* gates and a fail-closed FSM — the loop is the least reproducible thing you can put in front of them.

**Why it matters now.** This is the single biggest scope lever in the plan. The streaming UI and the conversational fine-tune (your #1 and #2 requirements) do **not** require an autonomous loop — they need real SSE token deltas, which the fixed pipeline delivers identically. Choosing "fixed pipeline" now saves weeks and removes the highest nondeterminism risk; the `ToolLoopAgent` upgrade is additive later, behind the same UI. **Recommendation: ship the fixed pipeline for v1; reserve the autonomous loop for a flagged later tier.**

---

## D2 — Soft faithfulness badge, or the full hard fail-closed gate, for the YMYL pilot?

**The decision.** The shipped wizard's gates are *soft* (advisory, never block). Whispering Willows is memory care — squarely YMYL. Does v1 ship the soft badge, or the full non-compensatory gate (Stage-A ordered hard vetoes → Stage-B 8-dim composite) + named-author/credentials/citations hard-stop?

| Option | Posture |
|---|---|
| Soft badge | Faster to ship, matches today's reality; the product never refuses to publish |
| **Hard fail-closed gate (recommended)** | A persuasive draft scoring 95 on SEO still cannot publish if it trips a YMYL/faithfulness/thin-content veto. The gate *is* the product |

**Tradeoff.** The soft badge is faster and never frustrates an operator; the hard gate is the entire on-thesis value proposition and the only defensible posture for regulated content.

**Why it matters now.** This sets v1 scope and the YMYL governance surface. The bibles are unambiguous: "a perfect eval score makes a draft eligible, not published." For a memory-care client, shipping a soft badge is shipping a liability. **Recommendation: hard gate now** — it's why an agency can charge for this rather than a $20/mo SaaS toy. Confirm, because it adds the FSM, the credentialed-reviewer queue, and the byline-resolution work to Phase 1 rather than letting them slip.

---

## D3 — Grounding source: keep DuckDuckGo scraping, or fund a real SERP/retrieval API?

**The decision.** Faithfulness is bounded by how good `brief.sources` are. Today's brief route scrapes 3 DuckDuckGo HTML result pages (first 2,000 chars each) with no retrieval fallback — the product's weakest link. Do we keep that, or fund a real SERP/retrieval API for the web app?

| Option | Implication |
|---|---|
| Keep DDG HTML scraping | $0 incremental, but faithfulness ceiling stays low; thin/missing sources silently degrade every draft and the gate can only catch what the sources contain |
| **Fund a SERP/retrieval API (recommended for a YMYL pilot)** | Better, deeper, more authoritative sources → higher faithfulness floor → the YMYL grounding the gate depends on. Costs a budget line + an API key |

**Tradeoff.** Money and a key vs. the quality ceiling of every piece the engine produces.

**Why it matters now.** This is a budget/key decision, not an engineering one — engineering can wire either behind the same `brief.sources` contract. For YMYL specifically, scraped DDG snippets are too thin to ground medical claims to named authorities (Alzheimer's Association, NIA) the way the demo promises. **Recommendation: fund a real SERP API for the pilot.** Decide the budget now so Phase 1 wires the right source behind the SSRF-guarded contract from the start.

---

## D4 — Per-generation cost ceiling and the wallet model

**The decision.** Two coupled questions: (a) same VideoGen credits wallet, or a separate SEO ledger? (b) What is the real blended per-client cost once the human editor + credentialed reviewer dominate?

| Option | Implication |
|---|---|
| Reuse VideoGen credits wallet | Zero new billing infra; reuses `@flywheel/videogen/credits` reserve/refund. But SEO economics (long pipelines, agent round-trips, reviewer time) get muddied into video credits |
| **Separate SEO ledger via Gateway usage (recommended)** | Clean per-client cost-per-asset measurement — the number the whole pricing story depends on. AI Gateway gives real usage/cost observability the hand-rolled OpenRouter fetch never had |

**Tradeoff.** Reuse is faster to ship; a separate ledger is the only way to actually *measure* margin per client.

**Why it matters now.** The pricing/margin thesis ("15–20% of human cost") is a PRD target, not a measured number. The `≤$2` editorial cap is an aspiration. You cannot price the product, or know if a YMYL client is profitable, until you measure blended cost-per-asset from a live ledger — and the human reviewer, not the tokens, will dominate that number. **Recommendation: separate SEO ledger, measured via Gateway from day one.** This is the input to every pricing conversation.

---

## D5 — How literally do we reuse the Claude Code harness?

**The decision.** Commit fully to the native AI SDK v6 path (re-author the four runtime SKILL.md producers as system prompts + typed tools), or pursue Anthropic Managed Agents (beta) as a flagged "literal-harness" tier that runs the actual SKILL.md corpus server-side?

| Option | Implication |
|---|---|
| **Native AI SDK v6 (recommended)** | Runs in-process on Vercel, infra already proven in `apps/trailhead/src/lib/ai.ts` (`resolveGatewayModel` + fail-closed `CostAccountant`, both verified). Real token streaming, no beta dependency, no new ops surface. Cost: the four prompts must be re-authored and golden-regressed |
| Managed Agents (beta) | Closest to literal SKILL.md execution; Anthropic hosts the loop + container. But beta access is **unconfirmed** for the org, materially higher per-run cost, and adds a second LLM event taxonomy to maintain |
| Self-hosted Claude Agent SDK / Vercel Sandbox | **Ruled out.** Agent SDK is non-serverless (spawns the Claude Code CLI subprocess); Sandbox pays microVM cost for a code-execution capability content never uses |

**Tradeoff.** Native re-authoring carries methodology-fidelity risk (see D-risk below); literal execution avoids re-authoring but pays beta-gating + cost + a second runtime.

**Why it matters now.** It decides whether you have an infra dependency (Managed Agents beta) on the critical path. The native path has none. **Recommendation: commit to native B; revisit Managed Agents only if literal SKILL.md execution ever becomes a hard requirement — and never the self-hosted Agent SDK or Sandbox for content.** The one discipline that makes native safe: capture the live Whispering Willows hub as a golden set *before* writing a single prompt, and regress every prompt/model bump against it. That is a process commitment you should explicitly endorse, because methodology-fidelity regression is the failure mode that won't show up in CI.

---

## D6 — Reviewer capacity and the backup-reviewer SLA

**The decision.** What pages/week can one credentialed reviewer actually clear, and who is the backup before any regulated client goes live?

This is a **business/staffing decision, not an engineering one** — there is no recommended technical option, only a number and a name you must supply.

**Tradeoff.** Throttle generation to reviewer capacity (safe, on-thesis) vs. generate ahead of it and accumulate "approval debt" (fast, but release — not generation — becomes the silent bottleneck and the churn driver).

**Why it matters now.** The bibles name the **expert tier — not cost — as the binding constraint on YMYL publish rate.** A sole reviewer is a flagged single point of failure: no YMYL page should publish until a backup-reviewer path exists. The product instruments approval-cycle time and open-thread count per client as first-class KPIs precisely because this is the constraint. You need to set the measured ceiling and name the backup before Whispering Willows goes live — engineering will build the queue and the throttle, but only you can staff it.

---

## D7 — Does v1 own the per-client resource-library homepage as a generated artifact?

**The decision.** The live demo's homepage is a *curated resource library* (hero, statistic callout, named three-stage cluster, guide-card grid, quality section, tour CTA + license badge). The shipped engine renders individual pieces + sitemap — it does **not** render this homepage. Does v1 generate it, or hand-build it per client for the pilot and generate it later?

| Option | Implication |
|---|---|
| Generate it in v1 | Requires promoting `clusterRole` / `funnelStage` to first-class columns in Phase 1 (current schema persists neither pillar↔spoke edge) to drive the homepage + related-guides nav. More Phase 1 scope |
| **Hand-build for the pilot, generate later (recommended for one client)** | Whispering Willows is a single client — a hand-built hub landing is hours, not a schema migration. Defers the cluster-as-columns work to Phase 3/4 when multi-client makes it pay off |

**Tradeoff.** Generating it now is the right multi-tenant investment but front-loads a schema change; hand-building unblocks the one pilot client immediately.

**Why it matters now.** It directly determines whether `clusterRole`/`funnelStage` get promoted to columns in **Phase 1 vs. deferred**, which ripples through the schema and the render surface. For a single pilot client, hand-building the homepage is cheap and the generated template can wait until the second client justifies it. **Recommendation: hand-build for the pilot; generate it when client #2 lands.** Confirm, because it changes the Phase 1 schema scope.

---

## D8 — Client-review hosting model: in-app tokenized route, or per-client Vercel deploy?

**The decision.** Is the client review surface a tokenized in-app route inside `apps/seo` (rendering the actual SSR piece in a same-origin sandboxed iframe), or a public Vercel preview deployment with the Vercel toolbar's comment threads?

| Option | Implication |
|---|---|
| **In-app tokenized route (recommended)** | Keeps everything in the multi-tenant Supabase model; reuses the verified videogen pin stack (`PinOverlay`, `PreviewClickHandler`, `useIframePinDrop`, `ApprovalBeat`); review token scoped to exactly one piece/version, fail-closed. Cost: you build the comment-thread data model |
| Per-client Vercel deploy + toolbar threads | Inherits reply/resolve threads for free. But ties review to a per-client deploy, lives *outside* the multi-tenant Supabase model, and widens the cross-tenant-leakage surface — the agency-ending bug |

**Tradeoff.** Free thread tooling vs. a clean fail-closed tenancy boundary. The thread data model is a few days; a cross-tenant leak is the end of the agency.

**Why it matters now.** Cross-tenant leakage / voice bleed is flagged the **#1 agency-ending risk.** A public per-client deploy moves the review surface off the tenancy boundary you're building everything else around. **Recommendation: in-app tokenized route, scoped to one piece/version with fail-closed RLS.** This keeps the review token from ever widening retrieval across clients.

---

## Summary: what gates the timeline

| Decision | Recommended | Coupled to / gates |
|---|---|---|
| **D1** Loop vs. fixed pipeline | Fixed pipeline + streaming | Biggest timeline lever; affects Phases 1–2 |
| **D2** Soft vs. hard gate | Hard fail-closed gate | Sets YMYL scope in Phase 1; D6 |
| **D3** Grounding source | Fund a real SERP API | Budget + key; faithfulness ceiling |
| **D4** Wallet / cost ceiling | Separate SEO ledger via Gateway | Entire pricing/margin story |
| **D5** How literal the harness | Native AI SDK v6 | Removes beta dependency from critical path |
| **D6** Reviewer capacity + backup | *(your number + name)* | Binding constraint on YMYL publish rate |
| **D7** Generated homepage | Hand-build for pilot | `clusterRole`/`funnelStage` columns: Phase 1 vs. defer |
| **D8** Client-review hosting | In-app tokenized route | #1 cross-tenant-leakage risk |

The two that most change the Phase 1 plan are **D2** (hard gate now pulls the FSM + reviewer queue + byline resolution into v1) and **D7** (generated homepage forces a schema migration). The two that are purely yours to supply — no engineering default exists — are **D6** (a measured reviewer ceiling + a named backup) and the budget halves of **D3** and **D4**. Everything else has a confident recommendation already encoded in the plan; this document exists so you can override before Phase 0 begins.
