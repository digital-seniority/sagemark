/**
 * Host-side LIVE ConversationDataAccess adapter (Slice 5, lane schema-tenancy).
 *
 * THE GAP THIS CLOSES. The chat-first front door persists its run-session state
 * (`conversations` + `conversation_turns`, migration 0040) ONLY through the
 * `ConversationDataAccess` seam (context.ts). In production that seam runs on the
 * fail-closed `NOT_WIRED_CONVERSATION_ACCESS` stub (every method throws). This
 * module is the live read+write adapter — the SELECT/INSERT/UPDATE methods that
 * create a thread, append turns, list turns/conversations, compute the next seq,
 * and link a conversation to its piece. Mirrors `../content/live-data-access.ts`
 * exactly (same creds reader, same dynamic import, same explicit-app-filter
 * discipline, same fail-closed mapping).
 *
 * SECURITY — SERVICE ROLE BYPASSES RLS (load-bearing). The client is the Supabase
 * SERVICE ROLE (host-side, `server-only`), so RLS is NOT the tenancy boundary
 * here. The APP FILTER is the boundary: EVERY query carries an EXPLICIT
 * `.eq("workspace_id", …)` AND `.eq("client_id", …)` from the BOUND args (never
 * request input). Both `conversations` and `conversation_turns` carry both tenancy
 * columns (the turn table denormalizes them), so every read AND every write filters
 * by the BOUND pair. A cross-tenant id simply produces no row (isolation), never a
 * leak; a cross-tenant UPDATE matches ZERO rows.
 *
 * FAIL-CLOSED (never fail-open). A row that cannot be mapped to its return type (a
 * required column is missing / NULL / unparseable) is treated as NOT-FOUND (single
 * reads → null) or OMITTED (list reads), never returned as a partial / fabricated
 * object. A write that does not land throws (fail-loud) — a caller NEVER reads a
 * write that did not persist.
 *
 * Clean ASCII / UTF-8. No `console.*`. `@supabase/supabase-js` is imported
 * dynamically so importing this module is network-free + cred-free.
 */

import "server-only";

import {
  ConversationPieceConflictError,
  type ConversationDataAccess,
  type ConversationRow,
  type ConversationTurnRow,
  type CreateConversationInput,
  type AppendTurnInput,
} from "./context";
import { readReadAdapterCreds } from "../content/live-data-access";
import type {
  ConversationStatus,
  ConversationTurnRole,
} from "@sagemark/schema-flywheel";
import type { Verdict } from "@sagemark/core";

// ── The minimal service-role PostgREST surface this adapter uses ───────────────

interface ConvResult<T> {
  data: T;
  error: unknown;
}

/**
 * A terminal PostgREST READ builder: awaitable to `{ data, error }` (the row
 * array) and supporting the chained read modifiers this adapter uses; `.single()`
 * / `.maybeSingle()` return at most one row. Modelled minimally (only the methods
 * used) so the fake client in the test can implement the same shape.
 */
interface ConvQuery extends PromiseLike<ConvResult<Record<string, unknown>[]>> {
  eq(col: string, val: string | number): ConvQuery;
  order(col: string, opts?: { ascending?: boolean }): ConvQuery;
  limit(n: number): ConvQuery;
  maybeSingle(): Promise<ConvResult<Record<string, unknown> | null>>;
}

/**
 * A terminal PostgREST WRITE builder. `.eq()` chains the tenancy filters an UPDATE
 * binds; `.select(cols).single()` returns the one written/updated row; awaiting
 * directly returns the affected-row array.
 */
interface ConvMutation extends PromiseLike<ConvResult<Record<string, unknown>[]>> {
  eq(col: string, val: string | number): ConvMutation;
  select(cols: string): ConvMutation;
  single(): Promise<ConvResult<Record<string, unknown> | null>>;
}

/** The minimal service-role Supabase surface this adapter uses (read + write). */
export interface ConversationSupabase {
  from(table: string): {
    select(cols: string): ConvQuery;
    insert(row: Record<string, unknown>): ConvMutation;
    update(patch: Record<string, unknown>): ConvMutation;
  };
}

// ── Small fail-closed coercion helpers (never fabricate) ──────────────────────

/** A REQUIRED string column — null when absent/wrong-typed (→ row omitted). */
function reqString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asFiniteNumberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asIntOrNull(v: unknown): number | null {
  const n = asFiniteNumberOrNull(v);
  return n === null ? null : Math.trunc(n);
}

