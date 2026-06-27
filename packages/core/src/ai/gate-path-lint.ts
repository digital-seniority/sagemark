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
 *
 * COVERAGE (audit-005 H4 / `gate-metering-lint-coverage-complete`): the set of
 * gate sources is DISCOVERED by glob, not hardcoded — every
 * `packages/core/src/gates/*-gate.ts` (excluding `*.test.ts`) that references a
 * model-resolution helper is scanned. A NEW gate file that resolves a model
 * WITHOUT `{ forceGateway: true }` can therefore never silently escape the
 * metered Gateway (the DR-013 invariant + the billing basis for the cost
 * ledger) by simply not being on a hand-maintained list.
 *
 * COVERAGE (audit-006 M1 / metering-coverage hardening): the gate path is NOT
 * the only place a metered Gateway model is resolved. Live runners under
 * `packages/core/src/ai/` (e.g. `som-direct-runner.ts`, the SoM direct-probe
 * call site) also call `resolveGatewayModel` and MUST be Gateway-forced for the
 * same DR-013/D4-cost-ledger reason. Discovery is therefore EXTENDED to scan
 * every `packages/core/src/ai/*.ts` (excluding `*.test.ts`) that CALLS the
 * resolver — excluding the resolver's own definition file. A future edit that
 * drops `forceGateway` from a metered `ai/` call site (re-opening the
 * direct-Anthropic BYOK branch at a second call site) is now caught by the same
 * build-time backstop.
 */

import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join } from "node:path";

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
 * The directory (repo-root-relative) holding the gate source files, and the
 * model-resolution helpers a gate file must NEVER call without forcing the
 * Gateway. `resolveGatewayModel` is the canonical seam today; the list is
 * future-proofed so a renamed/aliased resolver is still caught by discovery.
 */
export const GATES_DIR_REL = "packages/core/src/gates";
const MODEL_RESOLUTION_HELPERS = ["resolveGatewayModel"] as const;

/**
 * The directory (repo-root-relative) holding the live AI runner sources that
 * also resolve metered Gateway models (audit-006 M1), and the resolver's own
 * definition file. The definition file is EXCLUDED from discovery because its
 * `export async function resolveGatewayModel(` declaration is not a metered call
 * site — scanning it would be a false positive (and would force the resolver to
 * "force itself"). Every OTHER `${AI_DIR_REL}/*.ts` (excluding `*.test.ts`) that
 * CALLS the resolver is in scope and must pass `{ forceGateway: true }`.
 */
export const AI_DIR_REL = "packages/core/src/ai";

/**
 * `ai/` files that reference `resolveGatewayModel` but are NOT metered call
 * sites, so must be EXCLUDED from discovery:
 *  - `resolve-gateway-model.ts` — the resolver's own DEFINITION (it cannot
 *    "force itself"; its `export async function resolveGatewayModel(` is a
 *    declaration, not a call).
 *  - `gate-path-lint.ts` — THIS lint module; it names the helper in a regex /
 *    docs to DETECT call sites, it does not resolve a model.
 * Both reference the helper name (and `gate-path-lint.ts` even contains a
 * call-shaped regex), so without this exclusion they would be false positives.
 */
const AI_DISCOVERY_EXCLUSIONS = new Set([
  "resolve-gateway-model.ts",
  "gate-path-lint.ts",
]);

/**
 * Glob-discover every gate source file that must be Gateway-forced:
 * `${GATES_DIR_REL}/*-gate.ts`, EXCLUDING `*.test.ts`, that references a
 * model-resolution helper. Returns repo-root-relative POSIX paths, sorted.
 *
 * This is the audit-005 H4 fix: a future `*-gate.ts` that resolves a model is
 * discovered AUTOMATICALLY — it cannot escape the cost-ledger metering by being
 * absent from a hand-maintained file list. A gate file that resolves NO model is
 * (correctly) not scanned; the moment it adds a `resolveGatewayModel` call it is
 * picked up and must pass `{ forceGateway: true }`.
 *
 * @param repoRoot absolute path to the monorepo root (the CI step's CWD).
 */
export function discoverGatePathSourceFiles(repoRoot: string): string[] {
  const absDir = join(repoRoot, GATES_DIR_REL);
  const discovered: string[] = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    // `*-gate.ts`, excluding test files.
    if (!name.endsWith("-gate.ts")) continue;
    if (name.endsWith(".test.ts")) continue;
    const source = readFileSync(join(absDir, name), "utf8");
    // Only gate files that actually resolve a model are in scope.
    if (!MODEL_RESOLUTION_HELPERS.some((h) => source.includes(h))) continue;
    discovered.push(`${GATES_DIR_REL}/${name}`);
  }
  return discovered.sort();
}

