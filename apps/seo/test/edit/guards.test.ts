/**
 * /api/edit — the bounded conversational edit's guards + invariants (PR 012 /
 * P1.U.3). Proves, with NO DB and NO provider key (injected seams):
 *
 *   - the THREE guards: stale-edit -> 409, per-tenant rate-limit -> 429,
 *     workspace-ownership -> 403 (request tenancy never trusted);
 *   - the edit is BOUNDED, not a free rewrite: only the addressed region changes;
 *     an oversized replacement is rejected (422);
 *   - the FULL gate RE-RUNS on the edited body: a faithfulness-breaking edit is
 *     CAUGHT (its verdict regresses and that regressed verdict is persisted);
 *   - append-only versioning: a NEW content_piece_versions row at version+1, never
 *     a mutation of a prior version;
 *   - NO publish bypass: an edit never transitions status / publishes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleEdit, inProcessRateLimiter } from "@/app/api/edit/route";
import type { EditDeps, EditModel, GateRunner } from "@/app/api/edit/route";
import {
  makeData,
  workspace,
  pieceRow,
  pieceVersion,
  jsonRequest,
  WORKSPACE_A,
  WORKSPACE_B,
  CLIENT_A,
  CLIENT_B,
  PIECE_A,
} from "../content/fixtures";
import {
  hashBody,
  type BoundedDiff,
} from "@/lib/edit/constrained-edit-contract";
import type { AuditResult, GateBrief } from "@sagemark/core";

// ── The current persisted version body the edit is based on ───────────────────
// The edit reads the CURRENT body from loadLatestVersion (NOT the piece row).
const CURRENT_BODY = "## Costs\n\nOur memory care starts at $5,000 a month.\n";
const CURRENT_HASH = hashBody(CURRENT_BODY);

const currentVersion = () =>
  pieceVersion({ version: 3, body: CURRENT_BODY, verdict: "REVIEW" });

/** A bounded diff that rewrites ONLY the Costs section, within bounds. */
const boundedDiff: BoundedDiff = {
  replacement: "## Costs\n\nOur memory care begins around $5,000 monthly.\n",
  summary: "Softened the cost phrasing in the Costs section.",
};

/** A model stub that returns the bounded diff (deterministic; no provider key). */
const stubModel: EditModel = vi.fn(async () => boundedDiff);

/** A PASS gate: Stage-A clean, PUBLISH band. */
const passGate: GateRunner = vi.fn(
  async (): Promise<AuditResult> => ({
    verdict: "PUBLISH",
    score: 90,
    dimensions: [{ name: "faithfulness", score: 95, weight: 0.2 }],
    failureCodes: [],
    stageAClean: true,
  }),
);

/** A faithfulness-break gate: the edit introduced an unsourced stat -> Stage-A veto. */
const faithfulnessBreakGate: GateRunner = vi.fn(
  async (): Promise<AuditResult> => ({
    verdict: "REVISE",
    score: null,
    dimensions: [],
    failureCodes: ["VETO_UNSOURCED_STAT" as never],
    stageAClean: false,
  }),
);

// Clear call history between tests (the module-level vi.fn stubs keep their
// implementations; only `.mock.calls` is reset) so `not.toHaveBeenCalled`
// assertions reflect THIS test, not an earlier one.
beforeEach(() => {
  vi.clearAllMocks();
});

function deps(over: Partial<EditDeps> = {}): EditDeps {
  return {
    data: makeData({ loadLatestVersion: vi.fn(async () => currentVersion()) }),
    resolveWorkspace: async () => workspace(WORKSPACE_A),
    editModel: stubModel,
    runGate: passGate,
    rateLimiter: inProcessRateLimiter({ max: 100, windowMs: 60_000 }),
    ...over,
  };
}

function editBody(over: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE_A,
    clientId: CLIENT_A,
    pieceId: PIECE_A,
    region: { kind: "section", heading: "Costs" },
    instruction: "Soften the cost claim.",
    baseVersionHash: CURRENT_HASH,
    ...over,
  };
}

