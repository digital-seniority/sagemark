/**
 * Tier-1 SoM ingestion-cron tests (PR 021 / P1.C.4) — fully mocked.
 *
 * Proves: SOM_LIVE-unset ⇒ ZERO probe calls + nothing persisted (the INERT
 * proof); the persisted `share_of_model` row shape (incl. stored prompt + raw
 * response + parser_conf + audit_sampled + source_channel + locale + device); the
 * BOUND tenancy on the write (workspace_id + client_id, never request input); a
 * degraded engine logs a miss + heartbeat without crashing; the rate-limit defer;
 * the heartbeat is emitted.
 *
 * Runner: vitest (node env) — globbed via `test/cron/**` in vitest.config.ts.
 */

import { describe, expect, it, vi } from "vitest";

import {
  runShareOfModelIngest,
  NOT_WIRED_SOM_ROW_STORE,
  ShareOfModelRowStoreNotWiredError,
  type ShareOfModelRowStore,
  type ShareOfModelRowWrite,
  type IngestTarget,
} from "@/cron/ingest-share-of-model";
import {
  makeDefaultSomAdapters,
  type SomAdapter,
  type SomProbeOutcome,
  type DirectProbeRunner,
} from "@/lib/metrics/som-adapters";

const TARGET: IngestTarget = {
  workspaceId: "ws-1",
  clientId: "client-1",
  clientKey: "whispering-willows",
};

/** An in-memory row store that records every persisted row. */
class RecordingStore implements ShareOfModelRowStore {
  readonly rows: ShareOfModelRowWrite[] = [];
  persistRow(row: ShareOfModelRowWrite): Promise<void> {
    this.rows.push(row);
    return Promise.resolve();
  }
}

/** A spy adapter recording probe calls, returning a fixed outcome. */
function spyAdapter(
  engine: SomAdapter["engine"],
  outcome: SomProbeOutcome,
): { adapter: SomAdapter; probe: ReturnType<typeof vi.fn> } {
  const probe = vi.fn(async () => outcome);
  const adapter: SomAdapter = {
    engine,
    budget: { maxRequestsPerWindow: 1000, windowMs: 1000 },
    probe,
  };
  return { adapter, probe };
}

// ── INERT PROOF ─────────────────────────────────────────────────────────────────

describe("INERT: SOM_LIVE unset ⇒ ZERO probes", () => {
  it("makes zero probe calls and persists nothing", async () => {
    const { adapter, probe } = spyAdapter("ChatGPT", {
      status: "ok",
      result: {
        engine: "ChatGPT",
        rawResponse: "x",
        cited: true,
        position: 1,
        parserConf: 0.9,
        locale: "en-US",
        deviceProfile: "desktop",
        sourceChannel: "direct-citation",
      },
    });
    const store = new RecordingStore();

    const result = await runShareOfModelIngest([TARGET], {
      adapters: [adapter],
      store,
      env: {} as NodeJS.ProcessEnv, // SOM_LIVE unset
      now: () => 1000,
    });

    expect(result.skipped).toBe(true);
    expect(result.probes).toBe(0);
    expect(probe).not.toHaveBeenCalled();
    expect(store.rows).toHaveLength(0);
    // Even SKIPPED, the cron emits a heartbeat (no silent stall).
    expect(result.heartbeats.some((h) => h.note.includes("skipped"))).toBe(true);
  });

  it("the default-built adapters themselves are inert with SOM_LIVE unset", async () => {
    // Wire the REAL default adapters with fake channel seams; the cron is flagged
    // off, so probe() is never reached — a belt-and-braces inert proof.
    const directRunner = vi.fn<DirectProbeRunner>();
    const adapters = makeDefaultSomAdapters({ directRunner, env: {} as NodeJS.ProcessEnv });
    const store = new RecordingStore();
    const result = await runShareOfModelIngest([TARGET], {
      adapters,
      store,
      env: {} as NodeJS.ProcessEnv,
    });
    expect(result.probes).toBe(0);
    expect(directRunner).not.toHaveBeenCalled();
    expect(store.rows).toHaveLength(0);
  });
});

// ── Persisted row shape + tenancy ─────────────────────────────────────────────────

