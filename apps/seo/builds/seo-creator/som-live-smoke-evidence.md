# SoM live-smoke evidence (P1.C.4) — 2026-06-26

**What this is:** a user-authorized **live smoke** of the share-of-model measurement path — real AI-Gateway calls across all 3 engines, citation detection against the Whispering Willows brand strings. It **validates the path + the hybrid labeling with real data**. It is NOT the formal DoD close (no DB rows written — see the runbook in `go-live-checklist.md` §"P1.C.4 DoD close").

**Method (faithful):** a scratchpad-isolated script replicating `runSomDirectProbe`'s exact two calls — `gateway(modelId)` (Gateway-only, the `forceGateway` path) + `generateText`, with the Claude web-search tool — using `ai@7.0.3` + `@ai-sdk/gateway@4.0.3` + `@ai-sdk/anthropic`. Cite-target = `["whispering willows of mount vernon","whispering willows","whisperingwillows.com"]` (case-insensitive). No DB writes. ~9 calls (3 prompts × 3 engines).

## Results
| Prompt | Claude `direct-citation` (web-search) | ChatGPT `direct-proxy` | Gemini `direct-proxy` |
|---|---|---|---|
| Best memory care communities in Skagit County, WA | **CITED** | not cited | not cited |
| Memory care facilities in Mount Vernon, WA | **CITED** | not cited | not cited |
| Is Whispering Willows of Mount Vernon a good memory care community? | CITED | CITED | CITED |

(Model ids: `anthropic/claude-sonnet-4-6`, `openai/gpt-4o`, `google/gemini-2.5-flash`. Claude web-search latency ~21–26s/probe; proxy engines ~2–7s.)

## Interpretation (validates DR-038 hybrid + the labeling)
- **Claude (web-search) = the real signal:** it surfaces *Whispering Willows* for the **discovery** queries ("best memory care in Skagit County", "facilities in Mount Vernon") — a genuine answer-engine citation. This is the north-star feed working.
- **ChatGPT/Gemini (proxy) only echo the brand when it's named in the prompt** — they "cite" on the direct brand question but NOT for discovery queries (no web access). This is exactly the `direct-proxy` semantics: a model-answer mention, NOT a discovery citation. It's the empirical reason the GEO-tracker vendor is the eventual upgrade for those engines.
- **Conclusion:** the proxy-vs-citation distinction the subsystem enforces structurally is real and meaningful in live data — Claude finds the client; the bare model APIs don't. The `rollUpBySourceChannel` separation (proxy never summed as a citation) is the honest way to report this.

## DoD CLOSE — real persisted rows (2026-06-26)
After the smoke, the user provisioned the pilot client (`content_clients` for Whispering Willows; `client_id=e84acf0f-16f9-4171-8ccb-80c2011c97ab`, `workspace_id=81815c0a-e001-4c74-bfe9-e48272d2b775` — **user-provided tenancy**, not agent-invented) and authorized the ingest. A representative slice of the bank (10 prompts × 3 engines = **30 real labeled rows**) was run through the live path (`gateway`+`generateText`, Claude web-search) and **persisted to `public.share_of_model`** scoped to that client. Verified read-only:

| engine | source_channel | n | cited | rate |
|---|---|---|---|---|
| claude | `direct-citation` | 10 | 6 | 60% |
| chatgpt | `direct-proxy` | 10 | 3 | 30% |
| gemini | `direct-proxy` | 10 | 3 | 30% |

**Real SoM = the `direct-citation` channel: 6/10** (Claude cites WW for the discovery queries — best-memory-care-Skagit, Mount-Vernon-facilities, where-to-learn — + all brand queries). The `direct-proxy` engines cite only on the 3 brand-named prompts (echo, never summed as a citation). Each row carries `source_channel`/`locale`/`device_profile`/`raw_response`/`captured_at`.

## Status — DoD-COMPLETE
**P1.C.4 DoD closed:** real (not mock) labeled `share_of_model` rows land from the live adapter for the WW client, channel-separated per DR-038. The scheduled weekly cron runs the full 28-prompt bank on the same path; this slice proves persistence end-to-end. Remaining SoM upgrade (deferred): GEO-tracker vendor for real ChatGPT/AIO consumer-engine citations (the `direct-proxy` engines).
