/**
 * live-data-access-write.test.ts — the LIVE ContentDataAccess WRITE adapter
 * (DR-026, service-role, INERT).
 *
 * Exercises `LiveContentWriteAccess` against an IN-MEMORY FAKE Supabase service-
 * role client (no network, no live DB). The fake is a chainable PostgREST WRITE
 * spy: `.from(table).insert(row).select(cols).single()` and
 * `.from(table).update(patch).eq(col,val)...select(cols).single()`. It RECORDS
 * every insert payload + every update patch + every applied `.eq()` filter so each
 * test can prove the EXACT bound tenancy.
 *
 * The load-bearing proofs (DR-026 highest-stakes write path), per write:
 *   (a) the INSERT payload carries the BOUND workspace_id + client_id (never
 *       request input) — service-role bypasses RLS, the app filter IS the boundary;
 *   (b) UPDATEs filter by the BOUND tenancy — a cross-tenant id updates ZERO rows;
 *   (c) IMMUTABILITY: there is NO update/delete path for credentialed_releases or
 *       for a named sign-off version (nameVersion / setActiveVersion fail-closed);
 *   (d) insertCredentialedRelease persists the credential + authorization_id
 *       FAITHFULLY, and a duplicate (piece, version) is REJECTED (unique index).
 *
 * Tier-2 (live pg / Supabase) is NEEDS-INPUT — no psql / live DB in this env.
 */
import { describe, it, expect } from "vitest";
import {
  LiveContentReadAccess,
  LiveContentWriteAccess,
  type WriterSupabase,
  type ReaderSupabase,
} from "@/lib/content/live-data-access";
import { DataAccessNotWiredError } from "@/lib/content/context";

// ── fixtures (valid RFC-4122 v4 UUIDs) ──────────────────────────────
const WS_A = "11111111-1111-4111-8111-111111111111";
const CLIENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PIECE_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const AUTH_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const COMMENT_A = "ffffffff-ffff-4fff-8fff-ffffffffffff";

// ── In-memory fake chainable PostgREST WRITE client ─────────────────

interface RecordedWrite {
  table: string;
  op: "insert" | "update";
  payload: Record<string, unknown>;
  eq: Array<[string, string | number]>;
}

/**
 * Build a fake `WriterSupabase`. `tables` maps a table name to its rows; INSERTs
 * append (assigning an id + echoing the row), UPDATEs apply the patch to the rows
 * matching the recorded `.eq()` filters. `uniqueOn` declares per-table unique
 * column tuples so a duplicate INSERT returns an error (mirrors the DB unique
 * index). Every write is recorded for assertion. A read companion (`reader`) over
 * the SAME tables backs resolveCommentThread's body read.
 */
