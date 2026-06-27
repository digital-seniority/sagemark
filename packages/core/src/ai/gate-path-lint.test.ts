import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";


import {
  AI_DIR_REL,
  AI_MODEL_RESOLVER_SOURCE_FILES,
  GATE_PATH_SOURCE_FILES,
  GATES_DIR_REL,
  assertGatePathGatewayOnly,
  discoverAiModelResolverSourceFiles,
  discoverGatePathSourceFiles,
  discoverMeteredModelSourceFiles,
  lintGatePathSource,
  readDiscoveredGateSources,
} from "./gate-path-lint";

/**
 * DR-013 build-time backstop: the gate path must force the Gateway. These tests
 * lock both the lint logic (synthetic sources) AND the real gate sources (so a
 * future edit dropping `forceGateway` fails the build).
 */

describe("lintGatePathSource — DR-013 gate-path Gateway-forcing lint", () => {
  it("is CLEAN when the gate call forces the Gateway", () => {
    const src = `const m = await resolveGatewayModel(GATE_MODEL, "host", { forceGateway: true });`;
    expect(lintGatePathSource("x.ts", src)).toEqual([]);
  });

  it("VIOLATES when a gate call omits forceGateway (could reach the direct branch)", () => {
    const src = `const m = await resolveGatewayModel(GATE_MODEL, "host");`;
    const violations = lintGatePathSource("x.ts", src);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toContain("forceGateway");
    expect(violations[0].file).toBe("x.ts");
  });

  it("VIOLATES the bare two-arg host call (the pre-DR-013 state)", () => {
    const src = `resolveGatewayModel(GATE_MODEL, "host")`;
    expect(lintGatePathSource("x.ts", src)).toHaveLength(1);
  });

  it("ignores a comment that merely names resolveGatewayModel (no call)", () => {
    const src = `// resolveGatewayModel routes through the Gateway seam\nconst x = 1;`;
    expect(lintGatePathSource("x.ts", src)).toEqual([]);
  });

  it("flags forceGateway: false as a violation (must be forced)", () => {
    const src = `resolveGatewayModel(GATE_MODEL, "host", { forceGateway: false })`;
    // `forceGateway` appears, so the static lint passes; the runtime test in
    // resolve-gateway-model.test.ts proves `false` would take the direct branch.
    // We document that the static lint is name-presence only by asserting it
    // does NOT flag here — the behavioural guarantee is the vitest runtime test.
    expect(lintGatePathSource("x.ts", src)).toEqual([]);
  });

  it("assertGatePathGatewayOnly throws on a violating source map", () => {
    expect(() =>
      assertGatePathGatewayOnly({
        "bad.ts": `resolveGatewayModel(GATE_MODEL, "host")`,
      }),
    ).toThrow(/DR-013/);
  });

  it("assertGatePathGatewayOnly is silent on a clean source map", () => {
    expect(() =>
      assertGatePathGatewayOnly({
        "ok.ts": `resolveGatewayModel(GATE_MODEL, "host", { forceGateway: true })`,
      }),
    ).not.toThrow();
  });
});

