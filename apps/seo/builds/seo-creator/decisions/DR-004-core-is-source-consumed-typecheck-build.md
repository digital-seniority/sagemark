# DR-004 — core-is-source-consumed-typecheck-build

**Date:** 2026-06-25
**Run:** #001
**Status:** active
**Build phase:** Phase 0 — Foundations

## Context

PR 001 created `@sagemark/core` and defined its `build` script as `tsc --noEmit`. The package
is consumed as **source** (Next.js `transpilePackages` / a `./*: ./src/*.ts` export map),
emitting no `dist/`. Turbo prints a benign "no output files" warning.

## Problem

Whether `@sagemark/core` should be a built/emitted library (with `dist/` + `exports` → JS) or
a source-consumed TS package whose "build" is a typecheck.

## Chosen

**Source-consumed, `build = tsc --noEmit`.** Rationale: keeps the ports source-transpiled by
the consuming Next apps, avoids a build-artifact step, and matches the existing
`./*: ./src/*.ts` export map. Every future package that ports into `@sagemark/core` mirrors
this (typecheck-as-build).

## Consequences

- Convention: `@sagemark/core` (and core-adjacent packages) are **source-consumed**; `build`
  is a typecheck, not an emit. Don't add a `dist/` emit step or point `exports` at built JS
  without a DR superseding this.
- Turbo's "no output files" warning for `core#build` is expected, not a defect.
- Consumers must support transpiling TS from `node_modules`/workspace src (Next
  `transpilePackages`); a non-Next consumer would need its own transpile step.

## Revisit if

- A consumer that can't transpile workspace TS source needs `@sagemark/core` (then add an emit build).
- Build performance makes a cached `dist/` emit worthwhile.

## Related

- PR that prompted: P0.E.1
- Predecessor DRs: DR-001

---

*Authored by /seo-creator-build · Run #001 · 2026-06-25 19:40*
