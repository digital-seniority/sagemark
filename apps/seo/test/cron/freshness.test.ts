/**
 * Tier-1 freshness-cron tests (PR 021 / P1.C.4) — fully mocked.
 *
 * Proves: SOM_LIVE-unset ⇒ the run is skipped (zero scans / drafts); a stale
 * published piece emits a refresh DRAFT and NEVER a publish (no publish seam
 * exists in the path — structurally impossible); a fresh piece is left alone; a
 * per-piece error is logged + heartbeated, not fatal; staleness logic.
 *
 * Runner: vitest (node env) — globbed via `test/cron/**` in vitest.config.ts.
 */

import { describe, expect, it, vi } from "vitest";

import {
  runFreshnessScan,
  isStale,
  NOT_WIRED_FRESHNESS_SEAMS,
  FreshnessSeamsNotWiredError,
  DEFAULT_STALENESS_DAYS,
  type FreshnessSeams,
  type PublishedPieceForFreshness,
  type RefreshDraftRequest,
  type FreshnessTarget,
} from "@/cron/freshness-scan";

const TARGET: FreshnessTarget = { workspaceId: "ws-1", clientId: "client-1" };
const NOW = Date.parse("2026-06-26T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

/** A recording seams impl: tracks listed reads + emitted drafts. There is no
 *  publish method to spy on — its ABSENCE is the no-auto-publish proof. */
class RecordingSeams implements FreshnessSeams {
  readonly drafts: RefreshDraftRequest[] = [];
  constructor(private readonly published: PublishedPieceForFreshness[]) {}
  listPublished(): Promise<PublishedPieceForFreshness[]> {
    return Promise.resolve(this.published);
  }
  emitDraft(req: RefreshDraftRequest): Promise<void> {
    this.drafts.push(req);
    return Promise.resolve();
  }
}

describe("INERT: SOM_LIVE unset ⇒ no scan, no draft", () => {
  it("skips entirely with SOM_LIVE unset", async () => {
    const seams = new RecordingSeams([
      { pieceId: "p1", slug: "a", updatedAt: "2000-01-01T00:00:00Z" },
    ]);
    const listSpy = vi.spyOn(seams, "listPublished");
    const result = await runFreshnessScan([TARGET], {
      seams,
      env: {} as NodeJS.ProcessEnv,
      now: () => NOW,
    });
    expect(result.skipped).toBe(true);
    expect(result.scanned).toBe(0);
    expect(result.draftsEmitted).toBe(0);
    expect(listSpy).not.toHaveBeenCalled();
    expect(seams.drafts).toHaveLength(0);
  });
});

describe("staleness logic", () => {
  it("a piece older than the threshold is stale", () => {
    expect(
      isStale({ pieceId: "p", slug: "s", updatedAt: new Date(NOW - 200 * DAY).toISOString() }, NOW, DEFAULT_STALENESS_DAYS),
    ).toBe(true);
  });
  it("a recently-updated piece is fresh", () => {
    expect(
      isStale({ pieceId: "p", slug: "s", updatedAt: new Date(NOW - 10 * DAY).toISOString() }, NOW, DEFAULT_STALENESS_DAYS),
    ).toBe(false);
  });
  it("a piece with no/unparseable updatedAt is treated as stale (conservative)", () => {
    expect(isStale({ pieceId: "p", slug: "s", updatedAt: null }, NOW, DEFAULT_STALENESS_DAYS)).toBe(true);
    expect(isStale({ pieceId: "p", slug: "s", updatedAt: "not-a-date" }, NOW, DEFAULT_STALENESS_DAYS)).toBe(true);
  });
});

describe("NO-AUTO-PUBLISH: stale ⇒ DRAFT only", () => {
  it("emits a refresh draft for a stale piece, leaves fresh pieces alone", async () => {
    const seams = new RecordingSeams([
      { pieceId: "stale-1", slug: "old", updatedAt: new Date(NOW - 300 * DAY).toISOString() },
      { pieceId: "fresh-1", slug: "new", updatedAt: new Date(NOW - 5 * DAY).toISOString() },
    ]);
    const result = await runFreshnessScan([TARGET], {
      seams,
      env: { SOM_LIVE: "1" } as NodeJS.ProcessEnv,
      now: () => NOW,
    });

    expect(result.skipped).toBe(false);
    expect(result.scanned).toBe(2);
    expect(result.draftsEmitted).toBe(1);
    expect(seams.drafts).toHaveLength(1);
    const draft = seams.drafts[0];
    // The draft carries the BOUND tenancy + the stale piece id + a reason.
    expect(draft.workspaceId).toBe("ws-1");
    expect(draft.clientId).toBe("client-1");
    expect(draft.pieceId).toBe("stale-1");
    expect(draft.reason).toContain("stale");
  });

  it("the seams interface exposes NO publish method (no auto-publish possible)", () => {
    // Structural proof: emitDraft is the only mutation. A publish call site does
    // not exist — the type carries no such method.
    const keys = Object.keys(NOT_WIRED_FRESHNESS_SEAMS);
    expect(keys).toContain("emitDraft");
    expect(keys).not.toContain("publish");
    expect(keys).not.toContain("setStatus");
  });
});

describe("resilience", () => {
  it("a listPublished error is logged + heartbeated, not fatal", async () => {
    const seams: FreshnessSeams = {
      listPublished: vi.fn(async () => {
        throw new Error("read failed");
      }),
      emitDraft: vi.fn(),
    };
    const result = await runFreshnessScan([TARGET], {
      seams,
      env: { SOM_LIVE: "1" } as NodeJS.ProcessEnv,
      now: () => NOW,
    });
    expect(result.errors).toBe(1);
    expect(result.draftsEmitted).toBe(0);
    expect(result.heartbeats.some((h) => h.note.includes("error"))).toBe(true);
  });

  it("an emitDraft error is logged, scan continues to the next piece", async () => {
    const seams: FreshnessSeams = {
      listPublished: async () => [
        { pieceId: "p1", slug: "a", updatedAt: null },
        { pieceId: "p2", slug: "b", updatedAt: null },
      ],
      emitDraft: vi
        .fn<FreshnessSeams["emitDraft"]>()
        .mockRejectedValueOnce(new Error("write failed"))
        .mockResolvedValueOnce(undefined),
    };
    const result = await runFreshnessScan([TARGET], {
      seams,
      env: { SOM_LIVE: "1" } as NodeJS.ProcessEnv,
      now: () => NOW,
    });
    expect(result.scanned).toBe(2);
    expect(result.draftsEmitted).toBe(1);
    expect(result.errors).toBe(1);
  });
});

describe("NOT_WIRED freshness seams", () => {
  it("throw if reached live", () => {
    expect(() => NOT_WIRED_FRESHNESS_SEAMS.listPublished("w", "c")).toThrow(
      FreshnessSeamsNotWiredError,
    );
    expect(() =>
      NOT_WIRED_FRESHNESS_SEAMS.emitDraft({} as RefreshDraftRequest),
    ).toThrow(FreshnessSeamsNotWiredError);
  });
});
