/**
 * Slice 5 — prepareTurn injects PROJECT CONTEXT (node).
 *
 * Proves the run pre-amble wires the project seam into the worker brief: a
 * conversation with a project_id pulls the project (brief + prior-piece facts) and
 * injects the context; no project_id (or no projects seam) injects nothing.
 */

import { describe, it, expect } from "vitest";

import { prepareTurn } from "@/app/api/run/turn";
import type { ConversationRow, ConversationDataAccess } from "@/lib/conversation/context";
import type { ContentDataAccess } from "@/lib/content/context";
import type { ProjectDataAccess } from "@/lib/projects/context";

const BOUND = { workspaceId: "ws-1", clientId: "cl-1" };

function conv(over: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: "conv-1",
    workspaceId: "ws-1",
    clientId: "cl-1",
    pieceId: null,
    projectId: null,
    title: null,
    status: "active",
    createdAt: "t",
    updatedAt: "t",
    ...over,
  };
}

function conversations(c: ConversationRow): ConversationDataAccess {
  return {
    getConversation: async () => c,
    listTurns: async () => [],
    nextSeq: async () => 0,
    appendTurn: async () => "turn-1",
    createConversation: async () => "x",
    listConversations: async () => [],
    setConversationPiece: async () => undefined,
    setConversationTitle: async () => undefined,
  };
}

const data = {
  loadPiece: async () => null,
  loadLatestVersion: async () => null,
} as unknown as ContentDataAccess;

const projects: Pick<ProjectDataAccess, "getProject" | "listProjectPieces"> = {
  getProject: async () => ({
    id: "p-1",
    workspaceId: "ws-1",
    clientId: "cl-1",
    name: "Dementia Care Hub",
    description: null,
    brief: "Warm, non-institutional voice.",
    summary: null,
    createdAt: "t",
    updatedAt: "t",
  }),
  listProjectPieces: async () => [
    {
      id: "x",
      title: "Early signs of dementia",
      slug: "early-signs",
      clusterRole: "spoke",
      funnelStage: "decision",
      primaryKeyword: "early signs",
      excerpt: "What families watch for.",
    },
  ],
};

describe("prepareTurn — project context", () => {
  it("injects PROJECT CONTEXT when the conversation belongs to a project", async () => {
    const res = await prepareTurn({
      conversationId: "conv-1",
      newMessage: "Draft a spoke.",
      bound: BOUND,
      conversations: conversations(conv({ projectId: "p-1" })),
      data,
      projects,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.prompt).toContain("PROJECT CONTEXT (data):");
    expect(res.prompt).toContain("Dementia Care Hub");
    expect(res.prompt).toContain("Early signs of dementia");
  });

  it("injects nothing when the conversation has no project", async () => {
    const res = await prepareTurn({
      conversationId: "conv-1",
      newMessage: "Draft.",
      bound: BOUND,
      conversations: conversations(conv({ projectId: null })),
      data,
      projects,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.prompt).not.toContain("PROJECT CONTEXT");
  });

  it("injects nothing when no projects seam is wired", async () => {
    const res = await prepareTurn({
      conversationId: "conv-1",
      newMessage: "Draft.",
      bound: BOUND,
      conversations: conversations(conv({ projectId: "p-1" })),
      data,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.prompt).not.toContain("PROJECT CONTEXT");
  });
});
