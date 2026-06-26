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
      // PR 009 / P0.S.2: the fail-closed publish truth table (studio /api/publish).
      "test/publish/**/*.test.ts",
      "test/worker/**/*.test.ts",
      "test/stream/**/*.test.ts",
      // PR 008 / P0.W.5 (DR-019 append-only carve-out): the golden-set regression
      // harness + the Stage-A/Stage-B acceptance spec.
      "test/golden/**/*.test.ts",
      // The acceptance spec is authored as `gate-spec.ts` (RFC PR 008 filename),
      // so the acceptance glob matches `*.ts` (it contains describe/it suites).
      "test/acceptance/**/*.ts",
      // PR 015 / P1.R.1 (DR-019 append-only carve-out): the content-hub SSR
      // render suites (ssr-body, faq-jsonld, placeholder-strip, status-filter).
      "test/render/**/*.test.ts",
    ],
  },
  // The PR 015 render suites import the `[client]/blog/[slug]/page.tsx` Server
  // Component and render it to a static HTML string with react-dom/server. The
  // app tsconfig is `jsx: preserve` (only Next understands that); Vite 8's oxc
  // transformer needs an explicit JSX runtime to compile TSX for vitest. React
  // 19's automatic runtime needs no React import. No effect on non-TSX suites.
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "react",
    },
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
