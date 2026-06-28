/**
 * Turn-aware helpers for POST /api/run (Slice 5 / P-F, lane worker-runtime).
 *
 * THE CHAT-TURN PRE-AMBLE + AGENT-TURN RECORDER. When `/api/run` receives an
 * optional `conversationId`, the run is no longer a one-shot dispatch — it is one
 * TURN of a persisted conversation (Supabase = system of record, D9). This module
 * owns the turn-specific seam logic so `route.ts` stays the gate-sequence
 * orchestrator:
 *
 *   1. `prepareTurn` — the PRE-AMBLE (after the tenancy bind, BEFORE cost/mint/
 *      dispatch). It loads the conversation scoped to the bound (workspaceId,
 *      clientId) — a cross-tenant / unknown id resolves to NOT-OWNED (404). It
 *      lists the transcript, loads the current draft body (if the thread is linked
 *      to a piece), records the USER turn SYNCHRONOUSLY (`appendTurn`), and composes
 *      the worker brief via the pure `composeTurnPrompt`. The composed brief REPLACES
 *      the default one-shot brief for this dispatch.
 *
 *   2. `wrapSourceRecordingAgentTurn` — the AGENT-TURN-ON-DONE mechanism. The relay
 *      consumes the worker event source internally (it returns a streaming Response;
 *      there is no clean post-relay callback on the route). So we WRAP the worker
 *      `WorkerEventSource` in a pass-through async iterable that observes the stream:
 *      when it sees a TERMINAL frame (`done`) or the stream closes, it reads the
 *      conversation's persisted piece (latest version + verdict) and records the
 *      AGENT turn (`appendTurn{role:'agent', runId, pieceVersion, verdict, ...}`),
 *      linking the conversation to its piece on the first draft
 *      (`setConversationPiece`). A terminal `error` frame records NOTHING (no draft
 *      was produced) — the run failed; recording a phantom agent turn would corrupt
 *      the transcript.
 *
 *      IDEMPOTENCY (load-bearing). Recording is guarded so a given run can never
 *      double-record an agent turn: (a) it records at most once per wrapped source
 *      (a latch); (b) before appending it re-checks the transcript for an existing
 *      agent turn carrying THIS `runId` and skips if found; (c) the append itself is
 *      protected by the `(conversation_id, seq)` unique index — a racing duplicate
 *      throws and is swallowed (the turn is already recorded). Recording failures
 *      NEVER surface to the client stream (the draft is persisted truth regardless);
 *      they are swallowed so a late bookkeeping write can't corrupt a delivered run.
 *
 * TENANCY: every read/write here is scoped by the BOUND (workspaceId, clientId)
 * — never request input beyond the validated, owned `conversationId`.
 *
 * PURE-ISH: no Next APIs, no direct DB import (everything goes through the injected
 * `ConversationDataAccess` + `ContentDataAccess` seams + the pure composer). Clean
 * ASCII / UTF-8. No `console.*`.
 */

import type {
  ConversationDataAccess,
  ConversationRow,
} from "@/lib/conversation/context";
import type { ContentDataAccess } from "@/lib/content/context";
import {
  composeTurnPrompt,
  type TurnPromptTranscriptTurn,
  type TurnPromptDraft,
} from "@/lib/conversation/compose-turn-prompt";
import type { ProjectDataAccess } from "@/lib/projects/context";
import { buildProjectContext } from "@/lib/projects/build-project-context";
import type { SseEvent } from "@/lib/stream/event-taxonomy";
import type {
  TruthSnapshot,
  TruthSnapshotReader,
} from "@/lib/stream/sse-relay";
import type { Verdict } from "@sagemark/core";

/** The bound tenancy every turn read/write is scoped by (never request input). */
export interface BoundTenancy {
  workspaceId: string;
  clientId: string;
}

// ── 1. Turn pre-amble ─────────────────────────────────────────────────────────

