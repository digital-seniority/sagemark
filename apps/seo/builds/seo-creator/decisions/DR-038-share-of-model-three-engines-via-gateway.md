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
