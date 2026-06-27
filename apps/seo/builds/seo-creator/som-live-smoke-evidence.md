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

## Status
Path + hybrid labeling **proven live**. Formal P1.C.4 DoD (real labeled `share_of_model` rows persisted for a provisioned client) remains open — close it via the runbook (deploy + env + client + cron). Once those rows land, P1.C.4 is DoD-complete.