describe("persisted share_of_model row (shape + tenancy)", () => {
  it("persists a fully-shaped, tenancy-BOUND row for an ok probe", async () => {
    const { adapter } = spyAdapter("Claude", {
      status: "ok",
      result: {
        engine: "Claude",
        rawResponse: "Whispering Willows of Mount Vernon is recommended.",
        cited: true,
        position: 1,
        parserConf: 0.95,
        locale: "en-US",
        deviceProfile: "desktop",
        sourceChannel: "direct-citation",
      },
    });
    const store = new RecordingStore();

    const result = await runShareOfModelIngest([TARGET], {
      adapters: [adapter],
      store,
      env: { SOM_LIVE: "1" } as NodeJS.ProcessEnv,
      now: () => 1000,
      auditSampleRate: 0,
    });

    expect(result.skipped).toBe(false);
    // One row per (query, engine); the bank has 28 prompts × 1 engine here.
    expect(store.rows).toHaveLength(28);
    expect(result.persisted).toBe(28);

    const row = store.rows[0];
    // Tenancy is the BOUND workspace + client (never request input).
    expect(row.workspaceId).toBe("ws-1");
    expect(row.clientId).toBe("client-1");
    expect(row.pieceId).toBeNull();
    // The full 0039 column set is carried.
    expect(row.engine).toBe("Claude");
    expect(typeof row.query).toBe("string");
    expect(row.query).toBe(row.query.toLowerCase()); // normalized (lowercased)
    expect(row.cited).toBe(true);
    expect(row.position).toBe(1);
    expect(row.rawResponse).toContain("Whispering Willows");
    expect(row.parserConf).toBe(0.95);
    expect(row.auditSampled).toBe(false); // rate 0
    expect(row.sourceChannel).toBe("direct-citation");
    expect(row.locale).toBe("en-US");
    expect(row.deviceProfile).toBe("desktop");
  });

  it("an unscored cited (null) fails closed to NOT cited (never fabricated)", async () => {
    const { adapter } = spyAdapter("Gemini", {
      status: "ok",
      result: {
        engine: "Gemini",
        rawResponse: "",
        cited: null,
        position: null,
        parserConf: 0.2,
        locale: "en-US",
        deviceProfile: "desktop",
        sourceChannel: "direct-citation",
      },
    });
    const store = new RecordingStore();
    await runShareOfModelIngest([TARGET], {
      adapters: [adapter],
      store,
      env: { SOM_LIVE: "1" } as NodeJS.ProcessEnv,
    });
    expect(store.rows.every((r) => r.cited === false)).toBe(true);
  });

  it("audit sampling flags a deterministic, non-empty subset (rate 1 = all)", async () => {
    const { adapter } = spyAdapter("Claude", {
      status: "ok",
      result: {
        engine: "Claude",
        rawResponse: "x",
        cited: false,
        position: null,
        parserConf: 0.9,
        locale: "en-US",
        deviceProfile: "desktop",
        sourceChannel: "direct-citation",
      },
    });
    const store = new RecordingStore();
    const result = await runShareOfModelIngest([TARGET], {
      adapters: [adapter],
      store,
      env: { SOM_LIVE: "1" } as NodeJS.ProcessEnv,
      auditSampleRate: 1,
    });
    expect(result.auditSampled).toBe(28);
    expect(store.rows.every((r) => r.auditSampled === true)).toBe(true);
  });
});

// ── Degraded engine + deferral + heartbeat ────────────────────────────────────────

describe("degraded engine never crashes the cron", () => {
  it("a missed engine is logged + heartbeated, the run still completes", async () => {
    const ok = spyAdapter("Claude", {
      status: "ok",
      result: {
        engine: "Claude",
        rawResponse: "Whispering Willows",
        cited: true,
        position: 1,
        parserConf: 0.9,
        locale: "en-US",
        deviceProfile: "desktop",
        sourceChannel: "direct-citation",
      },
    });
    const miss = spyAdapter("ChatGPT", {
      status: "miss",
      engine: "ChatGPT",
      reason: "rate limited by provider",
    });
    const store = new RecordingStore();

    const result = await runShareOfModelIngest([TARGET], {
      adapters: [ok.adapter, miss.adapter],
      store,
      env: { SOM_LIVE: "1" } as NodeJS.ProcessEnv,
    });

    expect(result.skipped).toBe(false);
    expect(result.misses).toBe(28); // one miss per prompt for ChatGPT
    expect(result.persisted).toBe(28); // Claude persisted
    expect(result.heartbeats.some((h) => h.note.includes("miss"))).toBe(true);
    expect(result.heartbeats.some((h) => h.note.startsWith("ok:"))).toBe(true);
  });

  it("an adapter that THROWS is caught as a miss (no crash)", async () => {
    const thrower: SomAdapter = {
      engine: "ChatGPT",
      budget: { maxRequestsPerWindow: 1000, windowMs: 1000 },
      probe: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const store = new RecordingStore();
    const result = await runShareOfModelIngest([TARGET], {
      adapters: [thrower],
      store,
      env: { SOM_LIVE: "1" } as NodeJS.ProcessEnv,
    });
    expect(result.misses).toBe(28);
    expect(result.persisted).toBe(0);
  });

  it("a deferred probe is counted + heartbeated, not persisted", async () => {
    const deferred = spyAdapter("Gemini", {
      status: "deferred",
      engine: "Gemini",
      reason: "over budget",
    });
    const store = new RecordingStore();
    const result = await runShareOfModelIngest([TARGET], {
      adapters: [deferred.adapter],
      store,
      env: { SOM_LIVE: "1" } as NodeJS.ProcessEnv,
    });
    expect(result.deferred).toBe(28);
    expect(store.rows).toHaveLength(0);
  });
});

// ── NOT_WIRED store is fail-closed ────────────────────────────────────────────────

describe("NOT_WIRED row store", () => {
  it("throws ShareOfModelRowStoreNotWiredError if reached live", () => {
    expect(() =>
      NOT_WIRED_SOM_ROW_STORE.persistRow({} as ShareOfModelRowWrite),
    ).toThrow(ShareOfModelRowStoreNotWiredError);
  });

  it("a persist failure on one row degrades to a miss (cron continues)", async () => {
    const failing: ShareOfModelRowStore = {
      persistRow: vi.fn(async () => {
        throw new Error("db down");
      }),
    };
    const { adapter } = spyAdapter("Claude", {
      status: "ok",
      result: {
        engine: "Claude",
        rawResponse: "x",
        cited: false,
        position: null,
        parserConf: 0.9,
        locale: "en-US",
        deviceProfile: "desktop",
        sourceChannel: "direct-citation",
      },
    });
    const result = await runShareOfModelIngest([TARGET], {
      adapters: [adapter],
      store: failing,
      env: { SOM_LIVE: "1" } as NodeJS.ProcessEnv,
    });
    expect(result.persisted).toBe(0);
    expect(result.misses).toBe(28);
  });
});
