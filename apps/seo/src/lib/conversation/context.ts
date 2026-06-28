/**
 * Conversation data-access seam (Slice 5, lane schema-tenancy).
 *
 * THE CHAT-FRONT-DOOR PERSISTENCE CHOKEPOINT. The chat-first front door persists
 * its run-session state — the `conversations` thread + the ordered
 * `conversation_turns` log (migration 0040) — ONLY through this `ConversationDataAccess`
 * seam. Mirrors the content-kernel's `ContentDataAccess` discipline (../content/context.ts):
 *
 *   - every method is TENANCY-SCOPED by the BOUND `(workspaceId, clientId)` — the
 *     SERVER's notion of "who", derived in the route layer (P-F), NEVER trusted from
 *     request input. A cross-tenant id resolves to null / empty, never a leak.
 *   - the production default is a fail-closed stub (`NOT_WIRED_CONVERSATION_ACCESS`)
 *     that THROWS a clear `ConversationAccessNotWiredError` on every method rather
 *     than silently succeeding — a route that reaches the DB without an injected
 *     impl fails LOUDLY (fail-closed), exactly like `NOT_WIRED_DATA_ACCESS`.
 *   - tests inject an in-memory / fixture impl; the live service-role adapter
 *     (`live-conversation-data-access.ts`) is composed on only when service-role
 *     creds are present (`resolve-conversation-access.ts`).
 *
 * Clean ASCII / UTF-8. No `server-only` marker (imported by plain-Node tests).
 */

import type {
  ConversationStatus,
  ConversationTurnRole,
} from "@sagemark/schema-flywheel";
import type { Verdict } from "@sagemark/core";

// ── Persisted row projections ─────────────────────────────────────────────────

/**
 * A persisted `conversations` row (the chat thread). `pieceId` is NULLABLE — a
 * conversation exists BEFORE any draft and is linked to its `content_piece` only
 * once the first draft lands. Tenancy keys (`workspaceId`, `clientId`) are carried
 * so the seam can never drift from the row that backs it.
 */
export interface ConversationRow {
  id: string;
  workspaceId: string;
  clientId: string;
  /** Null until the first draft links the thread to a content piece. */
  pieceId: string | null;
  /** The project this thread belongs to (Slice 5), or null. Drives context injection. */
  projectId: string | null;
  title: string | null;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * A persisted `conversation_turns` row (one ordered turn within a conversation,
 * `seq` 1..N unique per conversation). An agent turn that spawned a worker run
 * carries `runId` (→ `worker_sessions.run_id`) + the resulting `pieceVersion` +
 * `verdict` snapshot; a user turn carries none of those (all null).
 */
export interface ConversationTurnRow {
  id: string;
  conversationId: string;
  workspaceId: string;
  clientId: string;
  seq: number;
  role: ConversationTurnRole;
  content: string;
  /** Only an agent turn that spawned a worker run carries a run id. */
  runId: string | null;
  /** The content_piece version this turn produced, if any. */
  pieceVersion: number | null;
  /** The eval verdict snapshot for this turn, if any. */
  verdict: Verdict | null;
  createdAt: string;
}

// ── Insert payloads (the BOUND tenancy is carried, never request input) ────────

/**
 * Create-a-conversation payload. `workspaceId`/`clientId` are the BOUND tenancy
 * (never request input). A new conversation is always born `status='active'` with
 * `piece_id` null (the DB defaults) — it is linked to a piece only later via
 * `setConversationPiece`. `title` is optional.
 */
export interface CreateConversationInput {
  workspaceId: string;
  clientId: string;
  title?: string;
  /** Optional project the new thread belongs to (Slice 5). */
  projectId?: string | null;
}

/**
 * Append-a-turn payload. `workspaceId`/`clientId` are the BOUND tenancy and are
 * ALSO denormalized onto the turn row (the schema carries them per-turn, the same
 * pattern as `content_piece_versions`). `seq` MUST be the next sequence number
 * (the `(conversation_id, seq)` unique index rejects a duplicate). The
 * agent-only fields (`runId` / `pieceVersion` / `verdict`) are optional.
 */
export interface AppendTurnInput {
  conversationId: string;
  workspaceId: string;
  clientId: string;
  seq: number;
  role: ConversationTurnRole;
  content: string;
  /** Only an agent turn that spawned a worker run carries a run id. */
  runId?: string | null;
  /** The content_piece version this turn produced, if any. */
  pieceVersion?: number | null;
  /** The eval verdict snapshot for this turn, if any. */
  verdict?: Verdict | null;
}

// ── The conversation data-access seam ─────────────────────────────────────────

/**
 * The mockable conversation data-access interface the chat-front-door route layer
 * uses. Every method is TENANCY-SCOPED by the BOUND `(workspaceId, clientId)`: a
 * cross-tenant conversation/turn id resolves to null / empty (no leak). READ
 * methods never mutate; the three writes (`createConversation`, `appendTurn`,
 * `setConversationPiece`) are the only mutation paths.
 */
export interface ConversationDataAccess {
  /**
   * Create a new conversation for the BOUND `(workspaceId, clientId)`. Born
   * `status='active'` with `piece_id` null (the DB defaults). Returns the new
   * conversation id.
   */
  createConversation(input: CreateConversationInput): Promise<string>;

