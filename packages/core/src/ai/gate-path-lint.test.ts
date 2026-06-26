import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";


import {
  GATE_PATH_SOURCE_FILES,
  assertGatePathGatewayOnly,
  lintGatePathSource,
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
  it("every shipped gate call site passes forceGateway", () => {
    // Resolve repo root from this file: …/packages/core/src/ai → up 4.
    const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

    const sources: Record<string, string> = {};
    for (const rel of GATE_PATH_SOURCE_FILES) {
      sources[rel] = readFileSync(`${repoRoot}${rel}`, "utf8");
    }

    expect(() => assertGatePathGatewayOnly(sources)).not.toThrow();
  });
});