/** The discriminated result of preparing a turn. */
export type PrepareTurnResult =
  | {
      ok: true;
      /** The composed WORKER_PROMPT brief for THIS turn (replaces the default). */
      prompt: string;
      /** The owned conversation (carries its current `pieceId`, may be null). */
      conversation: ConversationRow;
    }
  | {
      // The conversation is not owned by the bound tenancy (forged/foreign id) — the
      // route returns 404, exactly like the content kernel's NOT_OWNED bind.
      ok: false;
      status: 404;
      code: "not-found";
    };

/**
 * The PRE-AMBLE for a turn-aware run. Runs AFTER the tenancy bind, BEFORE cost/mint/
 * dispatch.
 *
 *   - load the conversation scoped to the bound (workspaceId, clientId): a
 *     cross-tenant / unknown id → NOT-OWNED (404; no existence leak);
 *   - list the transcript (ordered) + load the current draft body when the thread
 *     is linked to a piece;
 *   - record the USER turn SYNCHRONOUSLY (`appendTurn` at `nextSeq`);
 *   - compose the worker brief via the pure `composeTurnPrompt` and return it as the
 *     dispatch prompt for this turn.
 *
 * The user turn is recorded BEFORE dispatch (it is the durable record of intent);
 * the agent turn is recorded later, on stream completion, by
 * `wrapSourceRecordingAgentTurn`.
 */
export async function prepareTurn(args: {
  conversationId: string;
  newMessage: string;
  bound: BoundTenancy;
  conversations: ConversationDataAccess;
  data: ContentDataAccess;
  /**
   * OPTIONAL project seam (Slice 5). When the conversation belongs to a project,
   * its cross-article context (operator brief + prior-piece facts) is injected into
   * the worker brief. Absent / not-wired => no project context (unchanged behavior).
   */
  projects?: Pick<ProjectDataAccess, "getProject" | "listProjectPieces">;
}): Promise<PrepareTurnResult> {
  const { conversationId, newMessage, bound, conversations, data, projects } = args;
  const { workspaceId, clientId } = bound;

  // Ownership: the conversation must belong to the bound (workspaceId, clientId).
  const conversation = await conversations.getConversation(
    conversationId,
    workspaceId,
    clientId,
  );
  if (!conversation) {
    return { ok: false, status: 404, code: "not-found" };
  }

  // Transcript (oldest-first) — the new message is NOT yet part of it.
  const turnRows = await conversations.listTurns(conversationId, workspaceId, clientId);
  const transcript: TurnPromptTranscriptTurn[] = turnRows.map((t) => ({
    role: t.role,
    content: t.content,
  }));

  // Current draft body — only when the thread is linked to a piece. The CURRENT
  // body is the highest-version row (loadLatestVersion); fall back to the piece's
  // own body if no version snapshot exists yet.
  const currentDraft = await loadCurrentDraft(conversation, clientId, data);

  // Project context (Slice 5): when the thread belongs to a project, summarize the
  // prior work (operator brief + facts about the articles already in the project)
  // so a new piece keeps continuity and does not re-cover ground.
  const projectContextNote = await loadProjectContextNote(conversation, bound, projects);

  // Record the USER turn synchronously at the next seq.
  const seq = await conversations.nextSeq(conversationId, workspaceId, clientId);
  await conversations.appendTurn({
    conversationId,
    workspaceId,
    clientId,
    seq,
    role: "user",
    content: newMessage,
  });

  // Compose the worker brief for this turn (pure; deterministic).
  const prompt = composeTurnPrompt({
    newMessage,
    transcript,
    currentDraft,
    projectContextNote,
  });

  return { ok: true, prompt, conversation };
}

/**
 * Build the project-context note for a turn, or null when the thread has no project
 * (or no project seam is wired). Scoped by the bound (workspaceId, clientId).
 */
