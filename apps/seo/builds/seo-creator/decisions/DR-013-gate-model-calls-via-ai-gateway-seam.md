# DR-013 — gate-model-calls-via-ai-gateway-seam

**Date:** 2026-06-26
**Run:** #007
**Status:** active
**Build phase:** Phase 0 — Foundations

## Context

Audit-001 finding A.005.3: the ported faithfulness + voice gates
(`packages/core/src/gates/{faithfulness,voice}-gate.ts`) called **OpenRouter directly**
(raw `fetch` to `openrouter.ai`, `process.env.OPENROUTER_API_KEY`) instead of routing
through the metered AI Gateway seam (`resolveGatewayModel`) that PR 001 stood up. This
violated the RFC §2 invariant ("every model call is accounted; the worker never holds a
raw provider key") and meant host-side gate spend was invisible to the D4 cost ledger.
`GATE_MODEL` was also a hardcoded `"anthropic/claude-haiku-4-5"` literal rather than the
canonical, invariant-checked `VERIFIER_MODEL_ID` from `config/models.ts`.

PR #15 (Run #007, judge APPROVED 5/5·5/5) migrated both gates.

## Decision

**The canonical model-call pattern for the engine gates/scorers is
`resolveGatewayModel(id, context)` + the AI SDK (`generateText` / `Output.object`).**
The raw-`fetch`-to-OpenRouter pattern is removed and must not return. Gate verifier id =
`VERIFIER_MODEL_ID` (canonical, drafter≠verifier asserted at module load).

Sub-decisions:
1. **`@sagemark/core` gains runtime deps `ai@^7.0.2` + `zod@^4.4.3`.** The seam returns a
   `LanguageModelV4` that must be driven by the AI SDK; `ai@7` co-resolves cleanly with the
   existing `@ai-sdk/gateway@^4` (shared `@ai-sdk/provider@4` / `provider-utils@5`), no
   version conflict, lockfile unchanged-drift. Chosen over hand-rolling against lower-level
   `@ai-sdk/provider` primitives.
2. **Gates pass `"host"` context** (they run in the host/operator runtime, not the Sandbox
   worker).

## Metering policy — DECIDED (2026-06-26, user-directed)

`resolveGatewayModel(id, "host")` has a documented **BYOK escape hatch**: if
`ANTHROPIC_API_KEY` is set, host context takes the direct-Anthropic branch and bypasses the
Gateway (un-metered). The options were (a) accept the host BYOK branch, or (b) force the
gates Gateway-only.

**DECISION: (b) — the gates are Gateway-only-metered. The BYOK branch is never used for
gate (faithfulness/voice) model calls.** Rationale: the D4 cost ledger (PR 020) is a
billing/cost invariant; every gate model call MUST reconcile through the metered Gateway, so
the guarantee cannot depend on env hygiene. The BYOK escape hatch remains available for
*other* host/CI contexts (e.g. one-off operator scripts), but NOT for the gate path.

**Implementation (queued follow-up corrective, before PR 020):**
1. The gate calls resolve their model via a **Gateway-forcing** path — either a
   `resolveGatewayModel(id, { forceGateway: true })` flag (preferred — explicit) or routing
   the gates through the same Gateway-only resolution the `"worker"` context uses. The gate
   path must NOT reach the direct-Anthropic branch even if `ANTHROPIC_API_KEY` is present.
2. A **CI assertion** (extend the worker-env-lint pattern to the host/gate context) fails the
   build if the gate path could resolve a raw-Anthropic provider — mirrors the worker's
   "Gateway-disabled ⇒ zero model calls" guarantee at the gate layer.
3. One-line comment at each gate call site cross-referencing this DR.

Until that corrective lands, the D4 ledger work must treat host gate spend as Gateway-routed
**by this decision**, and the corrective is a prerequisite of PR 020. (Tracked as a Medium
follow-up; flagged in STATE active items.)

## Consequences

- Future engine gates/scorers copy the `resolveGatewayModel + AI SDK` pattern; a raw provider
  `fetch` in `@sagemark/core` is a review red flag.
- A.005.3 active risk is resolved pending merge of PR #15.
- Recommended follow-up (judge): add a gate test that negatively asserts no `process.env`
  provider key is read in the gate path (locks §C17 at the gate layer).

Links: [[DR-012]] (DSN/Supabase), [[DR-008]] (source-consumed build — apps/seo build is GREEN with the dep add), [[audit-001]] (finding A.005.3).