  /**
   * Load a single conversation scoped by (id, workspaceId, clientId), or null. A
   * cross-tenant id (a conversation under a different workspace/client) resolves to
   * null — never a leak.
   */
  getConversation(
    conversationId: string,
    workspaceId: string,
    clientId: string,
  ): Promise<ConversationRow | null>;

  /**
   * List the conversations for the BOUND `(workspaceId, clientId)` (the home list),
   * ordered most-recently-updated first. A foreign tenancy resolves to [].
   */
  listConversations(
    workspaceId: string,
    clientId: string,
  ): Promise<ConversationRow[]>;

  /**
   * List the turns of a conversation scoped by (conversationId, workspaceId,
   * clientId), ordered by `seq` ascending. A cross-tenant conversation id resolves
   * to [] (the turns are also tenancy-filtered, so no leak).
   */
  listTurns(
    conversationId: string,
    workspaceId: string,
    clientId: string,
  ): Promise<ConversationTurnRow[]>;

  /**
   * Append one turn to a conversation. `seq` MUST be the next sequence number — a
   * duplicate `(conversation_id, seq)` MUST throw (the schema unique index enforces
   * append-only ordering). Tenancy is the BOUND pair, denormalized onto the row.
   * Returns the new turn id.
   */
  appendTurn(input: AppendTurnInput): Promise<string>;

  /**
   * The next sequence number for a conversation: `max(seq) + 1`, or 0 when the
   * conversation has no turns yet. Scoped by (conversationId, workspaceId,
   * clientId) — a cross-tenant id sees no turns → 0.
   */
  nextSeq(
    conversationId: string,
    workspaceId: string,
    clientId: string,
  ): Promise<number>;

  /**
   * Link a conversation to its `content_piece` (set `piece_id`) + bump
   * `updated_at`. IDEMPOTENT: only sets the piece when `piece_id` is currently null
   * OR already equals `pieceId`; an attempt to RE-link to a DIFFERENT piece throws
   * `ConversationPieceConflictError` (a conversation's piece is set once). Scoped by
   * the BOUND (id, workspaceId, clientId) — a cross-tenant id updates ZERO rows
   * (and throws, since the row does not resolve under the bound tenancy).
   */
  setConversationPiece(
    conversationId: string,
    pieceId: string,
    workspaceId: string,
    clientId: string,
  ): Promise<void>;
}

// ── Production default: fail-closed "not wired" stub ───────────────────────────

/**
 * Thrown by every `NOT_WIRED_CONVERSATION_ACCESS` method — the fail-closed default
 * when no live Supabase backend is wired (mirrors `DataAccessNotWiredError`). A
 * route that reaches the DB without an injected impl fails LOUDLY, never silently
 * returns an empty/fabricated result.
 */
class ConversationAccessNotWiredError extends Error {
  readonly code = "CONVERSATION_ACCESS_NOT_WIRED" as const;
  constructor(op: string) {
    super(
      `conversation data access is not wired: '${op}' has no live Supabase backend ` +
        `in this build. Inject a ConversationDataAccess via the route's dependency ` +
        `seam, or wire the live service-role impl.`,
    );
    this.name = "ConversationAccessNotWiredError";
  }
}

/**
 * Thrown when `setConversationPiece` is asked to RE-link a conversation that is
 * already linked to a DIFFERENT piece. A conversation's `piece_id` is set ONCE (the
 * first draft); re-pointing it to another piece is a logic error, not a silent
 * overwrite. (Re-setting to the SAME piece is idempotent — no throw.)
 */
class ConversationPieceConflictError extends Error {
  readonly code = "CONVERSATION_PIECE_CONFLICT" as const;
  constructor(conversationId: string, existing: string, attempted: string) {
    super(
      `conversation ${conversationId} is already linked to piece ${existing}; ` +
        `refusing to re-link it to a different piece ${attempted} ` +
        `(a conversation's piece is set once).`,
    );
    this.name = "ConversationPieceConflictError";
  }
}

export { ConversationAccessNotWiredError, ConversationPieceConflictError };

/**
 * The production default. Every method throws `ConversationAccessNotWiredError` —
 * fail-closed (never fail-open). Swapped for the live service-role impl by
 * `resolve-conversation-access.ts` when creds are present; injected with an
 * in-memory/fixture impl in tests.
 */
export const NOT_WIRED_CONVERSATION_ACCESS: ConversationDataAccess = {
  createConversation: () => {
    throw new ConversationAccessNotWiredError("createConversation");
  },
  getConversation: () => {
    throw new ConversationAccessNotWiredError("getConversation");
  },
  listConversations: () => {
    throw new ConversationAccessNotWiredError("listConversations");
  },
  listTurns: () => {
    throw new ConversationAccessNotWiredError("listTurns");
  },
  appendTurn: () => {
    throw new ConversationAccessNotWiredError("appendTurn");
  },
  nextSeq: () => {
    throw new ConversationAccessNotWiredError("nextSeq");
  },
  setConversationPiece: () => {
    throw new ConversationAccessNotWiredError("setConversationPiece");
  },
};
