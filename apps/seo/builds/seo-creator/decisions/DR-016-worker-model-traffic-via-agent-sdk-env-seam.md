# DR-016 — worker-model-traffic-via-agent-sdk-env-seam

**Date:** 2026-06-26
**Run:** #008
**Status:** active
**Build phase:** Phase 0 — Foundations

## Context

RFC §2 / [[DR-013]] / judge §C17 expect worker model traffic to route through
`resolveGatewayModel('worker')` (the AI-SDK seam the core gates use). But the P0.W.2 worker
runs the **Claude Agent SDK**, which spawns the `claude` CLI subprocess — the CLI reads
**environment variables** for its model endpoint/credential, not an AI-SDK `LanguageModel`
object. There is no clean injection point to hand a `resolveGatewayModel('worker')` result
into a CLI-spawned subprocess.

## Decision

The P0.W.2 worker routes model traffic via the **Agent-SDK/CLI env seam**:
`ANTHROPIC_BASE_URL` = the metered Gateway base URL, `ANTHROPIC_AUTH_TOKEN` = the per-run
bridge JWT. It does **not** call `resolveGatewayModel('worker')`.

The RFC §2 invariants are preserved and double-guarded:
- **Gateway-only / no raw provider key:** the worker env carries only the Gateway base URL +
  per-run JWT; `ANTHROPIC_API_KEY` is in `FORBIDDEN_ENV_KEYS` and `readWorkerEnv` hard-refuses
  to boot if it is present (agent-worker.ts).
- The egress allowlist (DR-010) only permits the Gateway + host-bridge hosts, so even a
  mis-set endpoint cannot reach a raw provider.

So §C17 is satisfied **in substance** (Gateway-only, no un-metered egress) via a different
mechanism than the named resolver.

## Consequences

- The `resolveGatewayModel('worker')` context resolver in `packages/core` remains the seam for
  AI-SDK callers (the host gates); the CLI-based worker uses the env seam. Two model-call
  surfaces, one invariant (Gateway-only), enforced two ways.
- PR 006b's adversarial suite should include an assertion that the worker env never carries a
  raw provider key AND that the CLI cannot reach a non-Gateway endpoint (egress test).
- If a future worker moves off the CLI to an in-process AI-SDK loop, switch it to
  `resolveGatewayModel('worker')` and retire the env seam.

Links: [[DR-013]] (gates via the Gateway seam; host-context BYOK caveat), [[DR-010]] (egress hardening), [[DR-011]] (no-shell worker).
