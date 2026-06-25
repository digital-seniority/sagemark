# DR-008 — source-consumed-build-integrity

**Date:** 2026-06-25
**Run:** #004
**Status:** active (supersedes the blanket-relaxation part of DR-004)
**Build phase:** Phase 0 — Foundations

## Context

`@sagemark/core` is source-consumed by `apps/seo` (Next.js transpilePackages, DR-004). During
Run #004 the orchestrator discovered `pnpm --filter @sagemark/seo build` was RED on
origin/preview — for TWO independent reasons, both latent since Run #002:

1. **Strict-vs-relaxed tsconfig mismatch.** DR-004 set `noUncheckedIndexedAccess: false` in
   core's OWN tsconfig to let verbatim ports compile. So `pnpm --filter @sagemark/core build`
   (core's relaxed config) passed — but `apps/seo` type-checks core's SOURCE under the strict
   base config and failed on unchecked array indexing in `seo-gate.ts` (5) +
   `faq-schema-generator.ts` (12). **The per-lane judges missed it** because they only ran
   core's own build, never the consuming app's build. Fixed by corrective **C.004.1**: provably-
   in-bounds non-null assertions at the source sites + re-enabling `noUncheckedIndexedAccess`
   in core's tsconfig (tests excluded) so core's own build now guards the regression.
2. **Stale root node_modules.** Six dep-adding PRs merged without the orchestrator's root
   checkout re-running `pnpm install`, so `apps/seo`'s build couldn't resolve core's `@ai-sdk/*`
   deps (`module-not-found`). A `pnpm install` in the root fixed it (CI / fresh clone would
   install anyway — this was a local-environment artifact, not a repo defect).

## Decisions (durable)

1. **Source-consumed packages MUST be strict-clean.** Any package consumed as source by an app
   must typecheck under the app's strict base config. A package may NOT hide unchecked-index (or
   other strict) violations behind a relaxed OWN tsconfig — that just defers the failure to the
   consuming app's build. Tests may keep a relaxed posture (excluded from the package's strict
   typecheck), but production source may not. (This supersedes DR-004's blanket relaxation;
   DR-004's test-file intent survives.)
2. **The judge's build check must run the CONSUMING APP's build**, not only `--filter <package>
   build`, for any PR that touches a source-consumed package. Add to the engine-port judge
   routine: for a packages/core change, run `pnpm --filter @sagemark/seo build` (the integration
   build), not just `pnpm --filter @sagemark/core build`.
3. **The orchestrator runs `pnpm install` in its root checkout after any merge that changed a
   package.json / pnpm-lock.yaml**, before relying on a local build. (Phase 5.6 re-sync should
   include a conditional `pnpm install`.)

## Consequences

- `packages/core/tsconfig.json` now inherits `noUncheckedIndexedAccess: true` (tests excluded);
  a future unchecked-index in core source fails core's OWN build.
- Engine-port judges for source-consumed packages must verify the integration build.
- New deps added by a PR are only proven resolvable once the consuming app builds with them.

## Revisit if

- Core switches to an emitted (dist) build (then the strict-source requirement applies at emit).
- The monorepo adopts a different package-consumption model.

## Related

- Supersedes (part of): DR-004 · Corrective: C.004.1 (PR #10)
- PR that surfaced: P0.E.4 (Run #004) · Predecessor: DR-001, DR-004

---

*Authored by /seo-creator-build · Run #004 · 2026-06-25 20:50*
