/**
 * /content/api/audit — criterion 1 (READ-ONLY) + criterion 6 (YMYL trust) +
 * criterion 7 (tenancy).
 */

import { describe, it, expect, vi } from "vitest";
import { handleAudit, type GateRunner } from "@/app/content/api/audit/route";
import type { AuditResult, GateBrief } from "@sagemark/core";
import {
  makeData,
  workspace,
  pieceRow,
  gradedSource,
  jsonRequest,
  WORKSPACE_A,
  WORKSPACE_B,
  CLIENT_A,
  CLIENT_B,
  PIECE_A,
} from "./fixtures";

/** A deterministic gate runner that records the brief it was handed. */
function spyGate(result: Partial<AuditResult> = {}): {
  run: GateRunner;
  seen: { brief?: GateBrief };
} {
  const seen: { brief?: GateBrief } = {};
  const run: GateRunner = vi.fn(async (_draft, brief) => {
    seen.brief = brief;
    return {
      verdict: "REVIEW",
      score: 78,
      dimensions: [],
      failureCodes: [],
      stageAClean: true,
      ...result,
    };
  });
  return { run, seen };
}

/**
 * A faithfulness-aware gate runner: it fires VETO_UNSOURCED_STAT iff a medical
 * claim string in the body is NOT present in any source snippet it was given.
 * This models the real seo-gate's faithfulness path so criterion 6 is provable
 * without an LLM key — the route's source FILTERING is what we assert.
 */
const MEDICAL_CLAIM = "70% of seniors experience cognitive decline";
function faithfulnessGate(): GateRunner {
  return vi.fn(async (draft, brief) => {
    const claimGrounded = brief.sources.some((s) => s.snippet.includes(MEDICAL_CLAIM));
    if (draft.body.includes(MEDICAL_CLAIM) && !claimGrounded) {
      return {
        verdict: "REVISE",
        score: null,
        dimensions: [],
        failureCodes: ["VETO_UNSOURCED_STAT"],
        stageAClean: false,
      };
    }
    return { verdict: "PUBLISH", score: 90, dimensions: [], failureCodes: [], stageAClean: true };
  });
}

const okCtx = { workspaceId: WORKSPACE_A, clientId: CLIENT_A, pieceId: PIECE_A };