async function loadProjectContextNote(
  conversation: ConversationRow,
  bound: BoundTenancy,
  projects: Pick<ProjectDataAccess, "getProject" | "listProjectPieces"> | undefined,
): Promise<string | null> {
  if (!conversation.projectId || !projects) return null;
  const project = await projects.getProject(
    conversation.projectId,
    bound.workspaceId,
    bound.clientId,
  );
  if (!project) return null;
  const pieces = await projects.listProjectPieces(
    conversation.projectId,
    bound.workspaceId,
    bound.clientId,
  );
  return buildProjectContext({
    projectName: project.name,
    brief: project.brief,
    pieces: pieces.map((p) => ({
      title: p.title,
      slug: p.slug,
      clusterRole: p.clusterRole,
      funnelStage: p.funnelStage,
      primaryKeyword: p.primaryKeyword,
      excerpt: p.excerpt,
    })),
  });
}

/**
 * Resolve the CURRENT draft (title + body) for a conversation's linked piece, or
 * null when the thread has no piece yet (first turn). The current body is the
 * highest-version `content_piece_versions` row; if no version snapshot exists we
 * fall back to the `content_pieces.body`. Read-only, scoped by the bound clientId.
 */
async function loadCurrentDraft(
  conversation: ConversationRow,
  clientId: string,
  data: ContentDataAccess,
): Promise<TurnPromptDraft | null> {
  if (!conversation.pieceId) return null;
  const piece = await data.loadPiece(conversation.pieceId, clientId);
  if (!piece) return null;

  const latest = await data.loadLatestVersion(conversation.pieceId, clientId);
  const body = latest?.body && latest.body.trim().length > 0 ? latest.body : piece.body;
  if (!body || body.trim().length === 0) return null;

  return { title: piece.title, body };
}

// ── 2. Agent-turn-on-done (the stream wrapper) ────────────────────────────────

/** What the agent-turn recorder needs to read the persisted draft + record. */
export interface AgentTurnRecorderDeps {
  conversationId: string;
  runId: string;
  bound: BoundTenancy;
  /** The conversation BEFORE the turn (its `pieceId` may be null → first draft). */
  conversation: ConversationRow;
  conversations: ConversationDataAccess;
  data: ContentDataAccess;
  /**
   * OPTIONAL observer of the fire-and-forget agent-turn write (tests await it for
   * determinism). Receives the in-flight recording promise the instant it starts.
   * Production leaves it unset — the write stays fire-and-forget, never blocking the
   * stream. The promise NEVER rejects (recording errors are swallowed before it).
   */
  onRecording?: (settled: Promise<void>) => void;
}

/**
 * Wrap a worker `WorkerEventSource` so that the AGENT turn is recorded once the run
 * completes. The relay drains the returned iterable; we observe every frame and,
 * on the FIRST terminal `done` frame OR a clean stream close (no terminal frame),
 * record the agent turn. A terminal `error` frame records NOTHING (the run failed,
 * no draft was produced) — recording a phantom turn would corrupt the transcript.
 *
 * The recording is fire-and-forget AFTER the terminal observation: it never blocks
 * the stream and its failures never surface to the client. Idempotency is enforced
 * in `recordAgentTurn` (the latch + the run-id transcript re-check + the unique
 * index). The pass-through preserves the exact frame order the relay forwards.
 */
export function wrapSourceRecordingAgentTurn(
  source: AsyncIterable<SseEvent>,
  deps: AgentTurnRecorderDeps,
): AsyncIterable<SseEvent> {
  let recorded = false;
  // Record at most once. `succeeded` controls WHETHER a draft was produced.
  const recordOnce = (succeeded: boolean): void => {
    if (recorded) return;
    recorded = true;
    if (!succeeded) return; // a failed run records no agent turn
    // Fire-and-forget — never block the stream, never surface a bookkeeping error.
    const settled = recordAgentTurn(deps).catch(() => undefined);
    deps.onRecording?.(settled);
  };

  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<SseEvent> {
      // The downstream relay (`relayFrames`) STOPS pulling this iterator the moment
      // it forwards a terminal frame (`done`/`error`) — it never requests the value
      // after the terminal one. So any recording MUST happen BEFORE we yield a
      // terminal frame, not after (code after `yield <terminal>` would never run).
      for await (const event of source) {
        if (event.type === "error") {
          // Terminal failure — record nothing (no draft produced), then forward.
          recordOnce(false);
          yield event;
          return;
        }
        if (event.type === "done") {
          // Terminal success — the draft is persisted by the time the worker emits
          // `done`, so record the agent turn BEFORE forwarding the terminal frame.
          recordOnce(true);
          yield event;
          return;
        }
        yield event;
      }
      // The source ended WITHOUT a terminal frame. The relay synthesizes a clean
      // `done` downstream (sse-relay), so this run produced a draft — record it.
      recordOnce(true);
    },
  };
}

