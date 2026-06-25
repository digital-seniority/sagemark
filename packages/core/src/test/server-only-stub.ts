/**
 * Vitest/typecheck stub for Next.js's `server-only` marker module.
 *
 * The ported gate modules (`gates/faithfulness-gate.ts`, `gates/voice-gate.ts`)
 * carry `import "server-only"` verbatim from the source. In a consuming Next.js
 * app that import is provided by Next and enforces RSC server-only boundaries.
 * `@sagemark/core` is source-consumed (DR-004) and its own `tsc --noEmit` +
 * vitest run in plain Node, where `server-only` does not resolve. This empty
 * module is aliased in for `server-only` (see `vitest.config.ts`) so the gates
 * can be unit-tested directly — mirrors flywheel-main's
 * `apps/agents/src/test/server-only-stub.ts`.
 */
export {};