/**
 * Glob-discover every live AI runner source under `${AI_DIR_REL}` that CALLS a
 * model-resolution helper and so must be Gateway-forced (audit-006 M1):
 * `${AI_DIR_REL}/*.ts`, EXCLUDING `*.test.ts` AND the resolver's own definition
 * file (`resolve-gateway-model.ts`). Returns repo-root-relative POSIX paths,
 * sorted.
 *
 * This is the audit-006 M1 fix: a metered Gateway call site is not unique to the
 * `gates/` directory. `som-direct-runner.ts` resolves a model with
 * `{ forceGateway: true }` today; a future edit dropping `forceGateway` (re-
 * opening the direct-Anthropic BYOK branch and escaping the D4 cost ledger) is
 * caught AUTOMATICALLY — the file does not need to be on a hand-maintained list.
 * A file that references the helper only in a comment/import but makes no call is
 * still scanned by the lint, which is a no-op on it (the call regex needs a
 * following `(`); a file that resolves NO model is not picked up at all.
 *
 * @param repoRoot absolute path to the monorepo root (the CI step's CWD).
 */
export function discoverAiModelResolverSourceFiles(repoRoot: string): string[] {
  const absDir = join(repoRoot, AI_DIR_REL);
  const discovered: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch (err: unknown) {
    // A repo-root without an `ai/` dir (e.g. a gate-only synthetic test root):
    // no metered ai/ call sites to discover. Re-throw anything but "missing dir"
    // so a genuinely broken tree still fails loudly.
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (!name.endsWith(".ts")) continue;
    if (name.endsWith(".test.ts")) continue;
    // Infrastructure files that name the helper but are not metered call sites.
    if (AI_DISCOVERY_EXCLUSIONS.has(name)) continue;
    const source = readFileSync(join(absDir, name), "utf8");
    // Only files that actually reference a model-resolution helper are in scope.
    if (!MODEL_RESOLUTION_HELPERS.some((h) => source.includes(h))) continue;
    discovered.push(`${AI_DIR_REL}/${name}`);
  }
  return discovered.sort();
}

/**
 * The FULL set of metered model-resolution sources CI must lint: the
 * glob-discovered gate sources (audit-005 H4) PLUS the glob-discovered live AI
 * runner call sites (audit-006 M1). Returns repo-root-relative POSIX paths,
 * sorted and de-duplicated.
 *
 * @param repoRoot absolute path to the monorepo root (the CI step's CWD).
 */
export function discoverMeteredModelSourceFiles(repoRoot: string): string[] {
  return [
    ...new Set([
      ...discoverGatePathSourceFiles(repoRoot),
      ...discoverAiModelResolverSourceFiles(repoRoot),
    ]),
  ].sort();
}

/**
 * Read ALL glob-discovered metered model-resolution sources into a
 * `{ relPath: sourceText }` map for `assertGatePathGatewayOnly`. This is the
 * surface CI actually lints, and it now covers BOTH the gate sources
 * (audit-005 H4) AND the live AI runner call sites (audit-006 M1). Keeps the
 * file-system read here (impure) and the lint pure.
 *
 * NAME RETAINED for backward-compat with the CI step + pre-flight callers; the
 * scope is now "every metered Gateway call site", not gate sources alone.
 *
 * @param repoRoot absolute path to the monorepo root (the CI step's CWD).
 */
export function readDiscoveredGateSources(
  repoRoot: string,
): Record<string, string> {
  const sources: Record<string, string> = {};
  for (const rel of discoverMeteredModelSourceFiles(repoRoot)) {
    sources[rel] = readFileSync(join(repoRoot, rel), "utf8");
  }
  return sources;
}

/**
 * The gate source files whose `resolveGatewayModel` calls must be
 * Gateway-forced. Paths are relative to the repo root (the CI step's CWD).
 *
 * RETAINED for backward-compat + as the human-readable expectation of the
 * current on-disk gate set; the CI lint + the regression test now use
 * `discoverGatePathSourceFiles` so a NEW gate cannot be silently missed. The
 * `gate-path-lint.test.ts` asserts the discovered set EQUALS this list (a new
 * gate file fails that assertion until it is acknowledged here AND passes the
 * forceGateway lint).
 */
export const GATE_PATH_SOURCE_FILES = [
  "packages/core/src/gates/faithfulness-gate.ts",
  "packages/core/src/gates/voice-gate.ts",
] as const;

/**
 * The live AI runner sources under `${AI_DIR_REL}` whose `resolveGatewayModel`
 * calls must be Gateway-forced (audit-006 M1). Paths are relative to the repo
 * root (the CI step's CWD).
 *
 * RETAINED as the human-readable expectation of the current on-disk metered
 * `ai/` call-site set; the CI lint + the regression test use
 * `discoverAiModelResolverSourceFiles` so a NEW metered runner cannot be
 * silently missed. The `gate-path-lint.test.ts` asserts the discovered set
 * EQUALS this list (a new metered `ai/` file fails that assertion until it is
 * acknowledged here AND passes the forceGateway lint).
 */
export const AI_MODEL_RESOLVER_SOURCE_FILES = [
  "packages/core/src/ai/som-direct-runner.ts",
] as const;
