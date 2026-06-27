/**
 * Worker session store — Tier-1 (no infra).
 *
 * Acceptance #1: a run's session/agent state is fully reconstructable from
 * durable storage AFTER teardown — a test "reloads a persisted run". We exercise
 * the full open -> persist-state -> (simulated VM teardown) -> reload round-trip
 * against the in-memory persistence (the production Supabase impl is the Tier-2
 * swap; see the PR report's NEEDS-INPUT run steps).
 *
 * Acceptance #4: a terminal failure releases the lease — `fail()` flips status to
 * 'error', records the terminal-error event, and nulls the lease (no zombie).
 */

import { describe, it, expect } from "vitest";
import {
  WorkerSessionStore,
  createInMemorySessionPersistence,
  NOT_WIRED_SESSION_PERSISTENCE,
  SessionStoreNotWiredError,
} from "@/worker/session-store";
import type { RunBinding } from "@/worker/host-tool-bridge";

const BINDING_A: RunBinding = {
  runId: "run-A-0001",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

describe("session-store — acceptance #1: reconstructable after teardown", () => {
  it("round-trips a run: open -> persistState -> teardown -> reload equals what was written", async () => {
    const persistence = createInMemorySessionPersistence();

    // Worker host #1 opens the run and persists progress as the loop runs.
    const store1 = new WorkerSessionStore(persistence);
    const opened = await store1.open({
      binding: BINDING_A,
      agentSessionId: "sdk-session-xyz",
      leaseId: "lease_run-A-0001",
      state: { step: "brief" },
    });
    await store1.persistState(BINDING_A.runId, {
      step: "draft",
      persistedPieceIds: ["piece-1"],
    });

    // Simulate microVM teardown: drop every in-process handle. Nothing of the run
    // lived on the VM — the only durable copy is in `persistence`.
    // (A fresh store proves reconstruction does not depend on the original object.)
    const storeAfterTeardown = new WorkerSessionStore(persistence);
    const reloaded = await storeAfterTeardown.reload(BINDING_A.runId);

    expect(reloaded).not.toBeNull();
    expect(reloaded!.runId).toBe(BINDING_A.runId);
    // Tenancy binding survives (re-verifiable on reload).
    expect(reloaded!.workspaceId).toBe(BINDING_A.workspaceId);
    expect(reloaded!.clientId).toBe(BINDING_A.clientId);
    // Agent-SDK resume key survives.
    expect(reloaded!.agentSessionId).toBe("sdk-session-xyz");
    // The latest persisted loop state survives (full cursor, not just the open).
    expect(reloaded!.state).toEqual({ step: "draft", persistedPieceIds: ["piece-1"] });
    expect(reloaded!.status).toBe("running");
    expect(opened.createdAt).toBeTruthy();
  });

  it("reload of an unknown run returns null (no fabrication)", async () => {
    const store = new WorkerSessionStore(createInMemorySessionPersistence());
    expect(await store.reload("nope")).toBeNull();
  });
});

describe("session-store — acceptance #4: terminal error releases the lease", () => {
  it("fail() marks error, records the terminal event, and nulls the lease", async () => {
    const persistence = createInMemorySessionPersistence();
    const store = new WorkerSessionStore(persistence);
    await store.open({ binding: BINDING_A, leaseId: "lease_run-A-0001" });

    const failed = await store.fail(BINDING_A.runId, {
      code: "WORKER_TIMEOUT",
      message: "exceeded wedge ceiling",
    });

    expect(failed.status).toBe("error");
    expect(failed.terminalError).toEqual({
      code: "WORKER_TIMEOUT",
      message: "exceeded wedge ceiling",
    });
    // Lease released — no zombie microVM holding a lease.
    expect(failed.leaseId).toBeNull();

    // And it persists: a reload sees the terminal state + released lease.
    const reloaded = await store.reload(BINDING_A.runId);
    expect(reloaded!.status).toBe("error");
    expect(reloaded!.leaseId).toBeNull();
  });

  it("complete() drops the lease and records final state", async () => {
    const store = new WorkerSessionStore(createInMemorySessionPersistence());
    await store.open({ binding: BINDING_A, leaseId: "lease_run-A-0001" });
    const done = await store.complete(BINDING_A.runId, { step: "done" });
    expect(done.status).toBe("completed");
    expect(done.leaseId).toBeNull();
    expect(done.state).toEqual({ step: "done" });
  });

  it("update() on an unknown run throws (no silent create)", async () => {
    const store = new WorkerSessionStore(createInMemorySessionPersistence());
    await expect(store.persistState("ghost", { x: 1 })).rejects.toThrow(/unknown worker session/);
  });
});

describe("session-store — fail-closed default (no infra wired)", () => {
  it("the NOT_WIRED default throws loudly rather than silently succeeding", async () => {
    const store = new WorkerSessionStore(NOT_WIRED_SESSION_PERSISTENCE);
    await expect(store.open({ binding: BINDING_A })).rejects.toBeInstanceOf(
      SessionStoreNotWiredError,
    );
  });
});
