/**
 * capture.gen — the golden-corpus GENERATOR (PR 008 / P0.W.5, DR-022).
 *
 * Skipped unless `CAPTURE_GOLDEN=1`. When enabled it (re)writes the checked-in
 * `apps/seo/golden/whispering-willows/*.json` from the REAL `@sagemark/core`
 * kernel. This is the only sanctioned way to regenerate the baseline; the actual
 * tripwire is `regression.test.ts`, which runs unconditionally.
 *
 *   CAPTURE_GOLDEN=1 pnpm --filter @sagemark/seo exec vitest run test/golden/capture.gen.test.ts
 */

import { describe, it, expect } from "vitest";

import { writeGoldenCorpus } from "./_capture";

const ENABLED = process.env.CAPTURE_GOLDEN === "1";

describe.skipIf(!ENABLED)("golden corpus generator (CAPTURE_GOLDEN=1)", () => {
  it("writes all 10 golden pieces from the real kernel", async () => {
    const written = await writeGoldenCorpus();
    expect(written.length).toBe(10);
    expect(written).toContain("pillar.json");
    expect(written).toContain("faq.json");
    expect(written).toContain("checklist.json");
  });
});