/**
 * Record the AGENT turn for a completed run — IDEMPOTENTLY. Reads the persisted
 * piece (latest version + verdict) for the conversation, appends the agent turn,
 * and links the conversation to its piece on the first draft.
 *
 * Idempotency layers:
 *   (a) the caller's once-latch (this fires at most once per wrapped source);
 *   (b) a transcript re-check — if an agent turn already carries THIS `runId`, skip
 *       (covers a late retry / a lazy-reconciliation race);
 *   (c) the `(conversation_id, seq)` unique index — a racing duplicate append throws
 *       and is swallowed by the caller.
 *
 * Tenancy: every read/write is scoped by the bound (workspaceId, clientId).
 */
export async function recordAgentTurn(deps: AgentTurnRecorderDeps): Promise<void> {
  const { conversationId, runId, bound, conversation, conversations, data } = deps;
  const { workspaceId, clientId } = bound;

  // Re-load the conversation so we read the CURRENT `pieceId` (the worker may have
  // linked a piece out-of-band; we never trust the pre-turn snapshot for the link).
  const current =
    (await conversations.getConversation(conversationId, workspaceId, clientId)) ??
    conversation;

  // (b) Run-id idempotency: skip if an agent turn for THIS run already exists.
  const existing = await conversations.listTurns(conversationId, workspaceId, clientId);
  if (existing.some((t) => t.role === "agent" && t.runId === runId)) {
    return;
  }

  // Resolve the persisted piece for the conversation. On the FIRST draft the worker
  // created a NEW piece the conversation is not yet linked to; we cannot know its id
  // without a run->piece link. So: prefer the already-linked piece; if unlinked, we
  // record the agent turn WITHOUT a piece version (the lazy reconciliation / P-G
  // load can backfill the link), but still record that the run completed.
  const pieceId = current.pieceId;
  let pieceVersion: number | null = null;
  let verdict: Verdict | null = null;
  let summary = "Draft updated.";

  if (pieceId) {
    const piece = await data.loadPiece(pieceId, clientId);
    if (piece) {
      const latest = await data.loadLatestVersion(pieceId, clientId);
      pieceVersion = latest?.version ?? piece.version;
      verdict = latest?.verdict ?? piece.verdict;
      summary = summarizeAgentTurn(piece.title, pieceVersion, verdict);
    }
  }

  const seq = await conversations.nextSeq(conversationId, workspaceId, clientId);
  await conversations.appendTurn({
    conversationId,
    workspaceId,
    clientId,
    seq,
    role: "agent",
    content: summary,
    runId,
    pieceVersion,
    verdict,
  });

  // Link the conversation to its piece on the first draft (idempotent in the seam:
  // re-linking to the SAME piece is a no-op; a different piece throws — which the
  // caller swallows). Only attempt when we actually resolved a piece + it is not
  // already the linked one.
  if (pieceId && current.pieceId == null) {
    await conversations.setConversationPiece(conversationId, pieceId, workspaceId, clientId);
  }
}

/** A short, already-sanitized agent-turn summary (never raw model prose). */
function summarizeAgentTurn(
  title: string,
  version: number | null,
  verdict: Verdict | null,
): string {
  const v = verdict ? ` — verdict ${verdict}` : "";
  const ver = version != null ? ` (v${version})` : "";
  return `Draft "${title}"${ver} ready${v}.`;
}

