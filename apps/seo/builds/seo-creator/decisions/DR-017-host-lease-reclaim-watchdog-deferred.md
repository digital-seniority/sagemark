# DR-017 — host-lease-reclaim-watchdog-deferred

**Date:** 2026-06-26
**Run:** #008
**Status:** active
**Build phase:** Phase 0 — Foundations

## Context

P0.W.2 acceptance #4 ("a wedged/timed-out Sandbox emits a terminal error and releases its
lease within a ceiling — no zombie microVM") has two halves:
1. **In-VM / per-run (built):** `runAgentLoop` races the loop against a wedge ceiling →
   `WORKER_TIMEOUT` terminal event + `onTerminalError`; `Sandbox.create({ timeout })` is the
   VM-level backstop; `session-store.fail()` flips status to `error` and nulls `leaseId`.
2. **Host-side reclaim (deferred):** an actual long-running **host orchestrator** that holds
   the warm-pool, watches leases against the ceiling, and wires `onTerminalError →
   store.fail() → sandbox.stop()/wipeForHandoff` end-to-end is NOT built in P0.W.2.

P0.W.2 ships the building blocks (`launchSandbox`, `wipeForHandoff`, `WorkerSessionStore`,
the `VmLease` contract) as a **library**; nothing in the deployed app instantiates a
running warm-pool/lease manager yet.

## Decision

The host-side **lease-reclaim watchdog + warm-pool manager is deferred to the
host-orchestrator PR** (the PR that actually runs the worker fleet — `/api/run` provisioning
+ pool lifecycle). P0.W.2's thinnest-slice scope is the worker host + its fail-closed
primitives, not the always-on fleet manager. Acceptance #4 is therefore **unit-proven**
(the timeout race, the lease-null-out, the VM-level timeout) with end-to-end reclaim wired
later.

## Consequences

- Until the host orchestrator lands, the worker is **dormant** (no caller) — so there is no
  zombie-VM risk in production (nothing leases a VM). This is the safe ordering.
- The next worker-lane PR (or a dedicated host-orchestrator PR) must: instantiate the
  warm-pool, run the ceiling watchdog, and wire `onTerminalError → store.fail() →
  stop()/wipeForHandoff`, with a Tier-2 test that a wedged run is actually reclaimed.
- Gate the orchestrator's launch behind `SEO_WORKER_ENABLED` (the P0.W.2 rollback flag).

Links: [[DR-010]]/[[DR-011]] (the fail-closed profile the primitives apply), [[DR-016]] (worker model seam).