function makeFakeWriter(
  tables: Record<string, Record<string, unknown>[]>,
  uniqueOn: Record<string, string[]> = {},
) {
  const writes: RecordedWrite[] = [];
  let idSeq = 0;

  function nextId(): string {
    idSeq += 1;
    return `generated-id-${idSeq}`;
  }

  function makeMutation(table: string, op: "insert" | "update", payload: Record<string, unknown>) {
    const rec: RecordedWrite = { table, op, payload, eq: [] };
    writes.push(rec);

    function apply(): { rows: Record<string, unknown>[]; error: unknown } {
      const rows = (tables[table] ??= []);
      if (op === "insert") {
        // Unique-index emulation: reject a duplicate on the declared tuple.
        const uniqueCols = uniqueOn[table];
        if (uniqueCols) {
          const dup = rows.find((r) =>
            uniqueCols.every((c) => r[c] === payload[c]),
          );
          if (dup) {
            return {
              rows: [],
              error: { code: "23505", message: `duplicate key on ${uniqueCols.join(",")}` },
            };
          }
        }
        const inserted = { id: nextId(), ...payload };
        rows.push(inserted);
        return { rows: [inserted], error: null };
      }
      // update — only rows matching every eq filter.
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

  const supabase: WriterSupabase = {
    from(table: string) {
      return {
        insert: (row: Record<string, unknown>) => makeMutation(table, "insert", row),
        update: (patch: Record<string, unknown>) => makeMutation(table, "update", patch),
      };
    },
  };

  // A read companion over the SAME tables (chainable read PostgREST spy).
  const readerSupabase: ReaderSupabase = {
    from(table: string) {
      return {
        select() {
          const eq: Array<[string, string | number]> = [];
          const q = {
            eq(col: string, val: string | number) {
              eq.push([col, val]);
              return q;
            },
            in() {
              return q;
            },
            order() {
              return q;
            },
            limit() {
              return q;
            },
            async maybeSingle() {
              const rows = (tables[table] ?? []).filter((r) =>
                eq.every(([c, v]) => r[c] === v),
              );
              return { data: rows[0] ?? null, error: null };
            },
            then<R>(onfulfilled?: (v: { data: Record<string, unknown>[]; error: null }) => R) {
              const rows = (tables[table] ?? []).filter((r) =>
                eq.every(([c, v]) => r[c] === v),
              );
              return Promise.resolve({ data: rows, error: null as null }).then(onfulfilled);
            },
          };
          return q;
        },
      };
    },
  };

  return { supabase, readerSupabase, writes, tables };
}

function findWrite(writes: RecordedWrite[], table: string, op: "insert" | "update") {
  return writes.find((w) => w.table === table && w.op === op);
}

// ── insertDraftPiece ────────────────────────────────────────────────

describe("write: insertDraftPiece (bound tenancy on the INSERT)", () => {
  it("sets client_id from the BOUND payload and omits status (draft default)", async () => {
    const { supabase, writes, tables } = makeFakeWriter({ content_pieces: [] });
    const w = new LiveContentWriteAccess(supabase);

    const got = await w.insertDraftPiece({
      clientId: CLIENT_A,
      slug: "my-slug",
      title: "T",
      body: "B",
      isYmyl: true,
      authorId: null,
      faqData: null,
      briefSnapshot: null,
    });
    expect(got.slug).toBe("my-slug");
    const ins = findWrite(writes, "content_pieces", "insert");
    expect(ins!.payload.client_id).toBe(CLIENT_A);
    expect(ins!.payload.is_ymyl).toBe(true);
    // status is NOT set on the payload — the DB 'draft' default applies.
    expect(ins!.payload).not.toHaveProperty("status");
    expect(tables.content_pieces).toHaveLength(1);
  });
});

// ── insertPieceVersion (append-only; duplicate rejected) ─────────────

describe("write: insertPieceVersion (append-only, bound tenancy)", () => {
  it("inserts with bound client_id; returns (id, version)", async () => {
    const { supabase, writes } = makeFakeWriter(
      { content_piece_versions: [] },
      { content_piece_versions: ["piece_id", "version"] },
    );
    const w = new LiveContentWriteAccess(supabase);

    const got = await w.insertPieceVersion({
      pieceId: PIECE_A,
      clientId: CLIENT_A,
      version: 2,
      body: "edited",
      verdict: "REVIEW",
      dimensions: null,
    });
    expect(got.version).toBe(2);
    const ins = findWrite(writes, "content_piece_versions", "insert");
    expect(ins!.payload.client_id).toBe(CLIENT_A);
    expect(ins!.payload.piece_id).toBe(PIECE_A);
  });

  it("REJECTS a duplicate (piece_id, version) — append-only never overwrites", async () => {
    const { supabase } = makeFakeWriter(
      {
        content_piece_versions: [
          { id: "v1", piece_id: PIECE_A, client_id: CLIENT_A, version: 1, body: "x" },
        ],
      },
      { content_piece_versions: ["piece_id", "version"] },
    );
    const w = new LiveContentWriteAccess(supabase);
    await expect(
      w.insertPieceVersion({
        pieceId: PIECE_A,
        clientId: CLIENT_A,
        version: 1,
        body: "clobber",
        verdict: null,
        dimensions: null,
      }),
    ).rejects.toThrow(/insertPieceVersion failed/);
  });
});

// ── transitionPieceStatus (UPDATE bound tenancy; cross-tenant → 0 rows) ──

describe("write: transitionPieceStatus (persistence only; bound UPDATE)", () => {
  it("UPDATEs status filtered by BOUND (id, client_id) and sets published_at on publish", async () => {
    const { supabase, writes, tables } = makeFakeWriter({
      content_pieces: [
        { id: PIECE_A, client_id: CLIENT_A, status: "approved", published_at: null },
      ],
    });
    const w = new LiveContentWriteAccess(supabase);

    await w.transitionPieceStatus(PIECE_A, CLIENT_A, "published");
    const upd = findWrite(writes, "content_pieces", "update");
    expect(upd!.eq).toContainEqual(["id", PIECE_A]);
    expect(upd!.eq).toContainEqual(["client_id", CLIENT_A]);
    expect(upd!.payload.status).toBe("published");
    expect(upd!.payload).toHaveProperty("published_at");
    // The row actually moved to published.
    expect(tables.content_pieces[0].status).toBe("published");
    expect(tables.content_pieces[0].published_at).not.toBeNull();
  });

  it("a CROSS-TENANT client id updates ZERO rows (no mutation, no leak)", async () => {
    const { supabase, tables } = makeFakeWriter({
      content_pieces: [
        { id: PIECE_A, client_id: CLIENT_A, status: "approved", published_at: null },
      ],
    });
    const w = new LiveContentWriteAccess(supabase);

    // CLIENT_B does not own PIECE_A → the eq(client_id, B) filter matches nothing.
    await w.transitionPieceStatus(PIECE_A, CLIENT_B, "published");
    expect(tables.content_pieces[0].status).toBe("approved"); // untouched
    expect(tables.content_pieces[0].published_at).toBeNull();
  });

  it("a non-publish transition does NOT set published_at", async () => {
    const { supabase, writes } = makeFakeWriter({
      content_pieces: [{ id: PIECE_A, client_id: CLIENT_A, status: "published" }],
    });
    const w = new LiveContentWriteAccess(supabase);
    await w.transitionPieceStatus(PIECE_A, CLIENT_A, "archived");
    const upd = findWrite(writes, "content_pieces", "update");
    expect(upd!.payload.status).toBe("archived");
    expect(upd!.payload).not.toHaveProperty("published_at");
  });
});

// ── insertClientSignoff (advisory; structurally no credential/auth) ──

describe("write: insertClientSignoff (advisory, bound tenancy)", () => {
  it("sets BOUND workspace_id + client_id and carries NO credential/authorization_id", async () => {
    const { supabase, writes } = makeFakeWriter({ client_signoffs: [] });
    const w = new LiveContentWriteAccess(supabase);

    const got = await w.insertClientSignoff({
      workspaceId: WS_A,
      clientId: CLIENT_A,
      pieceId: PIECE_A,
      version: 1,
      actorId: "client-kate",
      releaseScope: "piece",
    });
    expect(got.id).toBeTruthy();
    const ins = findWrite(writes, "client_signoffs", "insert");
    expect(ins!.payload.workspace_id).toBe(WS_A);
    expect(ins!.payload.client_id).toBe(CLIENT_A);
    // Structurally incapable of releasing / supplying a byline.
    expect(ins!.payload).not.toHaveProperty("credential");
    expect(ins!.payload).not.toHaveProperty("authorization_id");
    // release_type omitted — the DB default + CHECK pin 'client_signoff'.
    expect(ins!.payload).not.toHaveProperty("release_type");
  });
});

// ── insertCredentialedRelease (faithful persist; duplicate rejected) ─

describe("write: insertCredentialedRelease (faithful, immutable, bound tenancy)", () => {
  const credential = { name: "Dr. Roe", credentials: "RN, MSN" };

  it("persists credential + authorization_id FAITHFULLY with BOUND tenancy", async () => {
    const { supabase, writes } = makeFakeWriter(
      { credentialed_releases: [] },
      { credentialed_releases: ["piece_id", "version"] },
    );
    const w = new LiveContentWriteAccess(supabase);

    const got = await w.insertCredentialedRelease({
      workspaceId: WS_A,
      clientId: CLIENT_A,
      pieceId: PIECE_A,
      version: 1,
      actorId: "reviewer-1",
      credential,
      authorizationId: AUTH_A,
      releaseScope: "piece",
    });
    expect(got.id).toBeTruthy();
    const ins = findWrite(writes, "credentialed_releases", "insert");
    expect(ins!.payload.workspace_id).toBe(WS_A);
    expect(ins!.payload.client_id).toBe(CLIENT_A);
    // Byline evidence persisted verbatim (no defaulting / fabrication).
    expect(ins!.payload.credential).toEqual(credential);
    expect(ins!.payload.authorization_id).toBe(AUTH_A);
  });

  it("REJECTS a SECOND release per (piece, version) — UNIQUE index, immutable", async () => {
    const { supabase } = makeFakeWriter(
      {
        credentialed_releases: [
          { id: "r1", piece_id: PIECE_A, client_id: CLIENT_A, version: 1 },
        ],
      },
      { credentialed_releases: ["piece_id", "version"] },
    );
    const w = new LiveContentWriteAccess(supabase);
    await expect(
      w.insertCredentialedRelease({
        workspaceId: WS_A,
        clientId: CLIENT_A,
        pieceId: PIECE_A,
        version: 1,
        actorId: "reviewer-2",
        credential,
        authorizationId: AUTH_A,
        releaseScope: "piece",
      }),
    ).rejects.toThrow(/insertCredentialedRelease failed/);
  });
});

// ── resolveCommentThread (UPDATE bound tenancy; append note) ─────────

describe("write: resolveCommentThread (bound UPDATE; append-only note)", () => {
  const thread = {
    id: COMMENT_A,
    piece_id: PIECE_A,
    client_id: CLIENT_A,
    version: 3,
    kind: "request-changes",
    anchor: null,
    body: "soften this",
    author: "client:kate",
    status: "open",
    created_at: "2026-01-04T00:00:00.000Z",
  };

  it("flips status open->resolved, APPENDS the addressed-in note, scoped by (id, client_id)", async () => {
    const { supabase, readerSupabase, writes, tables } = makeFakeWriter({
      comment_threads: [{ ...thread }],
    });
    const w = new LiveContentWriteAccess(supabase);
    w.attachReader(new LiveContentReadAccess(readerSupabase));

    const got = await w.resolveCommentThread({
      commentId: COMMENT_A,
      clientId: CLIENT_A,
      addressedInVersion: 4,
    });
    expect(got.status).toBe("resolved");
    expect(got.body).toContain("soften this"); // original preserved (append, not clobber)
    expect(got.body).toContain("addressed in v4");
    const upd = findWrite(writes, "comment_threads", "update");
    expect(upd!.eq).toContainEqual(["id", COMMENT_A]);
    expect(upd!.eq).toContainEqual(["client_id", CLIENT_A]);
    expect(tables.comment_threads[0].status).toBe("resolved");
  });

  it("a CROSS-TENANT comment id updates ZERO rows and fails loud", async () => {
    const { supabase, readerSupabase, tables } = makeFakeWriter({
      comment_threads: [{ ...thread }],
    });
    const w = new LiveContentWriteAccess(supabase);
    w.attachReader(new LiveContentReadAccess(readerSupabase));

    await expect(
      w.resolveCommentThread({ commentId: COMMENT_A, clientId: CLIENT_B, addressedInVersion: 4 }),
    ).rejects.toThrow(/updated no row/);
    // The real owner's thread is untouched.
    expect(tables.comment_threads[0].status).toBe("open");
    expect(tables.comment_threads[0].body).toBe("soften this");
  });
});

// ── IMMUTABILITY: no live write path for named sign-off / active version ──

describe("write: nameVersion / setActiveVersion are fail-closed (deferred-migration)", () => {
  it("nameVersion throws DataAccessNotWiredError — no live update/delete of a named sign-off", async () => {
    const { supabase } = makeFakeWriter({});
    const w = new LiveContentWriteAccess(supabase);
    await expect(
      w.nameVersion({ pieceId: PIECE_A, clientId: CLIENT_A, version: 1, name: "signoff", asSignoff: true }),
    ).rejects.toBeInstanceOf(DataAccessNotWiredError);
  });

  it("setActiveVersion throws DataAccessNotWiredError — no live mutation path", async () => {
    const { supabase } = makeFakeWriter({});
    const w = new LiveContentWriteAccess(supabase);
    await expect(
      w.setActiveVersion({ pieceId: PIECE_A, clientId: CLIENT_A, version: 1 }),
    ).rejects.toBeInstanceOf(DataAccessNotWiredError);
  });
});
