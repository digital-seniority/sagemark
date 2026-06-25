export * from "./services";
export * from "./client";
export * from "./health";
export * from "./ai/resolve-gateway-model";
export * from "./ai/cost-accountant";
export * from "./ai/worker-env-lint";

// ── Engine model config (PR 002) ───────────────────────────────────────────
// Re-exports DRAFTER/VERIFIER/JUDGE ids from the provider seam, so import
// `MODELS` + the invariant guard from here. (The id constants themselves are
// already exported above via `./ai/resolve-gateway-model`, so re-export only
// the new config surface to avoid duplicate-name conflicts.)
export {
  MODELS,
  ModelInvariantError,
  assertCrossModelInvariant,
  type EngineModelConfig,
} from "./config/models";

// ── Deterministic scorers (PR 002) ─────────────────────────────────────────
export * from "./scorers/flesch-kincaid";
export * from "./scorers/keyword-density";
export * from "./scorers/passive-voice";
export * from "./scorers/content-score";
export * from "./scorers/broken-chunk-linter";
export * from "./scorers/banned-lexicon-linter";
export * from "./scorers/geo-citation";
export * from "./scorers/faq-schema-generator";
export * from "./scorers/meta-tag-generator";
export * from "./scorers/og-tag-generator";
export * from "./scorers/faithfulness-gate-constants";
export * from "./scorers/compose";

// ── Cross-model faithfulness / voice gates (PR 002) ─────────────────────────
// The two gates each export `GATE_MODEL` / `GATE_TIMEOUT_MS` / `GATE_MAX_TOKENS`
// with gate-specific values, so they are re-exported explicitly (with the
// colliding constants namespaced per gate) rather than via `export *`.
export {
  runFaithfulnessGate,
  GATE_MODEL as FAITHFULNESS_GATE_MODEL,
  GATE_TIMEOUT_MS as FAITHFULNESS_GATE_TIMEOUT_MS,
  GATE_MAX_TOKENS as FAITHFULNESS_GATE_MAX_TOKENS,
  GATE_CLAIM_CAP as FAITHFULNESS_GATE_CLAIM_CAP,
  FAITHFULNESS_WARNING_THRESHOLD,
  type ClaimVerdict,
  type ClaimResult,
  type FaithfulnessResult,
} from "./gates/faithfulness-gate";
export {
  runContentVoiceGate,
  GATE_MODEL as VOICE_GATE_MODEL,
  GATE_TIMEOUT_MS as VOICE_GATE_TIMEOUT_MS,
  GATE_MAX_TOKENS as VOICE_GATE_MAX_TOKENS,
  type VoiceStatus,
  type VoiceSection,
  type VoiceGateResult,
} from "./gates/voice-gate";

// ── Non-compensatory SEO gate + lifecycle FSM (PR 003) ──────────────────────
// The product moat. `seo-gate` (Stage-A ordered vetoes → Stage-B 8-dim
// composite) consumes the single fail-closed composer (`runScorersFailClosed`
// from `./scorers/compose`, above) per DR-005 — exactly one composition path.
// `seo-gate` re-exports `STAGE_B_WEIGHTS`; the stage-b-weights module additionally
// contributes only its `StageBDimension` type (no duplicate `STAGE_B_WEIGHTS`).
export * from "./gate/failure-codes";
export * from "./gate/seo-gate";
export { type StageBDimension } from "./gate/stage-b-weights";
export * from "./lifecycle/lifecycle-fsm";
