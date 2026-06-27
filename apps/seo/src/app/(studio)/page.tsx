/**
 * Studio home (Slice 5 / P-I, lane studio-ui) — the chat-first front door's list +
 * new-thread surface. Replaces the PR-001 placeholder.
 *
 * A Server Component that resolves EVERYTHING server-side, fail-closed:
 *   requireOperator()  -> redirects to /sign-in when unauthenticated (the gate).
 *   getCurrentWorkspace() -> the operator's workspace, or a "no workspace yet"
 *     state (an authed operator with no seeded membership — contact admin).
 *   resolveWorkspaceClient() -> the workspace's single client (v1: one client per
 *     workspace), or a "no client yet" state.
 *   listConversations(workspaceId, clientId) -> the operator's threads for that
 *     client (scoped read), most-recently-updated first.
 *
 * TENANCY is the SERVER's at every step (operator -> workspace -> client); NOTHING
 * is taken from request input. The page renders a "Start a new piece" action (a tiny
 * client button that POSTs /api/conversations) + the existing conversations, each
 * linking `/canvas?conversation=<id>`.
 *
 * The conversation/content seams are live-resolved behind the service-role creds
 * gate (DR-026 pattern): with no creds set the conversation seam stays NOT_WIRED and
 * `resolveWorkspaceClient` returns null -> the page shows the "no client" state
 * rather than throwing. The resolution logic is in `studio-resolve.ts` (unit-tested
 * with fakes); this file is the thin Server-Component shell + the markup.
 *
 * Colour from the globals.css tokens (`--foreground`/`--background` via
 * `currentColor` + opacity) — no hardcoded palette. Clean ASCII / UTF-8.
 */

import Link from "next/link";

import { requireOperator, getCurrentWorkspace } from "@/lib/auth";
import { resolveWorkspaceClient } from "@/lib/content/resolve-workspace-client";
import { resolveConversationDataAccess } from "@/lib/conversation/resolve-conversation-access";
import type { ConversationRow } from "@/lib/conversation/context";
import { resolveHome } from "./studio-resolve";
import { StartConversationButton } from "./StartConversationButton";

/** A live, per-operator list — never cached. */
export const dynamic = "force-dynamic";

const SUBTLE: React.CSSProperties = { opacity: 0.6, fontSize: 13 };
const PAGE: React.CSSProperties = { maxWidth: 720, margin: "0 auto", padding: "4rem 1.5rem" };

/** A short, locale-stable rendering of the thread's last-updated time. */
function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ textTransform: "uppercase", letterSpacing: "0.1em", ...SUBTLE }}>
      {children}
    </p>
  );
}

function ConversationList({ conversations }: { conversations: ConversationRow[] }) {
  if (conversations.length === 0) {
    return (
      <p data-testid="conversations-empty" style={{ ...SUBTLE, marginTop: 16 }}>
        No pieces yet. Start one above to open the canvas.
      </p>
    );
  }
  return (
    <ul
      data-testid="conversation-list"
      style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "grid", gap: 8 }}
    >
      {conversations.map((c) => (
        <li key={c.id}>
          <Link
            href={`/canvas?conversation=${encodeURIComponent(c.id)}`}
            data-testid="conversation-link"
            data-conversation-id={c.id}
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              padding: "0.75rem 1rem",
              borderRadius: 10,
              border: "1px solid color-mix(in srgb, currentColor 14%, transparent)",
              color: "inherit",
              textDecoration: "none",
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 600 }}>
              {c.title?.trim() || "Untitled piece"}
            </span>
            <span style={SUBTLE}>{formatUpdatedAt(c.updatedAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function StudioHome() {
  // THE GATE: redirects to /sign-in when unauthenticated (control never returns).
  await requireOperator();

  // Live-resolve the conversation seam behind the creds gate (NOT_WIRED default
  // with no creds — then `resolveWorkspaceClient` returns null and we show the
  // "no client" state, never throwing on the home surface).
  const conversations = await resolveConversationDataAccess();

  const state = await resolveHome({
    resolveWorkspace: getCurrentWorkspace,
    resolveClient: resolveWorkspaceClient,
    conversations,
  });

  if (state.kind === "no-workspace") {
    return (
      <main style={PAGE}>
        <Eyebrow>SEO Creator</Eyebrow>
        <h1 style={{ fontSize: 32, fontWeight: 700, marginTop: 8 }}>No workspace yet</h1>
        <p style={{ fontSize: 16, opacity: 0.8, marginTop: 12, lineHeight: 1.6 }}>
          You are signed in, but your account is not yet linked to a workspace.
          Contact an administrator to be added before you can start a piece.
        </p>
      </main>
    );
  }

  if (state.kind === "no-client") {
    return (
      <main style={PAGE}>
        <Eyebrow>SEO Creator</Eyebrow>
        <h1 style={{ fontSize: 32, fontWeight: 700, marginTop: 8 }}>No client yet</h1>
        <p style={{ fontSize: 16, opacity: 0.8, marginTop: 12, lineHeight: 1.6 }}>
          Your workspace does not have a client configured yet. Contact an
          administrator to set one up before you can start a piece.
        </p>
      </main>
    );
  }

  return (
    <main style={PAGE}>
      <Eyebrow>SEO Creator · {state.client.name}</Eyebrow>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginTop: 8 }}>Your pieces</h1>
      <p style={{ fontSize: 16, opacity: 0.8, marginTop: 12, lineHeight: 1.6 }}>
        Start a new piece to open the canvas and brief the agent in chat, or pick up
        an existing one.
      </p>

      <section style={{ marginTop: 28 }}>
        <StartConversationButton clientId={state.client.id} />
      </section>

      <section style={{ marginTop: 36 }}>
        <h2
          style={{
            fontSize: 13,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            opacity: 0.6,
          }}
        >
          Conversations
        </h2>
        <ConversationList conversations={state.conversations} />
      </section>
    </main>
  );
}
