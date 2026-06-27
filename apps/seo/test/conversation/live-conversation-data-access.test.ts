/**
 * live-conversation-data-access.test.ts — the LIVE ConversationDataAccess adapter
 * (Slice 5, lane schema-tenancy).
 *
 * Exercises `LiveConversationDataAccess` against an IN-MEMORY FAKE Supabase
 * service-role client (no network, no live DB). The fake is a chainable PostgREST
 * spy: `.from(table).select(cols).eq(col,val).order(...).limit(n)` is awaitable to
 * `{ data, error }` and supports `.maybeSingle()`; `.insert(row).select(cols).single()`
 * and `.update(patch).eq(...)` for writes. The fake APPLIES the recorded `.eq()`
 * filters in-memory (so a wrong tenancy filter produces a different — usually empty
 * — result, exactly like the DB) and RECORDS every query so each test can prove the
 * EXACT tenancy filter.
 *
 * The load-bearing proofs (tenancy + fail-closed), per method:
 *   (a) the correct TABLE is hit with the EXPLICIT workspace_id AND client_id
 *       filter (service-role bypasses RLS — the app filter IS the boundary);
 *   (b) a CROSS-TENANT (workspace_id, client_id) pair resolves to null / empty (no
 *       leak) BY CONSTRUCTION — the recorded filters do not match the row;
 *   (c) writes carry the BOUND workspace_id + client_id in the INSERT payload;
 *   (d) setConversationPiece scopes its UPDATE by the bound tenancy + is idempotent.
 *
 * Tier-2 (live pg / Supabase) is NEEDS-INPUT — no psql / live DB in this env.
 */
import { describe, it, expect } from "vitest";
import {
  LiveConversationDataAccess,
  type ConversationSupabase,
} from "@/lib/conversation/live-conversation-data-access";
import { ConversationPieceConflictError } from "@/lib/conversation/context";

// ── fixtures (valid RFC-4122 v4 UUIDs) ──────────────────────────────
const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const CLIENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONV_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PIECE_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PIECE_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

// ── In-memory fake chainable PostgREST client (read + write) ────────

interface RecordedOp {
  table: string;
  op: "select" | "insert" | "update";
  /** Insert/update payload (the row / patch). */
  payload: Record<string, unknown> | null;
  eq: Array<[string, string | number]>;
  order: Array<[string, boolean]>;
  limit: number | null;
}

/**
 * Build a fake `ConversationSupabase`. `tables` maps a table name to its rows; the
 * fake applies the recorded `.eq()` filters in-memory for reads (so a wrong tenancy
 * filter yields a different result, like the DB), appends INSERTs (assigning an id),
 * and applies UPDATEs to rows matching the recorded `.eq()` filters. `uniqueOn`
 * declares per-table unique tuples so a duplicate INSERT returns an error (mirrors
 * the DB unique index). Every op is recorded for assertion.
 */
