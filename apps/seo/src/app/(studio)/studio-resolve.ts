/**
 * Studio page resolution (Slice 5 / P-I, lane studio-ui).
 *
 * THE SERVER-SIDE TENANCY RESOLUTION the two studio Server Components (home +
 * canvas) share. Both pages must: resolve the operator's workspace (the DR-003 auth
 * seam), resolve that workspace's single client (the studio tenancy bridge), and —
 * for the canvas — load ONE owned conversation + its turns + (when linked) its piece
 * brief. Factoring it here keeps the pages thin and makes the resolution
 * UNIT-TESTABLE with injected fakes (no RSC render, no live Supabase).
 *
 * TENANCY (the load-bearing invariant). `workspaceId` is the SERVER's resolution of
 * the operator's workspace; `clientId` is the SERVER's resolution of that
 * workspace's client. NEITHER is ever taken from request input. The URL supplies
 * ONLY a conversation id, which is loaded SCOPED by the bound `(id, workspaceId,
 * clientId)` — a conversation that is not owned by the bound workspace/client
 * resolves to null (the canvas redirects home; no cross-tenant transcript leak).
 *
 * No `server-only` marker (imported by plain-Node tests; the live wiring that
 * touches creds lives in the page files + resolve-workspace-client.ts, which ARE
 * server-only). Clean ASCII / UTF-8.
 */

import type { Workspace } from "@/lib/auth";
import type { WorkspaceClient } from "@/lib/content/resolve-workspace-client";
import type {
  ConversationDataAccess,
  ConversationRow,
  ConversationTurnRow,
} from "@/lib/conversation/context";
import type { ContentDataAccess } from "@/lib/content/context";
import type { ProjectDataAccess, ProjectRow } from "@/lib/projects/context";
import type { ContentStrategy } from "@sagemark/schema-flywheel";
import type { ContentBrief } from "./artifact/BriefCard";
import type { TranscriptTurn } from "./agent/ConversationTranscript";

// ── Home resolution ────────────────────────────────────────────────────────────

/**
 * The home page's resolved state. A discriminated union so the page renders exactly
 * one branch:
 *   - `no-workspace`  — authenticated but no workspace (operator not yet seeded);
 *   - `no-client`     — workspace resolved but it owns no client yet;
 *   - `ready`         — workspace + client + the conversation list.
 *
 * (The unauthenticated case never reaches here — `requireOperator()` redirects to
 * `/sign-in` before resolution.)
 */
export type HomeState =
  | { kind: "no-workspace" }
  | { kind: "no-client"; workspace: Workspace }
  | {
      kind: "ready";
      workspace: Workspace;
      client: WorkspaceClient;
      conversations: ConversationRow[];
      /** The client's projects (Slice 5b); empty when no projects seam is wired. */
      projects: ProjectRow[];
    };

/** The injectable deps the home resolution consumes (fakes in tests). */
export interface HomeResolveDeps {
  resolveWorkspace: () => Promise<Workspace | null>;
  resolveClient: (workspaceId: string) => Promise<WorkspaceClient | null>;
  conversations: Pick<ConversationDataAccess, "listConversations">;
  /** Optional projects seam (Slice 5b). Omitted => an empty project list. */
  projects?: Pick<ProjectDataAccess, "listProjects">;
}

/**
 * Resolve the home page state: operator's workspace -> its client -> the operator's
 * conversations for that client (scoped read, most-recently-updated first). Tenancy
 * is the SERVER's at every step.
 */
export async function resolveHome(deps: HomeResolveDeps): Promise<HomeState> {
  const workspace = await deps.resolveWorkspace();
  if (!workspace) return { kind: "no-workspace" };

  const client = await deps.resolveClient(workspace.id);
  if (!client) return { kind: "no-client", workspace };

  // Scoped by the BOUND (workspaceId, clientId) — never request input.
  const conversations = await deps.conversations.listConversations(
    workspace.id,
    client.id,
  );
  const projects = deps.projects
    ? await deps.projects.listProjects(workspace.id, client.id)
    : [];
  return { kind: "ready", workspace, client, conversations, projects };
}

// ── Canvas resolution ──────────────────────────────────────────────────────────

/**
 * The canvas page's resolved state:
 *   - `redirect-home` — no workspace, no client, no/blank conversation id, OR a
 *     conversation id that is not owned by the bound workspace/client (fail-closed:
 *     the canvas redirects to `/`, never mounts a foreign thread);
 *   - `ready`         — an owned conversation + its turns + (when linked) the brief.
 */
