/**
 * /content/api/draft — criterion 2 (tenancy mismatch 403 + voice-spec hard stop)
 * + criterion 7 (cross-tenant).
 */

import { describe, it, expect, vi } from "vitest";
import { handleDraft } from "@/app/content/api/draft/route";
import {
  makeData,
  workspace,
  jsonRequest,
  WORKSPACE_A,
  WORKSPACE_B,
  CLIENT_A,
  CLIENT_B,
} from "./fixtures";

function draftBody(over: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE_A,
    clientId: CLIENT_A,
    title: "A Grounded Title",
    slug: "a-grounded-title",
    body: "## Heading\n\nGrounded body content.\n",
    ...over,
  };
}

describe("draft — criterion 2: tenancy mismatch → 403", () => {
  it("rejects a payload whose workspace_id != the bound context (403)", async () => {
    const data = makeData();
    const res = await handleDraft(
      jsonRequest(draftBody({ workspaceId: WORKSPACE_B })),
      { data, resolveWorkspace: async () => workspace(WORKSPACE_A) },
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("tenancy-mismatch");
    // No write occurred — the mismatch was rejected before persistence.
    expect(data.writes.insertDraftPiece).toBe(0);
  });

  it("rejects a payload whose client_id != the bound context (404 — not owned)", async () => {
    // clientId CLIENT_B is not owned by WORKSPACE_A → bind fails 404 before the
    // mismatch check even runs (no existence leak).
    const data = makeData();
    const res = await handleDraft(jsonRequest(draftBody({ clientId: CLIENT_B })), {
      data,
      resolveWorkspace: async () => workspace(WORKSPACE_A),
    });
    expect(res.status).toBe(404);
    expect(data.writes.insertDraftPiece).toBe(0);
  });
});

describe("draft — criterion 2: voice-spec hard stop", () => {
  it("refuses creation when the client has no approved voice spec (409)", async () => {
    const data = makeData({ getApprovedVoiceSpec: vi.fn(async () => null) });
    const res = await handleDraft(jsonRequest(draftBody()), {
      data,
      resolveWorkspace: async () => workspace(WORKSPACE_A),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("no-approved-voice-spec");
    expect(data.writes.insertDraftPiece).toBe(0);
  });

  it("writes the piece scoped by the BOUND client id when a spec is approved", async () => {
    const data = makeData();
    const res = await handleDraft(jsonRequest(draftBody()), {
      data,
      resolveWorkspace: async () => workspace(WORKSPACE_A),
    });
    expect(res.status).toBe(200);
    expect(data.writes.insertDraftPiece).toBe(1);
    // The insert used the bound client id, never request-widened tenancy.
    const call = (data.insertDraftPiece as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.clientId).toBe(CLIENT_A);
    expect(call.authorId).toBeTruthy(); // byline resolved server-side from spec
  });
});

describe("draft — criterion 7: cross-tenant", () => {
  it("unauthenticated → 401", async () => {
    const data = makeData();
    const res = await handleDraft(jsonRequest(draftBody()), {
      data,
      resolveWorkspace: async () => null,
    });
    expect(res.status).toBe(401);
  });
});
