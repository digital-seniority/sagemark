/**
 * CI source lint — "every gate-path model resolution is Gateway-forced"
 * (DR-013, the prerequisite for the D4 cost ledger / PR 020).
 *
 * DR-013 decided the faithfulness + voice gates are **Gateway-only-metered**:
 * the direct-Anthropic BYOK branch of `resolveGatewayModel` must NEVER be
 * reachable from the gate path, even when `ANTHROPIC_API_KEY` is present. The
 * runtime guarantee is delivered by the `forceGateway` option (the gate call
 * sites pass `{ forceGateway: true }`); this lint is the build-time backstop
 * that fails the build if a gate source file ever resolves a model WITHOUT
 * forcing the Gateway (i.e. re-introduces a path that could reach the raw
 * provider). It mirrors `worker-env-lint`'s "fails-the-build" role for the
 * worker invariant, applied at the gate layer.
 *
 * Pure + dependency-free (operates on source text), so it runs in CI, in a unit
 * test, and as a pre-flight — no AST/tooling dependency.
 */

/** A single gate-path lint violation, with enough context to fix it. */
export interface GatePathViolation {
  /** The source file (label) the offending call was found in. */
  file: string;
  reason: string;
}

/**
 * Match a `resolveGatewayModel(...)` call and capture its argument list up to
 * the matching close paren. Gate calls are single-statement and un-nested
 * (`resolveGatewayModel(GATE_MODEL, "host", { forceGateway: true })`), so a
 * non-greedy capture to the first `)` is sufficient and robust here.
 */
const RESOLVE_CALL = /resolveGatewayModel\s*\(([^)]*)\)/g;

/**
 * Lint one gate source file's text. Returns the violations found (empty ⇒
 * clean). A violation is raised for any `resolveGatewayModel(...)` call in the
 * file whose argument list does NOT contain `forceGateway` — i.e. a gate model
 * resolution that could fall through to the direct-Anthropic BYOK branch.
 *
 * Comments mentioning `resolveGatewayModel` are not calls (no following `(`),
 * so they do not match. The `{ forceGateway: true }` object literal is on the
 * SAME call expression as the gate sites, so the captured arg list includes it.
 */
export function lintGatePathSource(
  file: string,
  source: string,
): GatePathViolation[] {
  const violations: GatePathViolation[] = [];

  for (const match of source.matchAll(RESOLVE_CALL)) {
    const args = match[1] ?? "";
    if (!/\bforceGateway\b/.test(args)) {
      violations.push({
        file,
        reason:
          `gate path calls resolveGatewayModel(${args.trim()}) WITHOUT ` +
          "forceGateway — a gate model resolution must force the Gateway " +
          "(DR-013: Gateway-only-metered). Pass { forceGateway: true } so the " +
          "direct-Anthropic BYOK branch can never be reached from the gate path.",
      });
    }
  }

  return violations;
}

/**
 * Assert every gate source maps cleanly. Throws (fail-closed) on any violation —
 * the CI wrapper calls this and a thrown error fails the build.
 *
 * `sources` is a `{ fileLabel: sourceText }` map so the caller (CI step / test)
 * owns the file reads and this stays pure.
 */
export function assertGatePathGatewayOnly(
  sources: Record<string, string>,
): void {
  const violations = Object.entries(sources).flatMap(([file, source]) =>
    lintGatePathSource(file, source),
  );
  if (violations.length > 0) {
    throw new Error(
      `gate-path lint failed (DR-013):\n${violations
        .map((v) => `  - [${v.file}] ${v.reason}`)
        .join("\n")}`,
    );
  }
}

/**
 * The gate source files whose `resolveGatewayModel` calls must be
 * Gateway-forced. Paths are relative to the repo root (the CI step's CWD).
 */
export const GATE_PATH_SOURCE_FILES = [
  "packages/core/src/gates/faithfulness-gate.ts",
  "packages/core/src/gates/voice-gate.ts",
] as const;
