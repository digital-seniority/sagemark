import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Pure route-handler + lib units (no DOM). Data access + LLM gates are
    // injected/mocked, so no live Supabase and no provider key are needed.
    environment: "node",
    // The content kernel-route suites + the PR 006 worker-runtime suites run
    // under vitest. The PR 004 `test/tenancy/rls-contract.test.ts` uses Node's
    // built-in `node:test` runner (run via `node --test`), so it is intentionally
    // excluded here to avoid a runner clash.
    include: [
      "test/content/**/*.test.ts",
      "test/worker/**/*.test.ts",
      "test/stream/**/*.test.ts",
    ],
  },
  resolve: {
    alias: {
      // `@/` → apps/seo/src (mirrors tsconfig paths).
      "@": path.resolve(dirname, "src"),
      // The routes carry `import "server-only"` (a Next RSC marker). Alias it to
      // an empty stub so vitest (plain Node) can import them.
      "server-only": path.resolve(dirname, "test/content/server-only-stub.ts"),
    },
  },
});