function makeFakeSupabase(
  tables: Record<string, Record<string, unknown>[]>,
  uniqueOn: Record<string, string[]> = {},
) {
  const ops: RecordedOp[] = [];
  let idSeq = 0;
  const nextId = () => `generated-id-${(idSeq += 1)}`;

  function makeQuery(table: string) {
    const rec: RecordedOp = { table, op: "select", payload: null, eq: [], order: [], limit: null };
    ops.push(rec);

    function resolveRows(): Record<string, unknown>[] {
      let rows = (tables[table] ?? []).slice();
      for (const [col, val] of rec.eq) rows = rows.filter((r) => r[col] === val);
      for (const [col, asc] of rec.order) {
        rows.sort((a, b) => {
          const av = a[col] as number | string;
          const bv = b[col] as number | string;
          if (av === bv) return 0;
          const cmp = av < bv ? -1 : 1;
          return asc ? cmp : -cmp;
        });
      }
      if (rec.limit !== null) rows = rows.slice(0, rec.limit);
      return rows;
    }

    const builder = {
      eq(col: string, val: string | number) {
        rec.eq.push([col, val]);
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        rec.order.push([col, opts?.ascending !== false]);
        return builder;
      },
      limit(n: number) {
        rec.limit = n;
        return builder;
      },
      async maybeSingle() {
        return { data: resolveRows()[0] ?? null, error: null };
      },
      then<R>(onfulfilled?: (v: { data: Record<string, unknown>[]; error: null }) => R) {
        return Promise.resolve({ data: resolveRows(), error: null as null }).then(onfulfilled);
      },
    };
    return builder;
  }

  function makeMutation(table: string, op: "insert" | "update", payload: Record<string, unknown>) {
    const rec: RecordedOp = { table, op, payload, eq: [], order: [], limit: null };
    ops.push(rec);

    function apply(): { rows: Record<string, unknown>[]; error: unknown } {
      const rows = (tables[table] ??= []);
      if (op === "insert") {
        const uniqueCols = uniqueOn[table];
        if (uniqueCols && rows.find((r) => uniqueCols.every((c) => r[c] === payload[c]))) {
          return { rows: [], error: { code: "23505", message: `duplicate key on ${uniqueCols.join(",")}` } };
        }
        const inserted = { id: nextId(), ...payload };
        rows.push(inserted);
        return { rows: [inserted], error: null };
      }
      const matched = rows.filter((r) => rec.eq.every(([c, v]) => r[c] === v));
      for (const r of matched) Object.assign(r, payload);
      return { rows: matched, error: null };
    }

    const builder = {
      eq(col: string, val: string | number) {
        rec.eq.push([col, val]);
        return builder;
      },
      select() {
        return builder;
      },
      async single() {
        const { rows, error } = apply();
        if (error) return { data: null, error };
        return { data: rows[0] ?? null, error: null };
      },
      then<R>(onfulfilled?: (v: { data: Record<string, unknown>[]; error: unknown }) => R) {
        const { rows, error } = apply();
        return Promise.resolve({ data: rows, error }).then(onfulfilled);
      },
    };
    return builder;
  }

  const supabase: ConversationSupabase = {
    from(table: string) {
      return {
        select: () => makeQuery(table),
        insert: (row: Record<string, unknown>) => makeMutation(table, "insert", row),
        update: (patch: Record<string, unknown>) => makeMutation(table, "update", patch),
      };
    },
  };
  return { supabase, ops };
}

/** Assert a recorded op (op type optional) hit `table` and applied the given eq filters (subset). */
function assertEqFilters(
  ops: RecordedOp[],
  table: string,
  op: RecordedOp["op"],
  expected: Array<[string, string | number]>,
) {
  const q = ops.find((x) => x.table === table && x.op === op);
  expect(q, `expected a ${op} against ${table}`).toBeDefined();
  for (const [col, val] of expected) {
    expect(q!.eq).toContainEqual([col, val]);
  }
}

// ── createConversation ──────────────────────────────────────────────

describe("live-conversation-data-access: createConversation (bound tenancy in payload)", () => {
  it("inserts with the BOUND workspace_id + client_id; omits status/piece_id (DB defaults)", async () => {
    const { supabase, ops } = makeFakeSupabase({ conversations: [] });
    const data = new LiveConversationDataAccess(supabase);

    const id = await data.createConversation({ workspaceId: WS_A, clientId: CLIENT_A, title: "T" });
    expect(id).toBe("generated-id-1");

    const insert = ops.find((o) => o.table === "conversations" && o.op === "insert");
    expect(insert).toBeDefined();
    expect(insert!.payload).toMatchObject({ workspace_id: WS_A, client_id: CLIENT_A, title: "T" });
    // status / piece_id are NOT set on the insert (the DB defaults 'active', null apply).
    expect(insert!.payload).not.toHaveProperty("status");
    expect(insert!.payload).not.toHaveProperty("piece_id");
  });
});

// ── getConversation ─────────────────────────────────────────────────