export type CanvasState =
  | { kind: "redirect-home" }
  | {
      kind: "ready";
      clientId: string;
      /** The client display name (top-bar pill); resolved server-side. */
      clientName: string;
      conversationId: string;
      /** The linked piece id (null before a draft exists); drives in-place edit. */
      pieceId: string | null;
      brief: ContentBrief | null;
      transcript: TranscriptTurn[];
      /** The hub project id (null when the conversation is not in a hub project). */
      projectId: string | null;
      /** The project's content strategy (null when no strategy exists yet). */
      strategy: ContentStrategy | null;
      /** 'proposed' | 'approved' | 'archived' | null (null = no strategy). */
      strategyStatus: "proposed" | "approved" | "archived" | null;
    };

/** The injectable deps the canvas resolution consumes (fakes in tests). */
export interface CanvasResolveDeps {
  resolveWorkspace: () => Promise<Workspace | null>;
  resolveClient: (workspaceId: string) => Promise<WorkspaceClient | null>;
  conversations: Pick<ConversationDataAccess, "getConversation" | "listTurns">;
  content: Pick<ContentDataAccess, "loadPiece">;
  /** Optional projects seam; omitted → strategy fields are null. */
  projects?: Pick<ProjectDataAccess, "getProject">;
}

/** Project a persisted turn to the transcript wire shape the canvas consumes. */
function toTranscriptTurn(t: ConversationTurnRow): TranscriptTurn {
  return {
    id: t.id,
    seq: t.seq,
    role: t.role,
    content: t.content,
    runId: t.runId,
    pieceVersion: t.pieceVersion,
    // `verdict` on the turn row is the structured Verdict band; the transcript chip
    // renders it as a string.
    verdict: t.verdict ? String(t.verdict) : null,
    createdAt: t.createdAt,
  };
}

/**
 * Build the artifact `ContentBrief` from a conversation's linked piece. A
 * conversation with no `pieceId` (no draft yet) has no brief -> null. The brief is
 * loaded SCOPED by the bound client; a piece that does not resolve under the bound
 * client (or has no brief snapshot keyword) still yields a title/slug brief.
 */
async function resolveBrief(
  conversation: ConversationRow,
  clientId: string,
  content: Pick<ContentDataAccess, "loadPiece">,
): Promise<ContentBrief | null> {
  if (!conversation.pieceId) return null;
  const piece = await content.loadPiece(conversation.pieceId, clientId);
  if (!piece) return null;
  return {
    title: piece.title,
    slug: piece.slug,
    primaryKeyword: piece.briefSnapshot?.keyword ?? null,
    // `funnelStage` is not carried on the `content_pieces` projection the studio
    // reads (it lives on the published projection); left null until surfaced.
    funnelStage: null,
    isYmyl: piece.isYmyl,
  };
}

/**
 * Resolve the canvas page state for a (possibly absent) URL conversation id.
 *
 *   - no workspace / no client / no-or-blank conversation id -> redirect-home.
 *   - a conversation id that does not resolve under the bound (workspaceId,
 *     clientId) -> redirect-home (fail-closed; a foreign id never mounts).
 *   - an owned conversation -> ready (turns + brief), to mount the canvas chat-first.
 */
export async function resolveCanvas(
  conversationId: string | null | undefined,
  deps: CanvasResolveDeps,
): Promise<CanvasState> {
  const workspace = await deps.resolveWorkspace();
  if (!workspace) return { kind: "redirect-home" };

  const client = await deps.resolveClient(workspace.id);
  if (!client) return { kind: "redirect-home" };

  const id = (conversationId ?? "").trim();
  if (!id) return { kind: "redirect-home" };

  // Scoped by the BOUND (id, workspaceId, clientId). A conversation that is not
  // owned by this workspace/client resolves to null -> redirect (no leak).
  const conversation = await deps.conversations.getConversation(
    id,
    workspace.id,
    client.id,
  );
  if (!conversation) return { kind: "redirect-home" };

  const [turns, brief, project] = await Promise.all([
    deps.conversations.listTurns(id, workspace.id, client.id),
    resolveBrief(conversation, client.id, deps.content),
    conversation.projectId && deps.projects
      ? deps.projects.getProject(conversation.projectId, workspace.id, client.id).catch(() => null)
      : Promise.resolve(null),
  ]);

  return {
    kind: "ready",
    clientId: client.id,
    clientName: client.name,
    conversationId: id,
    pieceId: conversation.pieceId,
    brief,
    transcript: turns
      .slice()
      .sort((a, b) => a.seq - b.seq)
      .map(toTranscriptTurn),
    projectId: conversation.projectId ?? null,
    strategy: project?.strategy ? (project.strategy as ContentStrategy) : null,
    strategyStatus: project?.strategyStatus ?? null,
  };
}
