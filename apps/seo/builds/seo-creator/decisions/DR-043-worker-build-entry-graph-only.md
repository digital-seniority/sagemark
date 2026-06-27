# DR-043 — Worker is compiled by a separate entry-graph-only tsc pass

**Status:** Accepted · **Date:** 2026-06-27 · **Run:** worker stand-up · **Relates:** [[DR-011]] (no-shell worker), [[DR-004]] (@sagemark/core source-consumed), [[DR-016]] (worker env seam)

## Context
The worker Dockerfile `COPY apps/seo/dist/` + `ENTRYPOINT node dist/worker/entry.js`, but no build step produced `dist/` (`apps/seo` only had `next build`). The worker shares the `apps/seo` source tree with the Next app, including host-only modules that import `server-only` and `@sagemark/core` — which must NOT enter the Sandbox image.

## Decision
Add `apps/seo/tsconfig.worker.json` + `"build:worker": "tsc -p tsconfig.worker.json"`:
- **CommonJS / node resolution** — `apps/seo/package.json` has no `"type":"module"`, so emitted `.js` is CJS; the worker entry uses no top-level await / `import.meta`, so CJS runs the extensionless relative imports as-is (ESM/NodeNext would error on them).
- **`rootDir: src` → `outDir: dist`** maps `src/worker/entry.ts` → `dist/worker/entry.js` (the exact Dockerfile ENTRYPOINT) and preserves the `../lib/...` layout.
- **`include: ["src/worker/entry.ts"]` only** — tsc follows the import graph and emits ONLY the reachable files. This deliberately EXCLUDES host-only siblings (`session-store.ts`, `emit.ts`, anything importing `server-only`/`@sagemark/core`), keeping them out of the image. `@sagemark/core` is unreachable from entry, so the worker compile needs no core resolution; `@anthropic-ai/claude-agent-sdk` is a dynamic `import()` (not a static compile dep).
- **`build` stays `next build` (separate)** — the Sandbox image build runs `build:worker` as its own concern; coupling would make `next build` emit worker output. `apps/seo/dist/` is gitignored (build output never committed).

## Consequences
- The Sandbox image has a runnable, minimal worker (`dist/worker/entry.js` smoke-loads + fails closed on missing env).
- **Invariant (load-bearing, brittle to silent regressions):** the worker entry graph MUST NOT import `server-only` or `@sagemark/core`. A future edit adding such an import to a reachable worker file would either break the compile or drag host-only code into the Sandbox. A judge/CI check enforcing "no `server-only`/`@sagemark/core` in the worker entry graph" would harden this (candidate structured check).

## Alternatives considered
- **Bundler (esbuild/tsup) single-file** — rejected: extra dep; tsc already present.
- **`include: src/worker/**`** — rejected: drags host-only deps (server-only/core) into the image.
- **Ship TS + ts-node in-image** — rejected: heavier image, slower boot.

## References
`apps/seo/tsconfig.worker.json`; `apps/seo/package.json` (`build:worker`); `apps/seo/src/worker/Dockerfile`; `.gitignore`.