describe("live-conversation-data-access: getConversation (id + workspace_id + client_id)", () => {
  const convRow = {
    id: CONV_A,
    workspace_id: WS_A,
    client_id: CLIENT_A,
    piece_id: null,
    title: "Thread",
    status: "active",
    created_at: "2026-06-27T00:00:00.000Z",
    updated_at: "2026-06-27T00:00:00.000Z",
  };

  it("loads + maps a conversation scoped by (id, workspace_id, client_id)", async () => {
    const { supabase, ops } = makeFakeSupabase({ conversations: [convRow] });
    const data = new LiveConversationDataAccess(supabase);

    const got = await data.getConversation(CONV_A, WS_A, CLIENT_A);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(CONV_A);
    expect(got!.status).toBe("active");
    expect(got!.pieceId).toBeNull();
    assertEqFilters(ops, "conversations", "select", [
      ["id", CONV_A],
      ["workspace_id", WS_A],
      ["client_id", CLIENT_A],
    ]);
  });

  it("cross-tenant workspace resolves to null (no leak) by construction", async () => {
    const { supabase } = makeFakeSupabase({ conversations: [convRow] });
    const data = new LiveConversationDataAccess(supabase);
    // CONV_A under WS_B does not match the recorded workspace_id filter → null.
    expect(await data.getConversation(CONV_A, WS_B, CLIENT_A)).toBeNull();
  });

  it("cross-tenant client resolves to null (no leak) by construction", async () => {
    const { supabase } = makeFakeSupabase({ conversations: [convRow] });
    const data = new LiveConversationDataAccess(supabase);
    expect(await data.getConversation(CONV_A, WS_A, CLIENT_B)).toBeNull();
  });

  it("an unmappable row (missing required status) resolves to null — fail-closed", async () => {
    const { supabase } = makeFakeSupabase({ conversations: [{ ...convRow, status: undefined }] });
    const data = new LiveConversationDataAccess(supabase);
    expect(await data.getConversation(CONV_A, WS_A, CLIENT_A)).toBeNull();
  });
});

// ── listConversations ───────────────────────────────────────────────

describe("live-conversation-data-access: listConversations (workspace_id + client_id)", () => {
  const conv = (id: string, ws: string, cl: string) => ({
    id,
    workspace_id: ws,
    client_id: cl,
    piece_id: null,
    title: id,
    status: "active",
    created_at: "2026-06-27T00:00:00.000Z",
    updated_at: "2026-06-27T00:00:00.000Z",
  });

  it("lists ONLY the bound tenancy's conversations; cross-tenant → [] by construction", async () => {
    const { supabase, ops } = makeFakeSupabase({
      conversations: [conv("conv-a", WS_A, CLIENT_A), conv("conv-other", WS_B, CLIENT_B)],
    });
    const data = new LiveConversationDataAccess(supabase);

    const mine = await data.listConversations(WS_A, CLIENT_A);
    expect(mine.map((c) => c.id)).toEqual(["conv-a"]);
    assertEqFilters(ops, "conversations", "select", [
      ["workspace_id", WS_A],
      ["client_id", CLIENT_A],
    ]);

    // A foreign tenancy sees none of WS_A/CLIENT_A's rows.
    expect(await data.listConversations(WS_B, CLIENT_A)).toHaveLength(0);
  });
});

// ── listTurns ───────────────────────────────────────────────────────

