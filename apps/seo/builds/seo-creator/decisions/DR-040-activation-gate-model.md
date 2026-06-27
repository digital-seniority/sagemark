# DR-040 — Activation gate model (the single source of truth for "what is live")

**Status:** Accepted · **Date:** 2026-06-27 · **Run:** #24 (audit-006) · **Supersedes:** none · **Relates:** [[DR-026]] (data-access seam), [[DR-037]] (placeholder reviewer), [[DR-038]] (SoM activation), [[DR-013]] (Gateway-only metering)

## Context
The full v1 live pipeline (data layer, review, SoM, publish) shipped MERGED but **INERT on `preview`**: merging changed nothing live. The mechanism that keeps it inert — and the deliberate steps that turn it on — was implemented in `apps/seo/src/lib/activation.ts` (PR #74, `533e751`) but never recorded as a decision. audit-006 (spec-reconciler A.006.3 + state-historian GAP1) flagged the gap: the go-live posture rests on this module, yet it had no DR. DR-037 covers only the placeholder-reviewer guard, not the gate-resolution model itself.

## Decision
`activation.ts` is **the single source of truth for what is live**, via `resolveActivation()`, which is **safe-default-OFF** and reads only server-side env:

- **`publishEnabled`** = an explicit flag (`PUBLISH_ENABLED` or `CONTENT_PUBLISH_ENABLED`, `"1"|"true"`) **AND** service-role creds present. Both required — a flag without creds does not enable publishing.
- **`pilot`** = `!isProduction && envFlagOn(PILOT)`, where `isProduction` ≡ `VERCEL_ENV==='production'`. **Production forces `pilot:false` regardless of the flag** (the DR-037 interlock — the placeholder reviewer can never satisfy a real YMYL release in prod).
- **`somLive`** = explicit `SOM_LIVE`. Both crons short-circuit on `somLiveEnabled()` before any probe.
- **Resolvers** (`resolve-data-access.ts`, `resolve-public-data-access.ts`, `resolve-review-access.ts`, the SoM store) compose onto `NOT_WIRED_*` defaults when creds are absent → factory returns null → routes degrade fail-closed.

`VERCEL_ENV` is the production signal (not `NODE_ENV`) because it is set by the deploy target, not the build. Going live is the env flip documented in `go-live-checklist.md`; every step is reversible by unsetting its env.

## Consequences
- A single, testable boundary governs go-live; `test/activation/activation.test.ts` pins the matrix incl. the load-bearing "production ALWAYS `pilot:false` even with `PILOT=1`" case.
- The placeholder reviewer is blocked in production at two independent layers (this gate + `signoff.ts` `placeholder-in-production` refusal).
- **Open interlock (see audit-006 H1 / A.006.1):** `publishEnabled` gates the publish *route*, but no route yet *writes* a `credentialed_release`, so publishing is functionally blocked until `recordCredentialedRelease` is wired with `pilot: isPilot()`. The gate model is correct; the release-write path is the missing half.
- Any new live capability MUST route its enablement through `resolveActivation` (not ad-hoc `process.env` reads) — see the divergent `defaultPublishEnabled` (A.006.3) as the anti-pattern to converge.

## Alternatives considered
- **Per-feature env reads scattered across routes** — rejected: no single auditable "what's live" surface; the `defaultPublishEnabled` divergence is exactly this failure in miniature.
- **A runtime feature-flag service** — rejected for v1 (one client, one deploy); env flags + creds-presence are sufficient and reversible.

## References
`apps/seo/src/lib/activation.ts`; `test/activation/*`; `go-live-checklist.md`; audit-006 §DR-040.