describe("audit — criterion 1: READ-ONLY (no DB write)", () => {
  it("returns a verdict and performs ZERO writes", async () => {
    const data = makeData();
    const { run } = spyGate();
    const res = await handleAudit(jsonRequest(okCtx), {
      data,
      resolveWorkspace: async () => workspace(WORKSPACE_A),
      runGate: run,
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.verdict).toBe("REVIEW");
    expect(body.score).toBe(78);
    // The STRUCTURAL proof: no mutation method was ever called.
    expect(data.writes.insertDraftPiece).toBe(0);
    expect(data.writes.transitionPieceStatus).toBe(0);
    expect(data.insertDraftPiece).not.toHaveBeenCalled();
    expect(data.transitionPieceStatus).not.toHaveBeenCalled();
  });

  it("reports the persisted status unchanged (never mutates status)", async () => {
    const data = makeData({
      loadPiece: vi.fn(async () => pieceRow({ status: "review" })),
    });
    const { run } = spyGate();
    const res = await handleAudit(jsonRequest(okCtx), {
      data,
      resolveWorkspace: async () => workspace(WORKSPACE_A),
      runGate: run,
    });
    const body = await res.json();
    expect(body.status).toBe("review"); // reported, not transitioned
    expect(data.writes.transitionPieceStatus).toBe(0);
  });
});

describe("audit — criterion 6: YMYL medical-claim trust boundary", () => {
  const junkSnippet = gradedSource(
    "https://randomblog.example/post",
    "low-authority",
    `Some say ${MEDICAL_CLAIM} but who knows.`, // class (c) contains the claim string
  );
  const attributionSnippet = gradedSource(
    "https://myclinicblog.example/facts",
    "client-fact",
    `Our records note ${MEDICAL_CLAIM}.`, // class (b) contains the claim string
  );
  const medicalAuthority = gradedSource(
    "https://www.nia.nih.gov/health/data",
    "medical-authority",
    `Per NIA: ${MEDICAL_CLAIM}.`, // class (a) contains the claim string
  );

  function ymylPiece(sources: ReturnType<typeof gradedSource>[]) {
    return pieceRow({
      isYmyl: true,
      body: `## Cognitive Health\n\n${MEDICAL_CLAIM} according to research.\n\n[cta:]\n`,
      briefSnapshot: { keyword: "cognitive decline", isYmyl: true, sources },
    });
  }

  it("junk-snippet-only (class c): medical claim is UNSOURCED — veto fires", async () => {
    const data = makeData({ loadPiece: vi.fn(async () => ymylPiece([junkSnippet])) });
    const res = await handleAudit(jsonRequest(okCtx), {
      data,
      resolveWorkspace: async () => workspace(WORKSPACE_A),
      runGate: faithfulnessGate(),
    });
    const body = await res.json();
    expect(body.failureCodes).toContain("VETO_UNSOURCED_STAT");
    expect(body.score).toBeNull();
  });

  it("attributionSources-only (class b): medical claim is UNSOURCED — veto fires", async () => {
    const data = makeData({ loadPiece: vi.fn(async () => ymylPiece([attributionSnippet])) });
    const res = await handleAudit(jsonRequest(okCtx), {
      data,
      resolveWorkspace: async () => workspace(WORKSPACE_A),
      runGate: faithfulnessGate(),
    });
    const body = await res.json();
    expect(body.failureCodes).toContain("VETO_UNSOURCED_STAT");
    expect(body.score).toBeNull();
  });

  it("class-(a) medical authority: same claim is SOURCED — veto does NOT fire", async () => {
    const data = makeData({ loadPiece: vi.fn(async () => ymylPiece([medicalAuthority])) });
    const res = await handleAudit(jsonRequest(okCtx), {
      data,
      resolveWorkspace: async () => workspace(WORKSPACE_A),
      runGate: faithfulnessGate(),
    });
    const body = await res.json();
    expect(body.failureCodes).not.toContain("VETO_UNSOURCED_STAT");
    expect(body.verdict).toBe("PUBLISH");
  });

  it("the gate only ever SEES class-(a) sources for a YMYL piece", async () => {
    const data = makeData({
      loadPiece: vi.fn(async () =>
        ymylPiece([junkSnippet, attributionSnippet, medicalAuthority]),
      ),
    });
    const { run, seen } = spyGate();
    await handleAudit(jsonRequest(okCtx), {
      data,
      resolveWorkspace: async () => workspace(WORKSPACE_A),
      runGate: run,
    });
    // criterion 6: class (b) + (c) are filtered OUT before grounding.
    expect(seen.brief?.sources.map((s) => s.url)).toEqual([
      "https://www.nia.nih.gov/health/data",
    ]);
  });

  it("non-YMYL piece: a class-(b) source still grounds (no medical floor)", async () => {
    const data = makeData({
      loadPiece: vi.fn(async () =>
        pieceRow({
          isYmyl: false,
          briefSnapshot: { keyword: "k", isYmyl: false, sources: [attributionSnippet] },
        }),
      ),
    });
    const { run, seen } = spyGate();
    await handleAudit(jsonRequest(okCtx), {
      data,
      resolveWorkspace: async () => workspace(WORKSPACE_A),
      runGate: run,
    });
    // Non-YMYL: all sources are available to ground client-specific facts.
    expect(seen.brief?.sources.map((s) => s.url)).toEqual([
      "https://myclinicblog.example/facts",
    ]);
  });
});

describe("audit — criterion 7: tenancy", () => {
  it("cross-tenant clientId (not owned by workspace) → 404", async () => {
    const data = makeData();
    const res = await handleAudit(
      jsonRequest({ workspaceId: WORKSPACE_A, clientId: CLIENT_B, pieceId: PIECE_A }),
      { data, resolveWorkspace: async () => workspace(WORKSPACE_A), runGate: spyGate().run },
    );
    expect(res.status).toBe(404);
  });

  it("request workspaceId mismatching the bound context → 403", async () => {
    const data = makeData();
    const res = await handleAudit(
      // Bound workspace is A, but the request claims B.
      jsonRequest({ workspaceId: WORKSPACE_B, clientId: CLIENT_A, pieceId: PIECE_A }),
      { data, resolveWorkspace: async () => workspace(WORKSPACE_A), runGate: spyGate().run },
    );
    expect(res.status).toBe(403);
  });

  it("unauthenticated (no workspace) → 401", async () => {
    const data = makeData();
    const res = await handleAudit(jsonRequest(okCtx), {
      data,
      resolveWorkspace: async () => null,
      runGate: spyGate().run,
    });
    expect(res.status).toBe(401);
  });
});