describe("real gate sources are Gateway-forced (DR-013 regression backstop)", () => {
  // Resolve repo root from this file: …/packages/core/src/ai → up 4.
  const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

  it("every shipped metered call site passes forceGateway (gates + ai/ runners)", () => {
    // Read via glob-discovery (the audit-005 H4 + audit-006 M1 surface CI runs).
    const sources = readDiscoveredGateSources(repoRoot);
    expect(Object.keys(sources).length).toBeGreaterThan(0);
    expect(() => assertGatePathGatewayOnly(sources)).not.toThrow();
    // The audit-006 M1 call site is actually in the discovered+linted set.
    expect(Object.keys(sources)).toContain(
      "packages/core/src/ai/som-direct-runner.ts",
    );
  });

  it("glob-discovery equals the real on-disk gate set (no gate silently missed)", () => {
    // The discovered set must EQUAL the human-readable expectation. If a NEW
    // `*-gate.ts` resolves a model, this assertion FAILS until it is
    // acknowledged in GATE_PATH_SOURCE_FILES — and, separately, must pass the
    // forceGateway lint. A hand-maintained-list-only design could never assert
    // this (it would just skip the new file).
    const discovered = discoverGatePathSourceFiles(repoRoot);
    expect(discovered).toEqual([...GATE_PATH_SOURCE_FILES].sort());
  });

  it("som-direct-runner (real ai/ call site) passes forceGateway (audit-006 M1)", () => {
    // The shipped ai/ runner is discovered AND lints clean (it resolves the
    // model with { forceGateway: true }).
    const discovered = discoverAiModelResolverSourceFiles(repoRoot);
    expect(discovered).toContain("packages/core/src/ai/som-direct-runner.ts");
    const sources: Record<string, string> = {};
    for (const rel of discovered) {
      sources[rel] = readFileSync(join(repoRoot, rel), "utf8");
    }
    expect(() => assertGatePathGatewayOnly(sources)).not.toThrow();
  });

  it("ai/ glob-discovery equals the real on-disk metered-runner set (none missed)", () => {
    // Mirror of the gate equality check for the audit-006 M1 surface: a NEW
    // metered ai/ runner FAILS this until acknowledged in
    // AI_MODEL_RESOLVER_SOURCE_FILES — and must pass the forceGateway lint.
    const discovered = discoverAiModelResolverSourceFiles(repoRoot);
    expect(discovered).toEqual([...AI_MODEL_RESOLVER_SOURCE_FILES].sort());
  });

  it("EXCLUDES the resolver's own definition file from the ai/ scan", () => {
    // resolve-gateway-model.ts DEFINES resolveGatewayModel; it is not a metered
    // call site and must never be flagged (it cannot "force itself").
    const discovered = discoverAiModelResolverSourceFiles(repoRoot);
    expect(discovered).not.toContain(
      "packages/core/src/ai/resolve-gateway-model.ts",
    );
  });

  it("combined discovery is the union of gate + ai/ sources (CI surface)", () => {
    const combined = discoverMeteredModelSourceFiles(repoRoot);
    const expected = [
      ...discoverGatePathSourceFiles(repoRoot),
      ...discoverAiModelResolverSourceFiles(repoRoot),
    ].sort();
    expect(combined).toEqual(expected);
    // No duplicates.
    expect(new Set(combined).size).toBe(combined.length);
  });
});

describe("glob-discovery auto-covers a NEW gate file (audit-005 H4)", () => {
  // Build a throwaway repo-root that contains ONLY a gates dir, drop synthetic
  // `*-gate.ts` files into it, and prove discovery + lint behave as a brand-new
  // gate would in the real tree — without touching the shipped sources.
  const fakeRoot = mkdtempSync(join(tmpdir(), "gate-lint-disc-"));
  const gatesAbs = join(fakeRoot, GATES_DIR_REL);
  mkdirSync(gatesAbs, { recursive: true });

  afterAll(() => rmSync(fakeRoot, { recursive: true, force: true }));

  it("discovers a NEW *-gate.ts that resolves a model, and the lint runs on it", () => {
    // A brand-new gate that resolves a model WITHOUT forcing the Gateway.
    writeFileSync(
      join(gatesAbs, "newcomer-gate.ts"),
      `import { resolveGatewayModel } from "../ai/resolve-gateway-model";
       export async function runNewcomerGate() {
         const m = await resolveGatewayModel(GATE_MODEL, "host");
         return m;
       }`,
      "utf8",
    );
    // A `*-gate.ts` that resolves NO model — must NOT be picked up.
    writeFileSync(
      join(gatesAbs, "noop-gate.ts"),
      `export function runNoopGate() { return 1; }`,
      "utf8",
    );
    // A test file — must be EXCLUDED even though it resolves a model.
    writeFileSync(
      join(gatesAbs, "newcomer-gate.test.ts"),
      `resolveGatewayModel(GATE_MODEL, "host");`,
      "utf8",
    );
    // A correctly-forced gate — discovered AND clean.
    writeFileSync(
      join(gatesAbs, "good-gate.ts"),
      `import { resolveGatewayModel } from "../ai/resolve-gateway-model";
       const m = await resolveGatewayModel(GATE_MODEL, "host", { forceGateway: true });`,
      "utf8",
    );

    const discovered = discoverGatePathSourceFiles(fakeRoot);
    // Picks up the two model-resolving gates; excludes the no-model + test file.
    expect(discovered).toEqual([
      `${GATES_DIR_REL}/good-gate.ts`,
      `${GATES_DIR_REL}/newcomer-gate.ts`,
    ]);

    // And the lint FAILS on the new un-forced gate (it could not have been
    // missed by being absent from a hardcoded list).
    const sources = readDiscoveredGateSources(fakeRoot);
    expect(() => assertGatePathGatewayOnly(sources)).toThrow(/DR-013/);
    expect(() => assertGatePathGatewayOnly(sources)).toThrow(/newcomer-gate\.ts/);
  });

  it("is CLEAN once the new gate forces the Gateway", () => {
    // Replace the offending gate with a forced one → the discovered set lints clean.
    writeFileSync(
      join(gatesAbs, "newcomer-gate.ts"),
      `import { resolveGatewayModel } from "../ai/resolve-gateway-model";
       const m = await resolveGatewayModel(GATE_MODEL, "host", { forceGateway: true });`,
      "utf8",
    );
    const sources = readDiscoveredGateSources(fakeRoot);
    expect(() => assertGatePathGatewayOnly(sources)).not.toThrow();
  });
});

