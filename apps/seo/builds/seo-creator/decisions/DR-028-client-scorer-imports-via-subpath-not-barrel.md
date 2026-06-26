# DR-028 — client-scorer-imports-via-subpath-not-barrel

**Date:** 2026-06-26
**Run:** #017 (P1.U.2 / PR 011)
**Status:** active
**Build phase:** Phase 1 — Pilot

## Context

P1.U.2's `use-client-scorers.ts` runs the deterministic `@sagemark/core` scorers client-side (zero-credit live sidebar preview). Importing them from the package barrel (`@sagemark/core`) broke the client build: the barrel `index.ts` re-exports `./gates/faithfulness-gate` + `./gates/voice-gate`, both of which `import "server-only"` — pulling that into a Client Component is a hard `next build` failure.

## Decision

**Client/browser code MUST import `@sagemark/core` deterministic scorers via per-scorer subpaths (`@sagemark/core/scorers/<name>`), never the package barrel.** The package's `"./*": "./src/*.ts"` export map makes the subpaths available. The barrel is server-safe only.

## Consequences

- Every future agent-ui surface wanting deterministic preview signal imports scorers by subpath (`@sagemark/core/scorers/flesch-kincaid`, etc.), not `@sagemark/core`.
- The barrel re-exporting `server-only` gates is the trap; do NOT "fix" it by removing `server-only` from the gates (that would let secrets/gate logic into client bundles). The subpath discipline is the correct guard.
- Consider (future) a lint rule or a `@sagemark/core/scorers` client-safe sub-barrel that excludes the server-only gates, so the discipline is enforced not just documented.

## Revisit if

- A client-safe scorers sub-barrel is added (then import from it).
- The package export map changes.

## Related

- Anchor: engineering-rfc.md PR 011; [[DR-004]] (core source-consumed), [[DR-008]] (source-consumed build integrity)
- PR: P1.U.2 (PR 011)

---

*Authored by /seo-creator-build · Run #017 · 2026-06-26*