describe("edit — the happy path (Slice-1 close: bounded edit -> re-gate -> gated version)", () => {
  it("applies a bounded edit, re-runs the full gate, appends a new version", async () => {
    const d = deps();
    const res = await handleEdit(jsonRequest(editBody()), d);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.version).toBe(4); // base 3 + 1, append-only
    expect(out.verdict).toBe("PUBLISH");
    expect(out.summary).toBe(boundedDiff.summary);
    // The FULL gate ran on the edited body.
    expect(passGate).toHaveBeenCalledTimes(1);
    // Exactly ONE append-only version write; no status transition (no publish).
    expect((d.data as ReturnType<typeof makeData>).writes.insertPieceVersion).toBe(1);
    expect((d.data as ReturnType<typeof makeData>).writes.transitionPieceStatus).toBe(0);
  });

  it("the gate re-runs on the EDITED body (not the original)", async () => {
    const seenBody = vi.fn();
    const captureGate: GateRunner = vi.fn(async (draft) => {
      seenBody(draft.body);
      return {
        verdict: "REVIEW",
        score: 75,
        dimensions: [],
        failureCodes: [],
        stageAClean: true,
      };
    });
    await handleEdit(jsonRequest(editBody()), deps({ runGate: captureGate }));
    // The body the gate saw is the SPLICED body — the replacement is present and
    // the original cost phrasing is gone.
    const body = seenBody.mock.calls[0]![0] as string;
    expect(body).toContain("begins around $5,000 monthly");
    expect(body).not.toContain("starts at $5,000 a month");
  });
});

