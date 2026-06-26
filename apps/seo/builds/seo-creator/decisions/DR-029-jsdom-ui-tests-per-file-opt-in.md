# DR-029 — jsdom-ui-tests-per-file-opt-in

**Date:** 2026-06-26
**Run:** #017 (P1.U.2 / PR 011)
**Status:** active
**Build phase:** Phase 1 — Pilot

## Context

apps/seo's vitest ran `environment: "node"` with no DOM runner, so UI interaction was untested (the P1.U.1 escalation). P1.U.2 added the first DOM tests (live editor streaming + Inspector scorecard) and needed a DOM environment without breaking the existing node-env suites (routes, lib, the react-dom/server smoke test).

## Decision

**apps/seo gains jsdom + @testing-library/react (+ /dom, /jest-dom) as devDeps; DOM tests opt in PER-FILE via `// @vitest-environment jsdom` (+ a local `setup-dom` import), NOT a global `setupFiles`/`environmentMatchGlobs`/projects config.** Default env stays `node`. This is the standing pattern for all future apps/seo UI tests.

## Consequences

- New interactive UI tests: name them `*.dom.test.tsx` under `test/ui/`, add `// @vitest-environment jsdom` + import the shared `test/ui/setup-dom.ts`. They run under jsdom; everything else stays node (fast, no DOM globals leaking into route/lib tests; the react-dom/server smoke test is preserved).
- The UI lane now has real interaction-test capability — PR 011 onward (live editor, edit loop, version hub) can gate behavior, not defer it to Tier-3.
- jsdom/@testing-library are in `apps/seo` devDeps; pnpm-lock committed (CI `--frozen-lockfile` stays green).

## Revisit if

- The per-file directive proves error-prone (then consider `environmentMatchGlobs` for `test/ui/**`).
- Component interaction outgrows jsdom (then add Playwright component tests).

## Related

- Anchor: engineering-rfc.md PR 011; resolves the P1.U.1 (PR 010) DOM-test-runner escalation (audit/run-016)
- PR: P1.U.2 (PR 011)

---

*Authored by /seo-creator-build · Run #017 · 2026-06-26*
