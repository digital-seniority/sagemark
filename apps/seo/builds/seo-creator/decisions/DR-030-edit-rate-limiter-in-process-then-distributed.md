# DR-030 — edit-rate-limiter-in-process-then-distributed

**Date:** 2026-06-26
**Run:** #018 (P1.U.3 / PR 012)
**Status:** active
**Build phase:** Phase 1 — Pilot

## Context

P1.U.3's `/api/edit` enforces a per-tenant rate-limit (429). It ships an in-process fixed-window limiter (`inProcessRateLimiter`, a per-process `Map` keyed `${workspaceId}:${clientId}`) behind an injectable `RateLimiter` seam.

## Decision

**Ship the in-process limiter now (single-instance / dev), with the `RateLimiter` as an injectable seam; swap to a shared/distributed (KV/Redis) impl BEFORE any multi-instance or serverless-fan-out deploy.** On a multi-instance deployment the per-process budget multiplies by instance count and the runaway-loop protection weakens — so the swap is a hard pre-multi-instance-deploy gate, not optional.

## Consequences

- The seam is injectable → the swap is a clean drop (no route change).
- **Go-live gate:** before horizontal scale, wire a shared limiter (Vercel KV / Upstash Redis / Marketplace) keyed identically `(workspace_id, client_id)`. Add it to the deploy checklist alongside the live-Sandbox/secrets items.
- Minor (judge nit, non-blocking): the stale-edit 409 currently consumes a rate token (order: ownership→rate-limit→load→stale); consider moving the stale check ahead of `take()` or refunding on 409 when the distributed limiter lands.

## Revisit if

- apps/seo goes multi-instance/serverless (MUST swap first).
- Abuse patterns need a sliding window / cost-weighted budget.

## Related

- Anchor: engineering-rfc.md PR 012 (§7 edit loop); prd.md §7
- PR: P1.U.3 (PR 012)

---

*Authored by /seo-creator-build · Run #018 · 2026-06-26*
