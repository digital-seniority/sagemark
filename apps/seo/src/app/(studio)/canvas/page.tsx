/**
 * Studio canvas route (Slice 5 / P-I, lane studio-ui) — mounts the three-zone agent
 * canvas CHAT-FIRST (not idle).
 *
 * THE CHAT-FIRST MOUNT. A Server Component that resolves the operator's workspace
 * (the DR-003 auth chokepoint) -> the workspace's client -> the ONE conversation the
 * URL names, then renders the CLIENT `SeoStudioCanvas` WIRED for chat: it passes
 * `conversationId` + `clientId` + the persisted `initialTranscript` + the linked
 * piece `brief`, so the canvas's composer owns the run (POST /api/run with
 * `{ conversationId, clientId, prompt }`) and folds the streamed taxonomy into the
 * three zones. `streamUrl={null}` — there is no live run until the operator sends a
 * turn (this is the correct chat-first first-paint state, NOT the old idle shell).
 *
 * TENANCY (fail-closed). `workspaceId` + `clientId` are the SERVER's resolution
 * (operator -> workspace -> client); the URL supplies ONLY `?conversation=<id>`,
 * which is loaded SCOPED by the bound `(id, workspaceId, clientId)`. A conversation
 * that is NOT owned by the bound workspace/client resolves to null and the page
 * REDIRECTS to `/` (no cross-tenant transcript leak, no existence oracle). A missing
 * `?conversation` (or no workspace/client) also redirects home — the canvas is never
 * mounted without an owned thread.
 *
 * The conversation/content seams are live-resolved behind the service-role creds gate
 * (DR-026 pattern). The resolution logic is in `studio-resolve.ts` (unit-tested with
 * fakes); this file is the thin Server-Component shell + the redirect + the mount.
 *
 * Next 16: async `searchParams` (a Promise — awaited). ROLLBACK: revert this file to
 * the idle `<SeoStudioCanvas streamUrl={null} brief={null}/>` shell; the home page +
 * routes are untouched. Colour from globals.css tokens (no hardcoded palette). Clean
 * ASCII / UTF-8.
 */

import { redirect } from "next/navigation";

import { requireOperator, getCurrentWorkspace } from "@/lib/auth";
import { resolveWorkspaceClient } from "@/lib/content/resolve-workspace-client";
import { resolveConversationDataAccess } from "@/lib/conversation/resolve-conversation-access";
import { resolveContentDataAccess } from "@/lib/content/resolve-data-access";
import { resolveProjectDataAccess } from "@/lib/projects/resolve-project-access";
import { SeoStudioCanvas } from "../SeoStudioCanvas";
import { resolveCanvas } from "../studio-resolve";

/** A live, per-operator read — never cached. */
export const dynamic = "force-dynamic";

/** Read the single `conversation` search param (Next 16: a string | string[] | undefined). */
function readConversationId(
  searchParams: Record<string, string | string[] | undefined>,
): string | null {
  const raw = searchParams.conversation;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return null;
}

export default async function StudioCanvasPage({
  searchParams,
}: {
  // Next 16: `searchParams` is a Promise resolved at request time.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // THE GATE: redirects to /sign-in when unauthenticated (control never returns).
  const operator = await requireOperator();

  const sp = await searchParams;
  const conversationId = readConversationId(sp);

  // Live-resolve the seams behind the creds gate (NOT_WIRED defaults with no creds;
  // resolveWorkspaceClient returns null -> resolveCanvas redirects home).
  const [conversations, content, projects] = await Promise.all([
    resolveConversationDataAccess(),
    resolveContentDataAccess(),
    resolveProjectDataAccess().catch(() => null),
  ]);

  const state = await resolveCanvas(conversationId, {
    resolveWorkspace: getCurrentWorkspace,
    resolveClient: resolveWorkspaceClient,
    conversations,
    content,
    ...(projects ? { projects } : {}),
  });

  // Fail-closed: no owned conversation (absent / blank / not-owned / no workspace or
  // client) -> back to the home list. The canvas is NEVER mounted without an owned
  // thread.
  if (state.kind === "redirect-home") {
    redirect("/");
  }

  // CHAT-FIRST mount: conversationId + clientId make the canvas chat-driven (the
  // composer POSTs /api/run). `streamUrl={null}` — no live run until the first turn.
  return (
    <SeoStudioCanvas
      conversationId={state.conversationId}
      clientId={state.clientId}
      clientName={state.clientName}
      operatorName={operator.email}
      pieceId={state.pieceId}
      brief={state.brief}
      strategy={state.strategy}
      strategyStatus={state.strategyStatus}
      projectId={state.projectId}
      initialTranscript={state.transcript}
      streamUrl={null}
    />
  );
}
