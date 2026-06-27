/**
 * som-live-store.test.ts — the live share_of_model persistence store
 * (DR-026 activation, service-role, gated).
 *
 * Proves:
 *   1. INERT BY DEFAULT — with NO service-role creds, the factory returns null
 *      (the cron keeps NOT_WIRED_SOM_ROW_STORE).
 *   2. CREDS PRESENT — the factory returns a live store that INSERTs into
 *      `share_of_model` with the BOUND workspace_id/client_id and the per-engine
 *      `source_channel` label preserved VERBATIM. `@supabase/supabase-js` is mocked
 *      so there is no network.
 *   3. FAIL-LOUD — a write error throws (the cron logs a per-row miss).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let inserted: Array<{ table: string; row: Record<string, unknown> }> = [];
let nextError: unknown = null;

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          inserted.push({ table, row });
          return Promise.resolve({ error: nextError });
        },
      };
    },
  }),
}));

import { makeLiveShareOfModelRowStore } from "@/lib/metrics/som-live-store";
import type { ShareOfModelRowWrite } from "@/cron/ingest-share-of-model";

const SAVED = {
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

function clearCreds(): void {
  delete process.env.SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE;
}
function setCreds(): void {
  process.env.SUPABASE_URL = "https://stub.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub-key";
}

beforeEach(() => {
  inserted = [];
  nextError = null;
});
afterEach(() => {
  if (SAVED.url === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = SAVED.url;
  if (SAVED.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = SAVED.key;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE;
});

const ROW: ShareOfModelRowWrite = {
  workspaceId: "wwwwwwww-wwww-4www-8www-wwwwwwwwwwww",
  clientId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  pieceId: null,
  engine: "Claude",
  query: "best assisted living mount vernon",
  cited: true,
  position: 1,
  rawResponse: "raw",
  parserConf: 0.9,
  auditSampled: false,
  sourceChannel: "direct-citation",
  locale: "en-US",
  deviceProfile: "desktop",
};

describe("som-live-store: inert by default", () => {
  it("returns null when service-role creds are absent (cron keeps NOT_WIRED)", async () => {
    clearCreds();
    const store = await makeLiveShareOfModelRowStore();
    expect(store).toBeNull();
  });
});

describe("som-live-store: creds present", () => {
  it("inserts a row with BOUND tenancy + source_channel preserved verbatim", async () => {
    setCreds();
    const store = await makeLiveShareOfModelRowStore();
    expect(store).not.toBeNull();

    await store!.persistRow(ROW);

    expect(inserted).toHaveLength(1);
    expect(inserted[0].table).toBe("share_of_model");
    const row = inserted[0].row;
    // BOUND tenancy (never request input).
    expect(row.workspace_id).toBe(ROW.workspaceId);
    expect(row.client_id).toBe(ROW.clientId);
    // The per-engine citation-quality label preserved verbatim.
    expect(row.source_channel).toBe("direct-citation");
    expect(row.engine).toBe("Claude");
    expect(row.cited).toBe(true);
    // captured_at is the DB default (not written by the adapter).
    expect(row.captured_at).toBeUndefined();
  });

  it("fail-loud: a write error throws (the cron logs a per-row miss)", async () => {
    setCreds();
    nextError = { message: "constraint violation" };
    const store = await makeLiveShareOfModelRowStore();
    await expect(store!.persistRow(ROW)).rejects.toThrow(/persistRow failed/);
  });
});