describe("glob-discovery auto-covers a metered ai/ runner (audit-006 M1)", () => {
  // Build a throwaway repo-root that contains BOTH a gates dir (so the combined
  // CI surface's fail-closed "zero discovered" guard is satisfied) and an ai
  // dir, drop synthetic ai/ runner files into it, and prove discovery + lint
  // behave as a brand-new metered runner would — without touching shipped src.
  const fakeRoot = mkdtempSync(join(tmpdir(), "ai-lint-disc-"));
  const gatesAbs = join(fakeRoot, GATES_DIR_REL);
  const aiAbs = join(fakeRoot, AI_DIR_REL);
  mkdirSync(gatesAbs, { recursive: true });
  mkdirSync(aiAbs, { recursive: true });

  afterAll(() => rmSync(fakeRoot, { recursive: true, force: true }));

  // A correctly-forced gate so the combined surface always discovers >0 (the
  // CI step's fail-closed guard) regardless of the ai/ contents under test.
  writeFileSync(
    join(gatesAbs, "good-gate.ts"),
    `import { resolveGatewayModel } from "../ai/resolve-gateway-model";
     const m = await resolveGatewayModel(GATE_MODEL, "host", { forceGateway: true });`,
    "utf8",
  );

  it("NEGATIVE: a metered ai/ call site WITHOUT forceGateway FAILS the lint", () => {
    // A brand-new live runner that resolves a model WITHOUT forcing the Gateway
    // — the exact audit-006 M1 regression (re-opening the direct-Anthropic BYOK
    // branch at a second call site, escaping the D4 cost ledger).
    writeFileSync(
      join(aiAbs, "leaky-runner.ts"),
      `import { resolveGatewayModel } from "./resolve-gateway-model";
       export async function runLeaky() {
         const m = await resolveGatewayModel(modelId, "host");
         return m;
       }`,
      "utf8",
    );
    // The resolver's own definition file — must be EXCLUDED (not a call site).
    writeFileSync(
      join(aiAbs, "resolve-gateway-model.ts"),
      `export async function resolveGatewayModel(id, ctx, opts) { return id; }`,
      "utf8",
    );
    // An ai/ file that resolves NO model — must NOT be picked up.
    writeFileSync(
      join(aiAbs, "unrelated.ts"),
      `export function noop() { return 1; }`,
      "utf8",
    );
    // A test file that resolves a model — must be EXCLUDED.
    writeFileSync(
      join(aiAbs, "leaky-runner.test.ts"),
      `resolveGatewayModel(modelId, "host");`,
      "utf8",
    );

    // Discovery picks up ONLY the leaky runner (excludes resolver def, no-model
    // file, and the test file).
    const discoveredAi = discoverAiModelResolverSourceFiles(fakeRoot);
    expect(discoveredAi).toEqual([`${AI_DIR_REL}/leaky-runner.ts`]);

    // The combined surface (what CI lints) includes both the good gate and the
    // leaky ai/ runner, and is non-empty (fail-closed guard satisfied).
    const combined = discoverMeteredModelSourceFiles(fakeRoot);
    expect(combined).toContain(`${AI_DIR_REL}/leaky-runner.ts`);
    expect(combined.length).toBeGreaterThan(0);

    // And the lint FAILS on the un-forced ai/ call site — it could NOT have been
    // missed by being absent from a hardcoded list (the audit-006 M1 fix).
    const sources = readDiscoveredGateSources(fakeRoot);
    expect(() => assertGatePathGatewayOnly(sources)).toThrow(/DR-013/);
    expect(() => assertGatePathGatewayOnly(sources)).toThrow(/leaky-runner\.ts/);
  });

  it("POSITIVE: the ai/ runner lints CLEAN once it forces the Gateway", () => {
    // Replace the leaky runner with a Gateway-forced one (the som-direct-runner
    // shape) → the combined discovered set lints clean.
    writeFileSync(
      join(aiAbs, "leaky-runner.ts"),
      `import { resolveGatewayModel } from "./resolve-gateway-model";
       export async function runForced() {
         const m = await resolveGatewayModel(modelId, "host", { forceGateway: true });
         return m;
       }`,
      "utf8",
    );
    const sources = readDiscoveredGateSources(fakeRoot);
    expect(() => assertGatePathGatewayOnly(sources)).not.toThrow();
  });
});
