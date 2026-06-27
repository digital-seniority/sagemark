# DR-038 — share-of-model-three-engines-via-gateway

**Date:** 2026-06-26
**Run:** #022 follow-up (James decision, non-eng input #3)
**Status:** active
**Build phase:** Phase 1 — Pilot

## Context

P1.C.3 (PR 020 — separate SEO cost ledger + share-of-model instrumentation) and P1.C.4 (PR 021 — share-of-model citation-ingestion cron + freshness cron) are the north-star feed: how often the client's brand/domain is **cited across multiple AI answer engines**. The lane was blocked on two non-engineering definitions — which engines (≥3), and how the citation data is collected.

## Decision (James, 2026-06-26)

1. **Engine set = 3:** **ChatGPT (OpenAI) · Claude (Anthropic) · Gemini (Google)** — satisfies the ≥3-engine requirement. (Perplexity was offered and deferred; can be added later as a 4th.)
2. **Collection method = direct query via the Vercel AI Gateway** (NOT a third-party AEO/monitoring service). A cron runs the client's **target prompt-set** against each engine's API through the existing Gateway seam, parses citations of the client's domain/brand in each answer, and writes `share_of_model` rows. Metering + auth reuse the Gateway path ([[DR-013]] Gateway-only).

## Consequences

- P1.C.3 (PR 020) and P1.C.4 (PR 021) are **SPEC-UNBLOCKED** on the engine-set + method.
- **Remaining input for P1.C.4 (still needed from James/the client):** the **per-client target prompt-set** — the actual queries to test for citation (e.g., for Whispering Willows: senior-living / memory-care / location-intent questions a prospect would ask an answer engine). Without it the ingestion cron has nothing to query. Treat as a P1.C.4 prerequisite.
- **Still gated for P1.C.3:** the [[DR-013]] Gateway-only-metering corrective must land **before** the cost ledger (force-Gateway resolution + a CI assertion that the gate/SoM path can't resolve a raw provider) — the ledger and SoM both depend on Gateway-metered calls being the only path.
- `share_of_model` is a canonical table name (per manifest judge_criteria); the cron writes (client, engine, prompt, cited?, position, captured_at)-shaped rows. Cost of the SoM queries themselves flows through the `seo_cost_ledger` (Gateway-metered).

## Links

P1.C.3 / PR 020, P1.C.4 / PR 021; [[DR-013]] (Gateway-only metering corrective — prerequisite); journeys north-star feed.

## Spike outcome + HYBRID channel decision (2026-06-26, James — supersedes the "method" detail above)

The PR-021 measurement-feasibility spike (`som-feasibility-spike.md`) found that querying a **model API** (the original DR-038 "Gateway direct-query") is a **proxy**, not a consumer-answer-engine citation — weakest for ChatGPT-consumer + Google AI Overviews; only Claude's API **web-search tool** yields a genuine cited-sources signal. Real consumer-citation tracking needs a GEO-tracker vendor (Profound/AthenaHQ/Peec, ~$99–399/mo).

**DECISION — HYBRID (James):**
1. **Claude — real-citation channel:** activate via the Gateway + the Claude **web-search tool** (returns actual cited sources). `source_channel = 'direct-citation'`.
2. **ChatGPT + Gemini — Gateway-API PROXY, explicitly LABELED:** model-answer mention, NOT a consumer-engine citation. `source_channel = 'direct-proxy'`; the per-hub rate must be reported as "API-answer mention rate (proxy)" for these engines, NEVER as universal share-of-model.
3. **GEO-tracker vendor — DEFERRED (the real ChatGPT/AIO citations):** the `SomAdapter` vendor-fallback seam is pre-wired; James contracts a vendor later → flip those engines to `source_channel = 'vendor'` for the real signal. No code wasted (channel-agnostic adapters).

**Load-bearing labeling requirement:** every `share_of_model` row records its `source_channel` so the proxy vs real-citation vs vendor signal is never conflated — the dashboard/rollup must qualify the metric by channel. This is the RFC's "degraded v1 metric, explicitly labeled" path, made honest per-engine.

**Activation still needs (James):** provider API keys (via the Gateway) for the direct/proxy + Claude-web-search paths, and the `SOM_LIVE` flag — then real (labeled) rows land for the Whispering Willows hub, closing P1.C.4's DoD for the covered engines. The vendor upgrade is a later step.
