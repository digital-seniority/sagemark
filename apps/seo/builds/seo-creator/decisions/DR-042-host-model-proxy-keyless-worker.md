# DR-042 — Host model-proxy for the keyless worker

**Status:** Accepted · **Date:** 2026-06-27 · **Run:** worker stand-up · **Relates:** [[DR-016]] (worker model-traffic seam), [[DR-013]] (Gateway-only metering), [[DR-010]] (egress hardening), [[DR-018]]/[[DR-021]] (bridge-token auth)

## Context
DR-016 set the worker's model traffic to flow via the Agent-SDK env seam (`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` = the per-run bridge JWT), with `AI_GATEWAY_API_KEY` in the worker's `FORBIDDEN_ENV_KEYS` (keyless worker). Standing up the live worker exposed the missing half: a self-signed bridge JWT is NOT a credential the Vercel AI Gateway accepts, and no host route existed for the worker to call. So the worker could authenticate to the host *tools* but its *model* calls would 401.

## Decision
Build a **host model-proxy** the worker targets as its model endpoint: `POST /api/model/[...path]` (the worker sets `ANTHROPIC_BASE_URL = {host}/api/model`; the Claude Agent SDK appends `/v1/messages`).
- **Auth:** verifies the per-run bridge JWT via the existing `authenticateBridgeRequest` — scope bound from the verified token, never the request body; operator/DB path structurally unreachable. Fail-closed: 401 on missing/invalid/expired/wrong-run, 503 when the host `AI_GATEWAY_API_KEY` is absent.
- **Forward:** strips the worker bearer, injects the host `AI_GATEWAY_API_KEY` (both `Authorization: Bearer` and `x-api-key`), forwards to the **Vercel AI Gateway Anthropic-native endpoint `https://ai-gateway.vercel.sh/v1/messages`** (research-confirmed it speaks the Anthropic Messages API + SSE; overridable via `AI_GATEWAY_BASE_URL`). Streams the response through (no buffering → SSE intact). The raw Gateway key never reaches the worker.
- **Metering:** the upstream Gateway meters; per-run row-level cost accounting is a deferred seam (the JWT carries the run scope; would require tee-ing the stream for `usage` tokens — left to the ledger lane).

## Consequences
- Satisfies §17 GATEWAY-ONLY MODEL TRAFFIC + DR-013 with the keyless-worker invariant intact: the worker holds only the per-run JWT; the host owns the metered key.
- Egress (DR-010) simplifies — the worker only needs to reach the host (model + tools both go through `{host}`), not the Gateway directly.
- This is the FIRST host-side metered model door + establishes the `/api/model/[...path]` catch-all + `proxyModelRequest(request, path, deps)` injectable-seam pattern future worker-egress routes copy.
- Pins the Gateway base URL + dual-auth-header convention; a Gateway API change would require updating this one route (the DR records the choice).
- Inert until the worker calls it (401 without a valid bridge JWT) — safe to deploy ahead of the live dispatcher.

## Alternatives considered
- **`api.anthropic.com` direct** (host-held raw Anthropic key) — rejected: bypasses Gateway metering (DR-013).
- **Give the worker `AI_GATEWAY_API_KEY`** — rejected: an ambient, non-per-run-scoped key in the Sandbox; loses the per-run metering/scoping DR-016 wants.
- **OpenAI-compat `/v1/chat/completions`** — rejected: the worker speaks the Anthropic Messages API.
- **Buffer the response** — rejected: breaks SSE streaming.

## References
`apps/seo/src/app/api/model/[...path]/route.ts`; `apps/seo/src/lib/model/proxy.ts`; `test/model/proxy.test.ts`; vercel.com/docs/ai-gateway/sdks-and-apis/anthropic-messages-api.