describe("live-conversation-data-access: listTurns (conversation_id + workspace_id + client_id, ordered by seq)", () => {
  const turn = (seq: number, ws = WS_A, cl = CLIENT_A) => ({
    id: `turn-${seq}`,
    conversation_id: CONV_A,
    workspace_id: ws,
    client_id: cl,
    seq,
    role: seq % 2 === 0 ? "user" : "agent",
    content: `c-${seq}`,
    run_id: null,
    piece_version: null,
    verdict: null,
    created_at: "2026-06-27T00:00:00.000Z",
  });

  it("returns turns ordered by seq for the bound tenancy", async () => {
    const { supabase, ops } = makeFakeSupabase({
      conversation_turns: [turn(2), turn(0), turn(1)],
    });
    const data = new LiveConversationDataAccess(supabase);

    const turns = await data.listTurns(CONV_A, WS_A, CLIENT_A);
    expect(turns.map((t) => t.seq)).toEqual([0, 1, 2]);
    assertEqFilters(ops, "conversation_turns", "select", [
      ["conversation_id", CONV_A],
      ["workspace_id", WS_A],
      ["client_id", CLIENT_A],
    ]);
  });

  it("cross-tenant conversation id resolves to [] (no turn leak) by construction", async () => {
    const { supabase } = makeFakeSupabase({ conversation_turns: [turn(0), turn(1)] });
    const data = new LiveConversationDataAccess(supabase);
    expect(await data.listTurns(CONV_A, WS_B, CLIENT_A)).toHaveLength(0);
    expect(await data.listTurns(CONV_A, WS_A, CLIENT_B)).toHaveLength(0);
  });

  it("omits an unmappable turn row (missing required role) — fail-closed", async () => {
    const { supabase } = makeFakeSupabase({
      conversation_turns: [turn(0), { ...turn(1), role: undefined }],
    });
    const data = new LiveConversationDataAccess(supabase);
    const turns = await data.listTurns(CONV_A, WS_A, CLIENT_A);
    expect(turns).toHaveLength(1);
    expect(turns[0].seq).toBe(0);
  });
});

// ── appendTurn ──────────────────────────────────────────────────────

describe("live-conversation-data-access: appendTurn (bound tenancy in payload, unique seq)", () => {
  it("inserts the turn with the BOUND workspace_id + client_id + agent metadata", async () => {
    const { supabase, ops } = makeFakeSupabase(
      { conversation_turns: [] },
      { conversation_turns: ["conversation_id", "seq"] },
    );
    const data = new LiveConversationDataAccess(supabase);

    const id = await data.appendTurn({
      conversationId: CONV_A,
      workspaceId: WS_A,
      clientId: CLIENT_A,
      seq: 0,
      role: "agent",
      content: "draft",
      runId: "run-1",
      pieceVersion: 2,
      verdict: "PUBLISH",
    });
    expect(id).toBe("generated-id-1");

    const insert = ops.find((o) => o.table === "conversation_turns" && o.op === "insert");
    expect(insert!.payload).toMatchObject({
      conversation_id: CONV_A,
      workspace_id: WS_A,
      client_id: CLIENT_A,
      seq: 0,
      role: "agent",
      content: "draft",
      run_id: "run-1",
      piece_version: 2,
      verdict: "PUBLISH",
    });
  });

  it("throws on a duplicate (conversation_id, seq) — append-only ordering (unique index)", async () => {
    const { supabase } = makeFakeSupabase(
      { conversation_turns: [] },
      { conversation_turns: ["conversation_id", "seq"] },
    );
    const data = new LiveConversationDataAccess(supabase);

    await data.appendTurn({
      conversationId: CONV_A,
      workspaceId: WS_A,
      clientId: CLIENT_A,
      seq: 0,
      role: "user",
      content: "first",
    });
    await expect(
      data.appendTurn({
        conversationId: CONV_A,
        workspaceId: WS_A,
        clientId: CLIENT_A,
        seq: 0,
        role: "agent",
        content: "collision",
      }),
    ).rejects.toThrow();
  });
});

// ── nextSeq ─────────────────────────────────────────────────────────