describe("edit — the THREE guards", () => {
  it("STALE-EDIT: a baseVersionHash that does not match the current body -> 409, no write", async () => {
    const d = deps();
    const res = await handleEdit(
      jsonRequest(editBody({ baseVersionHash: hashBody("a totally different body") })),
      d,
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("stale-edit");
    expect((d.data as ReturnType<typeof makeData>).writes.insertPieceVersion).toBe(0);
    // The model is NEVER called on a stale edit (no spend before the guard).
    expect(stubModel).not.toHaveBeenCalled();
  });

  it("RATE-LIMIT: over the per-tenant window -> 429, no write", async () => {
    // A limiter that allows exactly one take.
    const limiter = inProcessRateLimiter({ max: 1, windowMs: 60_000 });
    const d = deps({ rateLimiter: limiter });
    const first = await handleEdit(jsonRequest(editBody()), d);
    expect(first.status).toBe(200);
    const second = await handleEdit(jsonRequest(editBody({ baseVersionHash: hashBody(CURRENT_BODY) })), d);
    expect(second.status).toBe(429);
    expect((await second.json()).code).toBe("rate-limited");
    // Only the first edit wrote a version.
    expect((d.data as ReturnType<typeof makeData>).writes.insertPieceVersion).toBe(1);
  });

  it("WORKSPACE-OWNERSHIP: a request workspace mismatching the bound context -> 403, no write", async () => {
    const d = deps();
    const res = await handleEdit(
      jsonRequest(editBody({ workspaceId: WORKSPACE_B })),
      d,
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("tenancy-mismatch");
    expect((d.data as ReturnType<typeof makeData>).writes.insertPieceVersion).toBe(0);
  });

  it("WORKSPACE-OWNERSHIP: a cross-tenant clientId not owned by the workspace -> 404", async () => {
    const d = deps();
    const res = await handleEdit(jsonRequest(editBody({ clientId: CLIENT_B })), d);
    // CLIENT_B is not owned by WORKSPACE_A -> bind fails 404 (no existence leak).
    expect(res.status).toBe(404);
    expect((d.data as ReturnType<typeof makeData>).writes.insertPieceVersion).toBe(0);
  });

  it("rate-limit is keyed per tenant — a different tenant is not throttled", async () => {
    const limiter = inProcessRateLimiter({ max: 1, windowMs: 60_000 });
    // Tenant A exhausts its window.
    const dataA = makeData({ loadLatestVersion: vi.fn(async () => currentVersion()) });
    await handleEdit(jsonRequest(editBody()), {
      ...deps({ rateLimiter: limiter, data: dataA }),
    });
    const blocked = await handleEdit(jsonRequest(editBody({ baseVersionHash: CURRENT_HASH })), {
      ...deps({ rateLimiter: limiter, data: dataA }),
    });
    expect(blocked.status).toBe(429);
    // Tenant B (different workspace+client) still has its own budget. We point the
    // ownership map at B by resolving WORKSPACE_B and owning CLIENT_B there.
    const dataB = makeData({
      clientBelongsToWorkspace: vi.fn(async (c: string, w: string) => c === CLIENT_B && w === WORKSPACE_B),
      loadLatestVersion: vi.fn(async () => currentVersion()),
      loadPiece: vi.fn(async () => pieceRow({ clientId: CLIENT_B })),
    });
    const okForB = await handleEdit(
      jsonRequest(editBody({ workspaceId: WORKSPACE_B, clientId: CLIENT_B })),
      {
        ...deps({ rateLimiter: limiter, data: dataB }),
        resolveWorkspace: async () => workspace(WORKSPACE_B),
      },
    );
    expect(okForB.status).toBe(200);
  });
});

describe("edit — bounded, not a free rewrite", () => {
  it("only the addressed region changes; the rest of the body is byte-identical", async () => {
    const multiSection =
      "## Intro\n\nWelcome to our community.\n\n## Costs\n\nOur memory care starts at $5,000 a month.\n\n## Hours\n\nWe are open daily.\n";
    const d = deps({
      data: makeData({
        loadLatestVersion: vi.fn(async () =>
          pieceVersion({ version: 1, body: multiSection }),
        ),
      }),
    });
    const captured = vi.fn();
    const gate: GateRunner = vi.fn(async (draft) => {
      captured(draft.body);
      return { verdict: "REVIEW", score: 75, dimensions: [], failureCodes: [], stageAClean: true };
    });
    const res = await handleEdit(
      jsonRequest(editBody({ baseVersionHash: hashBody(multiSection) })),
      { ...d, runGate: gate },
    );
    expect(res.status).toBe(200);
    const newBody = captured.mock.calls[0]![0] as string;
    // Intro + Hours sections are untouched; only Costs changed.
    expect(newBody).toContain("## Intro\n\nWelcome to our community.");
    expect(newBody).toContain("## Hours\n\nWe are open daily.");
    expect(newBody).toContain("begins around $5,000 monthly");
  });

  it("rejects an oversized replacement (a free rewrite) -> 422, no write", async () => {
    const hugeModel: EditModel = vi.fn(async () => ({
      // A 5,000-char "article" smuggled into a ~45-char region replacement.
      replacement: "x".repeat(5000),
      summary: "tried to rewrite the whole thing",
    }));
    const d = deps({ editModel: hugeModel });
    const res = await handleEdit(jsonRequest(editBody()), d);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("edit-bound-exceeded");
    expect((d.data as ReturnType<typeof makeData>).writes.insertPieceVersion).toBe(0);
  });

  it("rejects an edit addressing a region that does not exist -> 422, model never called", async () => {
    const d = deps();
    const res = await handleEdit(
      jsonRequest(editBody({ region: { kind: "section", heading: "Nonexistent" } })),
      d,
    );
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("region-not-found");
    expect(stubModel).not.toHaveBeenCalled();
    expect((d.data as ReturnType<typeof makeData>).writes.insertPieceVersion).toBe(0);
  });
});

describe("edit — the FULL gate re-runs and CATCHES a faithfulness break", () => {
  it("an edit that breaks faithfulness gets a regressed verdict, and THAT verdict is persisted", async () => {
    const d = deps({ runGate: faithfulnessBreakGate });
    const insertSpy = (d.data as ReturnType<typeof makeData>).insertPieceVersion as ReturnType<typeof vi.fn>;
    const res = await handleEdit(jsonRequest(editBody()), d);
    // The edit is still WRITTEN (append-only) but it carries the REGRESSED verdict —
    // the gate caught the break; the edit cannot bank a stale PUBLISH.
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.verdict).toBe("REVISE");
    expect(out.stageAClean).toBe(false);
    expect(faithfulnessBreakGate).toHaveBeenCalledTimes(1);
    // The persisted version row carries the regressed verdict + null dimensions.
    const written = insertSpy.mock.calls[0]![0] as { verdict: string; dimensions: unknown };
    expect(written.verdict).toBe("REVISE");
    expect(written.dimensions).toBeNull();
    // NO publish bypass — status was never transitioned.
    expect((d.data as ReturnType<typeof makeData>).writes.transitionPieceStatus).toBe(0);
  });
});

describe("edit — append-only versioning never mutates a prior version", () => {
  it("the new row is at baseVersion + 1 and the write goes through insertPieceVersion only", async () => {
    const d = deps({
      data: makeData({ loadLatestVersion: vi.fn(async () => currentVersion()) }),
    });
    const insertSpy = (d.data as ReturnType<typeof makeData>).insertPieceVersion as ReturnType<typeof vi.fn>;
    await handleEdit(jsonRequest(editBody()), d);
    const written = insertSpy.mock.calls[0]![0] as { version: number; pieceId: string };
    expect(written.version).toBe(4); // base 3 + 1
    expect(written.pieceId).toBe(PIECE_A);
    // The only mutation was the append; no draft insert, no status transition.
    const w = (d.data as ReturnType<typeof makeData>).writes;
    expect(w.insertPieceVersion).toBe(1);
    expect(w.insertDraftPiece).toBe(0);
    expect(w.transitionPieceStatus).toBe(0);
  });

  it("a piece with no version snapshot yet -> 409 no-version (nothing fabricated)", async () => {
    const d = deps({
      data: makeData({ loadLatestVersion: vi.fn(async () => null) }),
    });
    const res = await handleEdit(jsonRequest(editBody()), d);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("no-version");
  });
});

describe("edit — the DRAFT-STATUS guard (only a draft piece is editable)", () => {
  // A draft piece passes the guard (the happy path already proves the 200; this
  // re-asserts it explicitly against the guard's contract).
  it("a DRAFT piece is editable — passes the guard, applies the edit (200)", async () => {
    const d = deps({
      data: makeData({
        loadPiece: vi.fn(async () => pieceRow({ status: "draft" })),
        loadLatestVersion: vi.fn(async () => currentVersion()),
      }),
    });
    const res = await handleEdit(jsonRequest(editBody()), d);
    expect(res.status).toBe(200);
    expect((d.data as ReturnType<typeof makeData>).writes.insertPieceVersion).toBe(1);
  });

  // A non-draft piece is FROZEN -> 409 piece-not-editable, with NO spend and NO write.
  for (const status of ["review", "approved", "published", "archived"] as const) {
    it(`a ${status.toUpperCase()} piece -> 409 piece-not-editable; NO model spend, NO version write`, async () => {
      const d = deps({
        data: makeData({
          loadPiece: vi.fn(async () => pieceRow({ status })),
          loadLatestVersion: vi.fn(async () => currentVersion()),
        }),
      });
      const res = await handleEdit(jsonRequest(editBody()), d);
      expect(res.status).toBe(409);
      const out = await res.json();
      expect(out.code).toBe("piece-not-editable");
      // The actual (frozen) status is echoed back so the caller can render it.
      expect(out.status).toBe(status);
      // The model is NEVER called and NO version row is written.
      expect(stubModel).not.toHaveBeenCalled();
      expect(passGate).not.toHaveBeenCalled();
      expect((d.data as ReturnType<typeof makeData>).writes.insertPieceVersion).toBe(0);
      expect((d.data as ReturnType<typeof makeData>).writes.transitionPieceStatus).toBe(0);
    });
  }

  // The guard runs BEFORE the rate-limit take(): a 409 on a frozen piece must NOT
  // consume the tenant's rate budget (DR-030: cheap fail-closed guards ahead of take()).
  it("a non-draft 409 does NOT consume the rate-limit token (guard ordered before take())", async () => {
    // A limiter that allows EXACTLY one take in the window.
    const limiter = inProcessRateLimiter({ max: 1, windowMs: 60_000 });
    // First: a published piece -> 409. If the guard ran AFTER take(), this would
    // have burned the single token.
    const frozen = deps({
      rateLimiter: limiter,
      data: makeData({
        loadPiece: vi.fn(async () => pieceRow({ status: "published" })),
        loadLatestVersion: vi.fn(async () => currentVersion()),
      }),
    });
    const firstRes = await handleEdit(jsonRequest(editBody()), frozen);
    expect(firstRes.status).toBe(409);
    expect((await firstRes.json()).code).toBe("piece-not-editable");

    // Then: a DRAFT edit on the SAME limiter still has its token — proving the 409
    // above did not consume budget. A 429 here would mean the guard ran too late.
    const draft = deps({
      rateLimiter: limiter,
      data: makeData({
        loadPiece: vi.fn(async () => pieceRow({ status: "draft" })),
        loadLatestVersion: vi.fn(async () => currentVersion()),
      }),
    });
    const secondRes = await handleEdit(jsonRequest(editBody()), draft);
    expect(secondRes.status).toBe(200);
    expect((draft.data as ReturnType<typeof makeData>).writes.insertPieceVersion).toBe(1);
  });
});

// Keep the GateBrief import meaningful (the model receives sources of this shape).
void (null as unknown as GateBrief);
