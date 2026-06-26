/**
 * _capture — write the Whispering Willows golden corpus JSON from the REAL kernel.
 *
 * Run ONCE to (re)generate the checked-in golden files (PR 008 / P0.W.5, DR-022):
 *
 *   CAPTURE_GOLDEN=1 pnpm --filter @sagemark/seo exec vitest run test/golden/capture.gen.test.ts
 *
 * It is NOT a regression test — it is the deterministic generator. The corpus it
 * writes is the characterization baseline captured from `@sagemark/core`
 * (`runSeoGate`); `regression.test.ts` then regresses every model/tool-order/
 * skill-config change against it. The two LLM gates are pinned to the documented
 * baseline (see capture-baseline.ts); everything else is the real kernel.
 *
 * This file is a plain module (not under vitest `include`); `capture.gen.test.ts`
 * imports + runs it so the workspace alias for `@sagemark/core` resolves.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { captureCorpus } from "../../golden/capture-baseline";

/** Resolve the repo root from this test file (…/apps/seo/test/golden). */
export function repoRootFromHere(): string {
  // apps/seo/test/golden/_capture.ts -> up 4 = repo root.
  return path.resolve(__dirname, "..", "..", "..", "..");
}

/** The directory the golden JSON lives in. */
export function goldenDir(): string {
  return path.resolve(__dirname, "..", "..", "golden", "whispering-willows");
}

/** Generate + write every golden JSON file. Returns the written basenames. */
export async function writeGoldenCorpus(): Promise<string[]> {
  const repoRoot = repoRootFromHere();
  const corpus = await captureCorpus(repoRoot);
  const dir = goldenDir();
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const piece of corpus) {
    const file = path.join(dir, `${piece.name}.json`);
    writeFileSync(file, JSON.stringify(piece, null, 2) + "\n", "utf8");
    written.push(`${piece.name}.json`);
  }
  return written;
}
