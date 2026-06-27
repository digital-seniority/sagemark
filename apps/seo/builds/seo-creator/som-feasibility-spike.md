# SoM measurement-feasibility spike (PR 021 gate) — 2026-06-26

**Purpose:** PR 021 requires a feasibility spike FIRST, confirming ≥3 legal/reliable citation-measurement channels (with quota + per-run cost) before the adapters ship — else a *labeled* degraded v1. This records the channel matrix + the decision it surfaces.

## The core finding (the substance the spike exists to expose)
**"Share of model" = how often a brand is cited in the CONSUMER answer engines (ChatGPT app, Google AI Overviews, Gemini app, Perplexity).** Querying a **model API** (what DR-038's "Gateway direct-query" does) is a **proxy, not the same thing** — the API returns *a model's answer*, not *what the consumer answer engine cites*, and engines' ToS forbid scraping the consumer products. So there are two channel classes, with a real trade-off:

## Channel matrix
| Engine | Channel A — direct **model API** (via the AI Gateway, DR-038) | Channel B — **GEO-tracker vendor** (consumer answer-engine citations) |
|---|---|---|
| **ChatGPT / OpenAI** | OpenAI API — **sanctioned for business** (Services Agreement); scraping the ChatGPT *consumer* product is **forbidden**. Cost: pay-per-token (~cents/query). **Reliability as SoM: LOW** — API answer ≠ ChatGPT-app citations. | Profound / AthenaHQ / Peec track real ChatGPT-app citations. **Reliability: HIGH.** |
| **Claude / Anthropic** | Claude API **+ web-search tool** (Gateway) — sanctioned, **returns real cited sources**. Cost: tokens + web-search tool. **Reliability: MEDIUM-HIGH** (real citations; but Claude is lower-traffic as a consumer answer engine). | Same vendors. |
| **Gemini / Google** | Gemini API (Gateway) — sanctioned; but **Google AI Overviews citations have NO official API**. Cost: pay-per-token. **Reliability as SoM: LOW** for AIO (the high-traffic surface). | Vendors capture AI Overviews + Gemini citations. **Reliability: HIGH.** |
| **Perplexity** | deferred (DR-038) | vendors cover it (deferred 4th). |

**Vendor cost (Channel B), 2026:** Profound — Starter **$99/mo**, Growth **$399/mo**; AthenaHQ — **~$270–595/mo**; Peec AI — **~€85–199/mo** (tracks "used" vs explicit "cite"). All expose the brand-citation signal across the consumer engines, behind an API we'd integrate.

## What this means for the ≥3-channel requirement
- **Channel A (Gateway API)** = 3 *legal* engine channels, cheap — but it measures **model-answer mentions, not answer-engine citations**. Per the RFC this is the **"degraded v1 metric"** and MUST be **labeled** as such (rows record it's the API-proxy, the rate is "API-answer mention rate", not universal share-of-model). Claude's web-search path is the one genuinely-citation channel here.
- **Channel B (GEO-tracker)** = the **real** ≥3-engine share-of-model, but a **paid subscription + procurement** (your call).

## DECISION REQUIRED (James) — the metric's quality/cost trade-off
- **(A) Ship the Gateway-API proxy as the labeled degraded v1** (no new vendor, ~cents/run; weaker signal, honestly labeled). Fastest; satisfies the RFC's degraded-v1 path.
- **(B) Contract a GEO-tracker** (Profound/AthenaHQ/Peec, ~$99–399/mo) for the real consumer-citation metric — adds an API integration + a subscription.
- **(C) Hybrid** — Gateway/Claude-web-search for the real-citation engine now + a GEO-tracker later for ChatGPT/AIO.

## Engineering consequence (independent of A/B/C)
The PR 021 `SomAdapter` interface + the RFC-mandated **vendor-API fallback** mean the **scaffolding is channel-agnostic** — I can build it now (Gateway adapters + a vendor-adapter seam, mock-tested, flag-gated/inert), and your A/B/C choice just selects which adapter is activated with which credential. **No code is wasted by deciding later.** The DoD ("real rows, not mocks") closes only once a channel + its credential/subscription is in.

## Sources
- GEO-tracker pricing/comparison: athenahq.ai, capston.ai, scrunch.com, nicklafferty.com (2026 GEO-tools roundups).
- OpenAI API vs consumer ToS: openai.com/policies (Services Agreement; no programmatic extraction of ChatGPT consumer output).