/** The schema's conversation_status enum values; anything else → null. */
const CONVERSATION_STATUSES = new Set<ConversationStatus>(["active", "archived"]);
function asConversationStatus(v: unknown): ConversationStatus | null {
  return typeof v === "string" && CONVERSATION_STATUSES.has(v as ConversationStatus)
    ? (v as ConversationStatus)
    : null;
}

/** The schema's conversation_turn role values; anything else → null. */
const TURN_ROLES = new Set<ConversationTurnRole>(["user", "agent"]);
function asTurnRole(v: unknown): ConversationTurnRole | null {
  return typeof v === "string" && TURN_ROLES.has(v as ConversationTurnRole)
    ? (v as ConversationTurnRole)
    : null;
}

/** The schema's content_verdict enum values; anything else → null (fail-closed). */
const VERDICTS = new Set<Verdict>(["PUBLISH", "REVIEW", "REVISE", "REJECT"]);
function asVerdict(v: unknown): Verdict | null {
  return typeof v === "string" && VERDICTS.has(v as Verdict) ? (v as Verdict) : null;
}

function stringifyErr(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

// ── Row → return-type mappers (all fail-closed) ───────────────────────────────

/**
 * Map a `conversations` row to `ConversationRow`. Returns null when a REQUIRED
 * field (id / workspace_id / client_id / status / created_at / updated_at) is
 * missing/unparseable — fail-closed not-found, never a partial. `piece_id` /
 * `title` pass through as null when absent.
 */
function mapConversation(row: Record<string, unknown>): ConversationRow | null {
  const id = reqString(row.id);
  const workspaceId = reqString(row.workspace_id);
  const clientId = reqString(row.client_id);
  const status = asConversationStatus(row.status);
  const createdAt = reqString(row.created_at);
  const updatedAt = reqString(row.updated_at);
  if (!id || !workspaceId || !clientId || !status || !createdAt || !updatedAt) {
    return null;
  }
  return {
    id,
    workspaceId,
    clientId,
    pieceId: asStringOrNull(row.piece_id),
    projectId: asStringOrNull(row.project_id),
    title: asStringOrNull(row.title),
    status,
    createdAt,
    updatedAt,
  };
}

/**
 * Map a `conversation_turns` row to `ConversationTurnRow`. Returns null when a
 * REQUIRED field (id / conversation_id / workspace_id / client_id / seq / role /
 * created_at) is missing/unparseable. `content` defaults to "" (the schema
 * default). The agent-only fields (`run_id` / `piece_version` / `verdict`) pass
 * through as null when absent.
 */
function mapTurn(row: Record<string, unknown>): ConversationTurnRow | null {
  const id = reqString(row.id);
  const conversationId = reqString(row.conversation_id);
  const workspaceId = reqString(row.workspace_id);
  const clientId = reqString(row.client_id);
  const seq = asIntOrNull(row.seq);
  const role = asTurnRole(row.role);
  const createdAt = reqString(row.created_at);
  if (
    !id || !conversationId || !workspaceId || !clientId ||
    seq === null || !role || !createdAt
  ) {
    return null;
  }
  return {
    id,
    conversationId,
    workspaceId,
    clientId,
    seq,
    role,
    content: asStringOrNull(row.content) ?? "",
    runId: asStringOrNull(row.run_id),
    pieceVersion: asIntOrNull(row.piece_version),
    verdict: asVerdict(row.verdict),
    createdAt,
  };
}

// ── The live adapter ──────────────────────────────────────────────────────────

/**
 * Live, service-role-backed implementation of `ConversationDataAccess`. Every
 * method applies an EXPLICIT tenancy filter — `.eq("workspace_id", …)` AND
 * `.eq("client_id", …)` — from the BOUND args (never request input). Service-role
 * bypasses RLS, so the app filter IS the boundary.
 */
export class LiveConversationDataAccess implements ConversationDataAccess {
  constructor(private readonly supabase: ConversationSupabase) {}

  /**
   * Create a conversation for the BOUND `(workspaceId, clientId)`. `status` /
   * `piece_id` are OMITTED from the insert so the DB defaults apply ('active',
   * null) — a conversation is never born linked / archived. Returns the new id.
   */
  async createConversation(input: CreateConversationInput): Promise<string> {
    const { data, error } = await this.supabase
      .from("conversations")
      .insert({
        workspace_id: input.workspaceId, // BOUND tenancy — never request input.
        client_id: input.clientId, // BOUND tenancy — never request input.
        title: input.title ?? null,
        // The thread's project (Slice 5), or null when not started in a project.
        project_id: input.projectId ?? null,
        // status / piece_id intentionally OMITTED — the DB defaults ('active',
        // null) apply. A conversation is never born linked or archived.
      })
      .select("id")
      .single();
    if (error) {
      throw new Error(
        `live-conversation-data-access: createConversation failed for client=${input.clientId}: ${stringifyErr(error)}`,
      );
    }
    const id = data ? reqString(data.id) : null;
    if (!id) {
      throw new Error(
        `live-conversation-data-access: createConversation returned no id for client=${input.clientId}`,
      );
    }
    return id;
  }

  /**
   * Load a conversation scoped by (id, workspaceId, clientId), or null. The
   * EXPLICIT (id, workspace_id, client_id) filter scopes by the BOUND tenancy — a
   * cross-tenant conversation id resolves to no row → null. Fail-closed mapping.
   */
  async getConversation(
    conversationId: string,
    workspaceId: string,
    clientId: string,
  ): Promise<ConversationRow | null> {
    const { data, error } = await this.supabase
      .from("conversations")
      .select(
        "id, workspace_id, client_id, piece_id, project_id, title, status, created_at, updated_at",
      )
      .eq("id", conversationId)
      .eq("workspace_id", workspaceId) // BOUND tenancy.
      .eq("client_id", clientId) // BOUND tenancy.
      .maybeSingle();
    if (error) {
      throw new Error(
        `live-conversation-data-access: getConversation failed for conversation=${conversationId}: ${stringifyErr(error)}`,
      );
    }
    return data ? mapConversation(data) : null;
  }

  /**
   * List the conversations for the BOUND `(workspaceId, clientId)` (the home list).
   * EXPLICIT (workspace_id, client_id) filter; ordered updated_at DESC (most-recent
   * first). A foreign tenancy resolves to []. Unmappable rows are OMITTED.
   */
  async listConversations(
    workspaceId: string,
    clientId: string,
  ): Promise<ConversationRow[]> {
    const { data, error } = await this.supabase
      .from("conversations")
      .select(
        "id, workspace_id, client_id, piece_id, project_id, title, status, created_at, updated_at",
      )
      .eq("workspace_id", workspaceId) // BOUND tenancy.
      .eq("client_id", clientId) // BOUND tenancy.
      .order("updated_at", { ascending: false });
    if (error) {
      throw new Error(
        `live-conversation-data-access: listConversations failed for client=${clientId}: ${stringifyErr(error)}`,
      );
    }
    return (data ?? [])
      .map(mapConversation)
      .filter((c): c is ConversationRow => c !== null);
  }

  /**
   * List the turns of a conversation, ordered by `seq` ASC. EXPLICIT
   * (conversation_id, workspace_id, client_id) filter — a cross-tenant conversation
   * id resolves to [] (the turn rows carry + are filtered by the BOUND tenancy, so
   * no leak). Unmappable rows are OMITTED (fail-closed).
   */
  async listTurns(
    conversationId: string,
    workspaceId: string,
    clientId: string,
  ): Promise<ConversationTurnRow[]> {
    const { data, error } = await this.supabase
      .from("conversation_turns")
      .select(
        "id, conversation_id, workspace_id, client_id, seq, role, content, run_id, piece_version, verdict, created_at",
      )
      .eq("conversation_id", conversationId)
      .eq("workspace_id", workspaceId) // BOUND tenancy.
      .eq("client_id", clientId) // BOUND tenancy.
      .order("seq", { ascending: true });
    if (error) {
      throw new Error(
        `live-conversation-data-access: listTurns failed for conversation=${conversationId}: ${stringifyErr(error)}`,
      );
    }
    return (data ?? [])
      .map(mapTurn)
      .filter((t): t is ConversationTurnRow => t !== null);
  }

  /**
   * Append one turn. The INSERT sets `workspace_id` + `client_id` from the BOUND
   * args (denormalized onto the turn, never request input). A duplicate
   * `(conversation_id, seq)` hits the schema unique index → the INSERT errors →
   * this throws (append-only ordering is never silently overwritten). Returns the
   * new turn id.
   */
  async appendTurn(input: AppendTurnInput): Promise<string> {
    const { data, error } = await this.supabase
      .from("conversation_turns")
      .insert({
        conversation_id: input.conversationId,
        workspace_id: input.workspaceId, // BOUND tenancy — never request input.
        client_id: input.clientId, // BOUND tenancy — never request input.
        seq: input.seq,
        role: input.role,
        content: input.content,
        run_id: input.runId ?? null,
        piece_version: input.pieceVersion ?? null,
        verdict: input.verdict ?? null,
      })
      .select("id")
      .single();
    if (error) {
      // A duplicate (conversation_id, seq) hits the unique index → fail-loud.
      throw new Error(
        `live-conversation-data-access: appendTurn failed for conversation=${input.conversationId} seq=${input.seq}: ${stringifyErr(error)}`,
      );
    }
    const id = data ? reqString(data.id) : null;
    if (!id) {
      throw new Error(
        `live-conversation-data-access: appendTurn returned no id for conversation=${input.conversationId}`,
      );
    }
    return id;
  }

  /**
   * The next sequence number: `max(seq) + 1`, or 0 when the conversation has no
   * turns. EXPLICIT (conversation_id, workspace_id, client_id) filter — a
   * cross-tenant conversation id sees no turns → 0. Read as the single highest-seq
   * row (ordered seq DESC, limit 1).
   */
  async nextSeq(
    conversationId: string,
    workspaceId: string,
    clientId: string,
  ): Promise<number> {
    const { data, error } = await this.supabase
      .from("conversation_turns")
      .select("seq")
      .eq("conversation_id", conversationId)
      .eq("workspace_id", workspaceId) // BOUND tenancy.
      .eq("client_id", clientId) // BOUND tenancy.
      .order("seq", { ascending: false })
      .limit(1);
    if (error) {
      throw new Error(
        `live-conversation-data-access: nextSeq failed for conversation=${conversationId}: ${stringifyErr(error)}`,
      );
    }
    const row = (data ?? [])[0];
    const maxSeq = row ? asIntOrNull(row.seq) : null;
    return maxSeq === null ? 0 : maxSeq + 1;
  }

  /**
   * Link a conversation to its `content_piece` + bump `updated_at`. IDEMPOTENT:
   * first reads the conversation under the BOUND (id, workspace_id, client_id); a
   * cross-tenant / missing id resolves to null → throws (the row is not the
   * caller's). When already linked to the SAME piece, this is a no-op (no write).
   * When linked to a DIFFERENT piece, throws `ConversationPieceConflictError` (a
   * conversation's piece is set once). The UPDATE filters by the BOUND tenancy — a
   * cross-tenant id matches ZERO rows (no mutation, no leak).
   */
  async setConversationPiece(
    conversationId: string,
    pieceId: string,
    workspaceId: string,
    clientId: string,
  ): Promise<void> {
    const existing = await this.getConversation(conversationId, workspaceId, clientId);
    if (!existing) {
      throw new Error(
        `live-conversation-data-access: setConversationPiece found no conversation=${conversationId} under the bound tenancy (cross-tenant or missing)`,
      );
    }
    // Idempotent: already linked to this same piece → nothing to do.
    if (existing.pieceId === pieceId) return;
    // Linked to a DIFFERENT piece → refuse (the piece is set once).
    if (existing.pieceId !== null) {
      throw new ConversationPieceConflictError(conversationId, existing.pieceId, pieceId);
    }

    const { error } = await this.supabase
      .from("conversations")
      .update({ piece_id: pieceId, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("workspace_id", workspaceId) // BOUND tenancy — a cross-tenant id → 0 rows.
      .eq("client_id", clientId); // BOUND tenancy.
    if (error) {
      throw new Error(
        `live-conversation-data-access: setConversationPiece failed for conversation=${conversationId}: ${stringifyErr(error)}`,
      );
    }
  }

  /**
   * Auto-title the conversation from the operator's first message. The caller
   * is expected to only call when the current title is null (the turn.ts call
   * site guards on `conversation.title == null`). Cross-tenant ids match zero
   * rows (no mutation, no leak).
   */
  async setConversationTitle(
    conversationId: string,
    title: string,
    workspaceId: string,
    clientId: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from("conversations")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("workspace_id", workspaceId)
      .eq("client_id", clientId);
    if (error) {
      throw new Error(
        `live-conversation-data-access: setConversationTitle failed for conversation=${conversationId}: ${stringifyErr(error)}`,
      );
    }
  }
}

// ── Inert factory (built + injectable; gated on service-role creds) ────────────

/**
 * Build a `LiveConversationDataAccess` from a service-role Supabase client — but
 * ONLY if the host creds are present. Returns null otherwise, so the caller leaves
 * the seam on its fail-closed `NOT_WIRED_CONVERSATION_ACCESS` default (unchanged
 * behavior). Reuses the content adapter's `readReadAdapterCreds` (the same env
 * contract).
 *
 * `@supabase/supabase-js` is imported dynamically so importing this module is
 * network-free and needs no creds just to import. Mirrors
 * `makeLiveContentReadAdapter` exactly.
 */
export async function makeLiveConversationDataAccess(): Promise<LiveConversationDataAccess | null> {
  const creds = readReadAdapterCreds();
  if (!creds) return null;
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(creds.url, creds.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as ConversationSupabase;
  return new LiveConversationDataAccess(supabase);
}
