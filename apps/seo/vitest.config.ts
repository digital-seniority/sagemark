import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Pure route-handler + lib units (no DOM) default to the node environment.
    // Data access + LLM gates are injected/mocked, so no live Supabase and no
    // provider key are needed. The PR 011 / P1.U.2 UI INTERACTION suites under
    // `test/ui/*.dom.test.tsx` opt INTO jsdom per-file via a top-of-file
    // `// @vitest-environment jsdom` directive (added in this PR with jsdom +
    // @testing-library/react). Scoping jsdom to the `.dom.test.tsx` files keeps
    // every existing node-env suite (incl. the react-dom/server render smoke
    // test in `test/ui/canvas-render.test.tsx`) on node, untouched.
    environment: "node",
    // The content kernel-route suites + the PR 006 worker-runtime suites run
    // under vitest. The PR 004 `test/tenancy/rls-contract.test.ts` uses Node's
    // built-in `node:test` runner (run via `node --test`), so it is intentionally
    // excluded here to avoid a runner clash.
    include: [
      // DR-003 (lane auth): the operator-auth seam — getCurrentWorkspace's
      // operator -> service-role membership -> workspace resolution + the
      // fail-closed branches (no operator / no membership / unmappable row), and
      // requireOperator's redirect-when-unauthenticated gate. Pure vitest with
      // injected fakes for the operator + the service-role member read (no DB, no
      // live Supabase). The live magic-link round-trip is Tier-3 NEEDS-INPUT.
      "test/auth/**/*.test.ts",
      "test/content/**/*.test.ts",
      // PR 009 / P0.S.2: the fail-closed publish truth table (studio /api/publish).
      "test/publish/**/*.test.ts",
      "test/worker/**/*.test.ts",
      "test/stream/**/*.test.ts",
      // Slice 5 / P-E (lane worker-runtime): the pure turn-prompt composer that
      // builds the per-turn WORKER_PROMPT brief (first-turn generate vs revision,
      // transcript size-cap, injection-hygiene fencing). Pure fn, no infra.
      "test/conversation/**/*.test.ts",
      // worker-runtime: the LIVE /api/run worker dispatcher (provisions the per-run
      // Sandbox, starts the worker, relays its `::worker-*::` marker stream as coded
      // SSE). Tier-1, injected fake launchSandbox + scripted worker logs (no live VM).
      "test/run/**/*.test.ts",
      // worker-runtime: the host model-proxy (verify bridge JWT -> forward to the
      // metered Gateway with the host key -> stream SSE through). Tier-1, injected
      // upstream fetch + injected secret (no live Gateway, no real key).
      "test/model/**/*.test.ts",
      // PR 008 / P0.W.5 (DR-019 append-only carve-out): the golden-set regression
      // harness + the Stage-A/Stage-B acceptance spec.
      "test/golden/**/*.test.ts",
      // The acceptance spec is authored as `gate-spec.ts` (RFC PR 008 filename),
      // so the acceptance glob matches `*.ts` (it contains describe/it suites).
      "test/acceptance/**/*.ts",
      // PR 015 / P1.R.1 (DR-019 append-only carve-out): the content-hub SSR
      // render suites (ssr-body, faq-jsonld, placeholder-strip, status-filter).
      "test/render/**/*.test.ts",
      // PR 010 / P1.U.1 (DR-019 append-only carve-out): the three-zone canvas
      // shell — the SSE message-stream reducer suite + a react-dom/server render
      // smoke test (the `.tsx` glob picks up the component render suite).
      "test/ui/**/*.test.ts",
      "test/ui/**/*.test.tsx",
      // PR 012 / P1.U.3 (DR-019 append-only carve-out): the bounded-edit guards
      // (stale-edit 409 / rate-limit 429 / ownership 403) + the bounded-diff +
      // the full-gate-re-run-catches-a-faithfulness-break suite. An ActivityFeed
      // DOM test opts into jsdom per-file (`.dom.test.tsx`, DR-029).
      "test/edit/**/*.test.ts",
      "test/edit/**/*.test.tsx",
      // PR 013 / P1.U.4 (DR-019 append-only carve-out): the version hub — the
      // undeletable-named-sign-off + switch/name/compare + tenancy guards route
      // suite, plus a VersionHub/VersionDiff DOM suite (jsdom per-file, DR-029).
      "test/versions/**/*.test.ts",
      "test/versions/**/*.test.tsx",
      // PR 017 / P1.R.3 (DR-019 append-only carve-out): the resource-library
      // homepage cluster-map + SSR render suite lives under test/render/ (already
      // globbed above as test/render/**/*.test.ts); the imagegen hero-image
      // provenance/license suite is under test/tools/.
      "test/tools/**/*.test.ts",
      // PR 018 / P1.C.1 (DR-019 append-only carve-out): the tokenized
      // client-review suites — the comments-route token-scoped persist + the
      // client-surface-exposure render (react-dom/server). NOTE:
      // test/review/token-scope.test.ts is INTENTIONALLY NOT globbed here — it
      // uses Node's built-in node:test runner (run via `node --test`), like
      // test/tenancy/rls-contract.test.ts, so it is excluded to avoid a runner
      // clash. The two vitest files are listed explicitly.
      "test/review/comments-route.test.ts",
      "test/review/client-surface-exposure.test.ts",
      // DR-026 (lane client-review): the LIVE review-token + review-comment
      // service-role adapter (live-review-data-access.ts). A Tier-1 fixture suite
      // over an in-memory fake Supabase client — proves the fail-closed token
      // boundary (revoked/expired/forged/cross-tenant -> null), the review-safe
      // exposure projection (no scorecard/credits/cost/model/markdown), and the
      // resolved-tenancy comment write. Pure vitest, no DB.
      "test/review/live-review-data-access.test.ts",
      // PR 019 / P1.C.2 (DR-019 append-only carve-out): the request-changes ->
      // edit-loop routing + the dual sign-off (client_signoffs advisory vs the
      // credentialed_releases release) + the §11.5 active-authorization fail-closed
      // write + DR-037 placeholder go-live guard + the approval-debt KPI.
      "test/review/route-to-edit.test.ts",
      // audit-006 H1 (lane client-review): the credentialed-reviewer release route
      // (POST /api/review/release) — the previously-uncallable writer of
      // credentialed_releases. Proves the release IS persisted on a credentialed
      // reviewer's authorization, the DR-037 placeholder-in-production refusal, the
      // §11.5 inactive-authorization refusal, and that a CLIENT sign-off never
      // creates a credentialed release. Pure vitest, no DB.
      "test/review/release-route.test.ts",
      // PR 020 / P1.C.3 (worker-runtime): the SEO cost-ledger conditional-UPDATE
      // reservation / over-cap-rejection concurrency proof + per-run
      // reconciliation + sourcing-block rate + share-of-model rollup, plus the
      // Tier-1 structural assertions over the 0039 migration SQL.
      "test/ledger/**/*.test.ts",
      // PR 021 / P1.C.4 (DR-019 append-only carve-out): the SoM measurement
      // subsystem — the provider adapters (INERT gate + rate-limit budget +
      // vendor-fallback) and the ingest/freshness cron handlers (SOM_LIVE-unset
      // ⇒ zero probes; tenancy on the share_of_model write; freshness = draft
      // only, never publish). Tier-1, fully mocked (fake Gateway + fake adapters).
      "test/cron/**/*.test.ts",
      "test/metrics/**/*.test.ts",
      // DR-026 ACTIVATION (this PR): the gated go-live wiring — the activation
      // config gates (inert-by-default, publishEnabled OFF, DR-037 prod=>pilot:false
      // => placeholder refused), the content data-access DI composition
      // (NOT_WIRED default vs live-when-creds), and the live share_of_model store.
      // Tier-1, fully mocked (no DB, no provider key).
      "test/activation/**/*.test.ts",
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
