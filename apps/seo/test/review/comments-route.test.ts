/**
 * POST /api/review/comments — the token-scoped review-comment persist (PR 018 /
 * P1.C.1). Proves, with NO DB (injected seams):
 *
 *   - a pinned comment persists with normalized 0..1 coords + elementHint +
 *     version_left_on, scoped by the RESOLVED token's workspace_id/client_id
 *     (NEVER request input) — AC#3;
 *   - the persist tenancy is the token's tuple, not the body: there are no
 *     workspace_id/client_id/version fields on the request at all;
 *   - junk / out-of-range coords are validated (clamped to [0,1]); a `pin` with
 *     no anchor → 400, nothing persisted;
 *   - section Approve / Request-changes persist a row with the correct `kind`
 *     (section-approve | request-changes) and DO NOT release the piece (no
 *     publish/transition occurs) — AC#4;
 *   - an unknown/forged token → 404 (no existence oracle), nothing persisted.
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";

import {
  handleReviewComment,
  type ReviewCommentDeps,
} from "@/app/api/review/comments/route";
import {
  hashReviewToken,
  type ReviewScope,
  type ReviewCommentInsert,
  type ReviewTokenDataAccess,
  type ReviewCommentDataAccess,
} from "@/lib/review/resolve-token";

const WS = randomUUID();
const CLIENT = randomUUID();
const PIECE = randomUUID();
const TOKEN = "tok_" + randomUUID().replace(/-/g, "");
const SCOPE: ReviewScope = {
  workspaceId: WS,
  clientId: CLIENT,
  pieceId: PIECE,
  version: 4,
};

function makeDeps(): {
  deps: ReviewCommentDeps;
  inserts: ReviewCommentInsert[];
} {
  const inserts: ReviewCommentInsert[] = [];
  const tokens: ReviewTokenDataAccess = {
    resolveTokenByHash: async (hash) =>
      hash === hashReviewToken(TOKEN) ? SCOPE : null,
    resolvePreviewTarget: async () => null,
  };
  const comments: ReviewCommentDataAccess = {
    insertComment: async (insert) => {
      inserts.push(insert);
      return { id: randomUUID() };
    },
  };
  return { deps: { tokens, comments }, inserts };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/review/comments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/review/comments — token-scoped persist", () => {
  it("persists a pin with normalized coords + elementHint + version_left_on, token-scoped", async () => {
    const { deps, inserts } = makeDeps();
    const res = await handleReviewComment(
      jsonRequest({
        token: TOKEN,
        kind: "pin",
        anchor: { x: 0.42, y: 0.8, elementHint: "section#costs h2" },
        body: "This number looks off.",
        author: "client:kate",
      }),
      deps,
    );
    expect(res.status).toBe(201);
    expect(inserts).toHaveLength(1);
    const row = inserts[0]!;
    // Tenancy is the RESOLVED tuple, NOT request input.
    expect(row.workspaceId).toBe(WS);
    expect(row.clientId).toBe(CLIENT);
    expect(row.pieceId).toBe(PIECE);
    expect(row.version).toBe(4); // version_left_on
    expect(row.kind).toBe("pin");
    expect(row.anchor).toEqual({ x: 0.42, y: 0.8, elementHint: "section#costs h2" });
  });

  it("clamps out-of-range pin coords to [0,1]", async () => {
    const { deps, inserts } = makeDeps();
    const res = await handleReviewComment(
      jsonRequest({
        token: TOKEN,
        kind: "pin",
        anchor: { x: 1.5, y: -0.3 },
        author: "client:kate",
      }),
      deps,
    );
    expect(res.status).toBe(201);
    expect(inserts[0]!.anchor).toEqual({ x: 1, y: 0 });
  });

  it("rejects a pin with no anchor (400), nothing persisted", async () => {
    const { deps, inserts } = makeDeps();
    const res = await handleReviewComment(
      jsonRequest({ token: TOKEN, kind: "pin", author: "client:kate" }),
      deps,
    );
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it("rejects a pin with non-finite coords (400)", async () => {
    const { deps, inserts } = makeDeps();
    // JSON cannot carry NaN; a string coord is the realistic junk case → zod 400.
    const res = await handleReviewComment(
      jsonRequest({
        token: TOKEN,
        kind: "pin",
        anchor: { x: "left", y: 0.5 },
        author: "client:kate",
      }),
      deps,
    );
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it("persists section-approve with the correct kind and does NOT release the piece", async () => {
    const { deps, inserts } = makeDeps();
    const res = await handleReviewComment(
      jsonRequest({
        token: TOKEN,
        kind: "section-approve",
        body: "Looks good.",
        author: "client:kate",
      }),
      deps,
    );
    expect(res.status).toBe(201);
    expect(inserts[0]!.kind).toBe("section-approve");
    // No transition/publish path exists on this route — the only effect is the
    // recorded comment row (AC#4: recorded, never releases the piece).
    expect(inserts).toHaveLength(1);
    const json = (await res.json()) as { kind: string };
    expect(json.kind).toBe("section-approve");
  });

  it("persists request-changes with the correct kind", async () => {
    const { deps, inserts } = makeDeps();
    const res = await handleReviewComment(
      jsonRequest({
        token: TOKEN,
        kind: "request-changes",
        body: "Please soften the cost language.",
        author: "client:kate",
      }),
      deps,
    );
    expect(res.status).toBe(201);
    expect(inserts[0]!.kind).toBe("request-changes");
  });

  it("an unknown/forged token → 404, nothing persisted (no oracle)", async () => {
    const { deps, inserts } = makeDeps();
    const res = await handleReviewComment(
      jsonRequest({
        token: "tok_" + "0".repeat(40),
        kind: "section-approve",
        author: "client:kate",
      }),
      deps,
    );
    expect(res.status).toBe(404);
    expect(inserts).toHaveLength(0);
  });

  it("ignores any body-supplied tenancy — it is never read", async () => {
    const { deps, inserts } = makeDeps();
    // Even if a caller smuggles workspace_id/client_id/version, the route binds
    // tenancy from the TOKEN's tuple; the smuggled values are dropped by zod and
    // never reach the insert.
    const res = await handleReviewComment(
      jsonRequest({
        token: TOKEN,
        kind: "section-approve",
        author: "client:kate",
        workspace_id: randomUUID(),
        client_id: randomUUID(),
        version: 99,
      }),
      deps,
    );
    expect(res.status).toBe(201);
    const row = inserts[0]!;
    expect(row.workspaceId).toBe(WS);
    expect(row.clientId).toBe(CLIENT);
    expect(row.version).toBe(4);
  });
});