describe("live-conversation-data-access: nextSeq (max(seq)+1, tenancy-scoped)", () => {
  const turn = (seq: number) => ({
    id: `turn-${seq}`,
    conversation_id: CONV_A,
    workspace_id: WS_A,
    client_id: CLIENT_A,
    seq,
    role: "user",
    content: "c",
    run_id: null,
    piece_version: null,
    verdict: null,
    created_at: "2026-06-27T00:00:00.000Z",
  });

  it("returns 0 on an empty conversation", async () => {
    const { supabase, ops } = makeFakeSupabase({ conversation_turns: [] });
    const data = new LiveConversationDataAccess(supabase);
    expect(await data.nextSeq(CONV_A, WS_A, CLIENT_A)).toBe(0);
    assertEqFilters(ops, "conversation_turns", "select", [
      ["conversation_id", CONV_A],
      ["workspace_id", WS_A],
      ["client_id", CLIENT_A],
    ]);
  });

  it("returns max(seq)+1 over the bound tenancy's turns", async () => {
    const { supabase } = makeFakeSupabase({ conversation_turns: [turn(0), turn(1), turn(2)] });
    const data = new LiveConversationDataAccess(supabase);
    expect(await data.nextSeq(CONV_A, WS_A, CLIENT_A)).toBe(3);
  });

  it("a cross-tenant id sees no turns → 0 (no leak) by construction", async () => {
    const { supabase } = makeFakeSupabase({ conversation_turns: [turn(0), turn(1)] });
    const data = new LiveConversationDataAccess(supabase);
    expect(await data.nextSeq(CONV_A, WS_B, CLIENT_A)).toBe(0);
  });
});

// ── setConversationPiece ────────────────────────────────────────────

describe("live-conversation-data-access: setConversationPiece (scoped UPDATE, set-once)", () => {
  const convRow = () => ({
    id: CONV_A,
    workspace_id: WS_A,
    client_id: CLIENT_A,
    piece_id: null as string | null,
    title: "Thread",
    status: "active",
    created_at: "2026-06-27T00:00:00.000Z",
    updated_at: "2026-06-27T00:00:00.000Z",
  });

  it("sets piece_id when null, scoping the UPDATE by the bound (id, workspace_id, client_id)", async () => {
    const { supabase, ops } = makeFakeSupabase({ conversations: [convRow()] });
    const data = new LiveConversationDataAccess(supabase);

    await data.setConversationPiece(CONV_A, PIECE_A, WS_A, CLIENT_A);

    const update = ops.find((o) => o.table === "conversations" && o.op === "update");
    expect(update).toBeDefined();
    expect(update!.payload).toMatchObject({ piece_id: PIECE_A });
    expect(update!.payload).toHaveProperty("updated_at");
    expect(update!.eq).toContainEqual(["id", CONV_A]);
    expect(update!.eq).toContainEqual(["workspace_id", WS_A]);
    expect(update!.eq).toContainEqual(["client_id", CLIENT_A]);
  });

  it("is idempotent when already linked to the SAME piece (no UPDATE issued)", async () => {
    const linked = { ...convRow(), piece_id: PIECE_A };
    const { supabase, ops } = makeFakeSupabase({ conversations: [linked] });
    const data = new LiveConversationDataAccess(supabase);

    await data.setConversationPiece(CONV_A, PIECE_A, WS_A, CLIENT_A);
    expect(ops.find((o) => o.table === "conversations" && o.op === "update")).toBeUndefined();
  });

  it("rejects a re-link to a DIFFERENT piece (set-once)", async () => {
    const linked = { ...convRow(), piece_id: PIECE_A };
    const { supabase } = makeFakeSupabase({ conversations: [linked] });
    const data = new LiveConversationDataAccess(supabase);

    await expect(
      data.setConversationPiece(CONV_A, PIECE_B, WS_A, CLIENT_A),
    ).rejects.toBeInstanceOf(ConversationPieceConflictError);
  });

  it("a cross-tenant conversation does not resolve → throws (no silent no-op, no leak)", async () => {
    const { supabase } = makeFakeSupabase({ conversations: [convRow()] });
    const data = new LiveConversationDataAccess(supabase);
    // CONV_A under WS_B does not resolve via the scoped read → throws.
    await expect(
      data.setConversationPiece(CONV_A, PIECE_A, WS_B, CLIENT_A),
    ).rejects.toThrow();
  });
});
