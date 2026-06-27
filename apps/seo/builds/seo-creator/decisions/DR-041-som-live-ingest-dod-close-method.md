# DR-041 — P1.C.4 live SoM ingest + DoD-close method

**Status:** Accepted · **Date:** 2026-06-27 · **Run:** #24 (audit-006) · **Relates:** [[DR-038]] (SoM hybrid channel), [[DR-013]] (Gateway-only metering), [[DR-040]] (activation gate model)

## Context
P1.C.4 (PR 021 — the share-of-model north-star feed) required "real labeled `share_of_model` rows, not mocks" to close its DoD. The scheduled ingest cron is built and INERT (gated on `SOM_LIVE` + creds + a provisioned client). To close the DoD attended, the rows were produced by a **manual, user-authorized one-shot ingest**, not the cron. audit-006 (state-historian GAP2) flagged that this operational method had no DR — DR-038 covers only the channel/labeling.

## Decision
The P1.C.4 DoD was closed by a **manual, James-authorized ingest** with these properties, recorded here as the method of record:

- **What ran:** a scratchpad-isolated script replicating `runSomDirectProbe`'s exact two calls (`gateway(modelId)` + `generateText`, Claude web-search tool) for a 10-prompt × 3-engine slice of the approved bank, then a `pg` INSERT of 30 rows into `public.share_of_model`. Real billed Gateway calls; real persisted rows. Evidence: `som-live-smoke-evidence.md`.
- **Tenancy provenance:** the WW pilot client was **provisioned by the user** in Supabase (`client_id=e84acf0f-16f9-4171-8ccb-80c2011c97ab`, `workspace_id=81815c0a-e001-4c74-bfe9-e48272d2b775`). The agent did **not** fabricate the `workspace_id` — the harness guard correctly refused that, and the tenancy key was user-supplied. This is the standing rule: **production tenancy keys are user-provided, never agent-invented.**
- **Row shape:** `share_of_model` is **append-only, no UNIQUE/ON CONFLICT** (correct for a time series). Channels labeled per DR-038 (`direct-citation` for Claude/web-search = real SoM; `direct-proxy` for ChatGPT/Gemini = model-answer mention, never summed as a citation).
- **DoD scope:** "DoD-complete **for the covered engines**" — the direct-citation + direct-proxy channels. The **vendor channel (real ChatGPT/AIO consumer-engine citations) remains deferred** (GEO-tracker procurement). The scheduled cron runs the full 28-prompt bank on the same path once `SOM_LIVE` + creds are set on the deploy.

## Consequences
- The north-star feed is proven end-to-end with real data; the hybrid labeling is validated against live engine behavior (Claude cites WW for discovery queries; proxy engines echo only when the brand is named).
- **Idempotency risk (→ new manifest check `live-side-effect-idempotency`):** the manual ingest had no row-level idempotency key; correctness depends on running the slice exactly once. A second accidental run would double the WW client's counts. Future manual live writes (backfills, seeds, one-shot ingests) MUST declare an idempotency/dedup mechanism or an explicit run-exactly-once guard. The scheduled cron's re-run-adds-rows behavior is by-design (time series); reporting de-dupes by `captured_at` window, not by row uniqueness.
- The DoD close is honest: the evidence doc distinguishes the no-write smoke from the persisted-rows close and discloses the vendor deferral.

## Alternatives considered
- **Close via the scheduled cron on the deploy** — preferred long-term, but required `SOM_LIVE`+`CRON_SECRET` on Vercel + the full runtime; the manual slice closed the DoD attended with the same code path (the runner) at lower setup cost. Recorded so the provenance (manual vs cron) is not lost.
- **Wait for a GEO-tracker vendor for "real" multi-engine citations** — rejected as a DoD blocker; the hybrid labeling honestly reports proxy vs citation now, vendor is the later upgrade behind the pre-wired seam.

## References
`som-live-smoke-evidence.md`; `apps/seo/src/lib/metrics/som-*`; `packages/core/src/ai/som-direct-runner.ts`; flywheel-events F08/F09; audit-006 §DR-041 + §calibration.
