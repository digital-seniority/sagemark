/**
 * resolve-data-access.test.ts — the content data-access DI composition
 * (DR-026 activation, creds-gated + safe-default).
 *
 * Proves:
 *   1. INERT BY DEFAULT — with the live factories returning null (no creds), the
 *      resolver returns the fail-closed NOT_WIRED default: EVERY method throws
 *      (non-vacuous — we actually call one and assert it throws). Zero live adapter.
 *   2. CREDS PRESENT (mocked) — the resolver returns the LIVE composed adapter: a
 *      route call resolves the live read + write methods (we assert a read + a write
 *      delegate to the mocked live impls, not the throw-stub).
 *   3. read-only view — the audit view exposes the three read methods only; with no
 *      creds they throw, with creds they delegate to the live read impl.
 *
 * The live adapter factories are mocked so there is no DB / network.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the live adapter factories + image-resolver the resolver composes.
const makeRead = vi.fn();
const makeWrite = vi.fn();
const makeResolveRefs = vi.fn();

vi.mock("@/lib/content/live-data-access", () => ({
  makeLiveContentReadAccess: () => makeRead(),
  makeLiveContentWriteAccess: () => makeWrite(),
}));
vi.mock("@/lib/content/image-resolver", () => ({
  makeLiveResolveReferencedAssets: () => makeResolveRefs(),
}));

import {
  resolveContentDataAccess,
  resolveReadOnlyDataAccess,
} from "@/lib/content/resolve-data-access";

beforeEach(() => {
  makeRead.mockReset();
  makeWrite.mockReset();
  makeResolveRefs.mockReset();
});

describe("resolveContentDataAccess: inert by default", () => {
  it("with no creds (factories null), returns the fail-closed NOT_WIRED default", async () => {
    makeRead.mockResolvedValue(null);
    makeWrite.mockResolvedValue(null);
    makeResolveRefs.mockResolvedValue(null);

    const data = await resolveContentDataAccess();
    // Non-vacuous: the default's methods throw loudly (DATA_ACCESS_NOT_WIRED). The
    // NOT_WIRED stubs throw SYNCHRONOUSLY (they are `() => { throw }`, not async).
    expect(() => data.loadPiece("p", "c")).toThrow(/not wired/i);
    expect(() =>
      data.insertDraftPiece({
        clientId: "c",
        slug: "s",
        title: "t",
        body: "b",
        isYmyl: false,
        authorId: null,
        faqData: null,
        briefSnapshot: null,
      }),
    ).toThrow(/not wired/i);
    // Zero live adapter was composed (write factory not even consulted past read).
    expect(makeWrite).not.toHaveBeenCalled();
  });

  it("read present but write null stays fully fail-closed (no read-only-writable surface)", async () => {
    makeRead.mockResolvedValue({ loadPiece: vi.fn() });
    makeWrite.mockResolvedValue(null);

    const data = await resolveContentDataAccess();
    expect(() => data.loadPiece("p", "c")).toThrow(/not wired/i);
  });
});

describe("resolveContentDataAccess: creds present (mocked) => live adapter", () => {
  it("composes the live read + write + image-resolver", async () => {
    const liveLoadPiece = vi.fn(async () => ({ id: "p1" }) as never);
    const liveTransition = vi.fn(async () => undefined);
    const liveResolveRefs = vi.fn(async () => []);

    makeRead.mockResolvedValue({ loadPiece: liveLoadPiece });
    makeWrite.mockResolvedValue({ transitionPieceStatus: liveTransition });
    makeResolveRefs.mockResolvedValue(liveResolveRefs);

    const data = await resolveContentDataAccess();

    await data.loadPiece("p", "c");
    expect(liveLoadPiece).toHaveBeenCalledWith("p", "c");

    await data.transitionPieceStatus("p", "c", "published");
    expect(liveTransition).toHaveBeenCalledWith("p", "c", "published");

    expect(data.resolveReferencedAssets).toBe(liveResolveRefs);

    // A method NOT supplied by a live adapter (deferred-migration) stays NOT_WIRED
    // (the stub throws synchronously).
    expect(() =>
      data.nameVersion({ pieceId: "p", clientId: "c", version: 1, name: "x" }),
    ).toThrow(/not wired/i);
  });
});

describe("resolveReadOnlyDataAccess: structurally read-only", () => {
  it("with no creds, the three read methods throw (fail-closed)", async () => {
    makeRead.mockResolvedValue(null);
    const view = await resolveReadOnlyDataAccess();
    expect(() => view.loadPiece("p", "c")).toThrow(/not wired/i);
    // Structurally: no write method is exposed on the view (compile-time Pick<>).
    expect((view as Record<string, unknown>).insertDraftPiece).toBeUndefined();
    expect((view as Record<string, unknown>).transitionPieceStatus).toBeUndefined();
  });

  it("with creds, delegates the three read methods to the live read impl", async () => {
    const liveLoadPiece = vi.fn(async () => null);
    makeRead.mockResolvedValue({
      clientBelongsToWorkspace: vi.fn(),
      getApprovedVoiceSpec: vi.fn(),
      loadPiece: liveLoadPiece,
    });
    const view = await resolveReadOnlyDataAccess();
    await view.loadPiece("p", "c");
    expect(liveLoadPiece).toHaveBeenCalledWith("p", "c");
  });
});
