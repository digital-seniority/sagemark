/**
 * /api/revise — the DIRECT in-place operator edit's guards + invariants (Slice 3).
 *
 * The sibling of /api/edit: the operator typed the full new body and saves it (no
 * model). Proves, with NO DB and NO provider key (injected seams):
 *
 *   - happy path: the new body is re-gated and appended at version+1 (append-only);
 *   - the gate re-runs on the SUBMITTED body (a faithfulness break is caught + its
 *     regressed verdict is what gets persisted — no banking a stale PUBLISH);
 *   - guards: draft-status -> 409, per-tenant rate-limit -> 429, no-version -> 409,
 *     cross-tenant client -> 404;
 *   - the OPTIONAL stale-edit guard: a mismatching baseVersionHash -> 409; omitting
 *     it is last-write-wins (200);
 *   - NO publish bypass: status is never transitioned.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleRevise, inProcessRateLimiter } from "@/app/api/revise/route";
import type { ReviseDeps, GateRunner } from "@/app/api/revise/route";
import {
  makeData,
  workspace,
  pieceRow,
  pieceVersion,
  jsonRequest,
  WORKSPACE_A,
  CLIENT_A,
  CLIENT_B,
  PIECE_A,
} from "../content/fixtures";
import { hashBody } from "@/lib/edit/constrained-edit-contract";
import type { AuditResult } from "@sagemark/core";

const CURRENT_BODY = "# Memory care\n\nOur community starts at $5,000 a month.\n";
const CURRENT_HASH = hashBody(CURRENT_BODY);
const EDITED_BODY = "# Memory care\n\nOur community begins around $5,000 monthly — tour to see for yourself.\n";

const currentVersion = () => pieceVersion({ version: 3, body: CURRENT_BODY, verdict: "REVIEW" });

const passGate: GateRunner = vi.fn(
  async (): Promise<AuditResult> => ({
    verdict: "PUBLISH",
    score: 90,
    dimensions: [{ name: "faithfulness", score: 95, weight: 0.2 }],
    failureCodes: [],
    stageAClean: true,
  }),
);

const faithfulnessBreakGate: GateRunner = vi.fn(
  async (): Promise<AuditResult> => ({
    verdict: "REVISE",
    score: null,
    dimensions: [],
    failureCodes: ["VETO_UNSOURCED_STAT" as never],
    stageAClean: false,
  }),
);

beforeEach(() => {
  vi.clearAllMocks();
});

function deps(over: Partial<ReviseDeps> = {}): ReviseDeps {
  return {
    data: makeData({ loadLatestVersion: vi.fn(async () => currentVersion()) }),
    resolveWorkspace: async () => workspace(WORKSPACE_A),
    runGate: passGate,
    rateLimiter: inProcessRateLimiter({ max: 100, windowMs: 60_000 }),
    ...over,
  };
}

function reviseBody(over: Record<string, unknown> = {}) {
  return { clientId: CLIENT_A, pieceId: PIECE_A, body: EDITED_BODY, ...over };
}

describe("revise — happy path (direct edit -> re-gate -> appended version)", () => {
  it("re-gates the submitted body and appends a new version at v+1", async () => {
    const d = deps();
    const res = await handleRevise(jsonRequest(reviseBody()), d);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.version).toBe(4); // base 3 + 1, append-only
    expect(out.verdict).toBe("PUBLISH");
    expect(out.newHash).toBe(hashBody(EDITED_BODY));
    expect(passGate).toHaveBeenCalledTimes(1);
    expect((d.data as ReturnType<typeof makeData>).writes.insertPieceVersion).toBe(1);
    expect((d.data as ReturnType<typeof makeData>).writes.transitionPieceStatus).toBe(0);
  });

  it("the gate re-runs on the SUBMITTED body (not the persisted one)", async () => {
    const seen = vi.fn();
    const captureGate: GateRunner = vi.fn(async (draft) => {
      seen(draft.body);
      return { verdict: "REVIEW", score: 75, dimensions: [], failureCodes: [], stageAClean: true };
    });
    await handleRevise(jsonRequest(reviseBody()), deps({ runGate: captureGate }));
    expect(seen.mock.calls[0]![0]).toBe(EDITED_BODY);
  });

  it("last-write-wins: omitting baseVersionHash still saves (200)", async () => {
    const res = await handleRevise(jsonRequest(reviseBody()), deps());
    expect(res.status).toBe(200);
  });

  it("with a matching baseVersionHash, the edit applies (200)", async () => {
    const res = await handleRevise(jsonRequest(reviseBody({ baseVersionHash: CURRENT_HASH })), deps());
    expect(res.status).toBe(200);
  });
});

describe("revise — guards", () => {
  it("STALE-EDIT: a mismatching baseVersionHash -> 409, no write", async () => {
    const d = deps();
    const res = await handleRevise(
      jsonRequest(reviseBody({ baseVersionHash: hashBody("a different body") })),
      d,
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("stale-edit");
    expect((d.data as ReturnType<typeof makeData>).writes.insertPieceVersion).toBe(0);
  });

  it("RATE-LIMIT: over the per-tenant window -> 429, no write", async () => {
    const limiter = inProcessRateLimiter({ max: 1, windowMs: 60_000 });
    const d = deps({ rateLimiter: limiter });
    expect((await handleRevise(jsonRequest(reviseBody()), d)).status).toBe(200);
    const second = await handleRevise(jsonRequest(reviseBody()), d);
    expect(second.status).toBe(429);
    expect((await second.json()).code).toBe("rate-limited");
    expect((d.data as ReturnType<typeof makeData>).writes.insertPieceVersion).toBe(1);
  });

  it("cross-tenant clientId not owned by the workspace -> 404", async () => {
    const res = await handleRevise(jsonRequest(reviseBody({ clientId: CLIENT_B })), deps());
    expect(res.status).toBe(404);
  });

  it("no version snapshot yet -> 409 no-version", async () => {
    const d = deps({ data: makeData({ loadLatestVersion: vi.fn(async () => null) }) });
    const res = await handleRevise(jsonRequest(reviseBody()), d);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("no-version");
  });

  for (const status of ["review", "approved", "published", "archived"] as const) {
    it(`a ${status.toUpperCase()} piece -> 409 piece-not-editable; NO gate, NO write`, async () => {
      const d = deps({
        data: makeData({
          loadPiece: vi.fn(async () => pieceRow({ status })),
          loadLatestVersion: vi.fn(async () => currentVersion()),
        }),
      });
      const res = await handleRevise(jsonRequest(reviseBody()), d);
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("piece-not-editable");
      expect(passGate).not.toHaveBeenCalled();
      expect((d.data as ReturnType<typeof makeData>).writes.insertPieceVersion).toBe(0);
    });
  }
});

describe("revise — the FULL gate re-runs and CATCHES a faithfulness break", () => {
  it("an edit that breaks faithfulness persists its REGRESSED verdict (no stale PUBLISH)", async () => {
    const d = deps({ runGate: faithfulnessBreakGate });
    const insertSpy = (d.data as ReturnType<typeof makeData>).insertPieceVersion as ReturnType<typeof vi.fn>;
    const res = await handleRevise(jsonRequest(reviseBody()), d);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.verdict).toBe("REVISE");
    expect(out.stageAClean).toBe(false);
    const written = insertSpy.mock.calls[0]![0] as { verdict: string; dimensions: unknown };
    expect(written.verdict).toBe("REVISE");
    expect(written.dimensions).toBeNull();
    expect((d.data as ReturnType<typeof makeData>).writes.transitionPieceStatus).toBe(0);
  });
});