// ── 3. Live truth-snapshot reader (creds-gated; built from the read adapter) ───

/**
 * Map a persisted `content_pieces` read (via the live read adapter's `loadPiece` +
 * `loadLatestVersion`) to the relay's `TruthSnapshot` shape. The CURRENT body is
 * the highest version's; the scorecard is projected off the persisted verdict +
 * eval score (DR-039: the row IS the scorecard — there is no `gate_results` table).
 */
export async function readPieceTruthSnapshot(
  pieceId: string,
  clientId: string,
  data: Pick<ContentDataAccess, "loadPiece" | "loadLatestVersion">,
): Promise<TruthSnapshot> {
  const piece = await data.loadPiece(pieceId, clientId);
  if (!piece) return { piece: null, scorecard: null };

  const latest = await data.loadLatestVersion(pieceId, clientId);
  const body = latest?.body && latest.body.trim().length > 0 ? latest.body : piece.body;
  const verdict = latest?.verdict ?? piece.verdict;

  return {
    piece: {
      pieceId: piece.id,
      slug: piece.slug,
      title: piece.title,
      body,
      status: piece.status,
    },
    scorecard: {
      stageAVetoes: [],
      score: piece.evalScore,
      verdict,
    },
  };
}

/**
 * The default (one-shot path) live truth reader, creds-gated + fail-soft.
 *
 * The relay reads by `{workspaceId, clientId, runId}` on a reconnect. A one-shot run
 * has no conversation, and `content_pieces` carries NO `run_id` column, so there is
 * no run->piece link to resolve a one-shot piece by run id alone. Rather than
 * fabricate or throw, this reader returns the NON-FABRICATED empty snapshot
 * (`{piece:null, scorecard:null}`) — the relay forwards it verbatim (the browser
 * keeps whatever it streamed). It is gated by `read`: with no creds the route keeps
 * the fail-closed `NOT_WIRED_TRUTH_READER` (inert/throws) — back-compat unchanged.
 *
 * Today there is no run->piece link to read a one-shot piece from, so the reader
 * fail-soft-empties. It is kept as a named factory (not an inline literal) so a
 * future `run_id` link can widen it (closing over the live read adapter) WITHOUT a
 * route change.
 */
export function makeDefaultTruthReader(): TruthSnapshotReader {
  return async () => ({ piece: null, scorecard: null });
}

/**
 * Build the relay's `TruthSnapshotReader` from the live content read adapter +
 * conversation seam, scoped to ONE turn-aware run's conversation. The relay reads
 * by `{workspaceId, clientId, runId}` on a `last_event_id` reconnect; we resolve
 * the conversation's CURRENT `pieceId` and read its persisted truth via
 * `readPieceTruthSnapshot`. A conversation with no piece yet (mid-first-draft)
 * returns `{piece:null, scorecard:null}` — a valid, non-fabricated empty snapshot
 * the relay forwards as-is.
 *
 * SCOPE GUARD: the reader refuses a reconnect whose scope tenancy does not match the
 * bound conversation's tenancy (defence-in-depth — the relay already stamps runId,
 * this also pins the tenancy), returning the empty snapshot rather than a leak.
 */
export function makeConversationTruthReader(args: {
  conversationId: string;
  bound: BoundTenancy;
  conversations: Pick<ConversationDataAccess, "getConversation">;
  data: Pick<ContentDataAccess, "loadPiece" | "loadLatestVersion">;
}): TruthSnapshotReader {
  const { conversationId, bound, conversations, data } = args;
  return async (scope) => {
    // Defence-in-depth tenancy pin.
    if (scope.workspaceId !== bound.workspaceId || scope.clientId !== bound.clientId) {
      return { piece: null, scorecard: null };
    }
    const conversation = await conversations.getConversation(
      conversationId,
      bound.workspaceId,
      bound.clientId,
    );
    if (!conversation || !conversation.pieceId) {
      return { piece: null, scorecard: null };
    }
    return readPieceTruthSnapshot(conversation.pieceId, bound.clientId, data);
  };
}
