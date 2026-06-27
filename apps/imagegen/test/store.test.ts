/**
 * store.test.ts — the Stage-1 store seams (`imagegen/1`).
 *
 * The in-memory store (dry-run/tests) + the fail-closed NOT_WIRED production
 * store (fails LOUD until Stage-2 Supabase lands).
 */
import { describe, it, expect } from "vitest";
import {
  makeInMemoryImageStore,
  makeNotWiredImageStore,
  StoreNotWiredError,
} from "../src/engine/store";
import { makeGeneratedLicense } from "../src/engine/assets";

describe("imagegen/1 — in-memory store", () => {
  it("inserts + finds an asset by content hash within a workspace", async () => {
    const store = makeInMemoryImageStore();
    const license = makeGeneratedLicense({ model: "bfl/flux-2-flex@flux-2-flex" });
    const asset = await store.insertAsset({
      workspaceId: "ws-1",
      source: "generated",
      storageKey: "ws-1/generated/abc.png",
      contentHash: "abc",
      bytes: 5,
      license,
      tags: ["generated"],
    });
    expect(asset.id).toBe("asset-1");
    const found = await store.findAssetByHash({
      workspaceId: "ws-1",
      contentHash: "abc",
    });
    expect(found?.id).toBe("asset-1");
    // Different workspace → not found (tenancy isolation in the fake).
    expect(
      await store.findAssetByHash({ workspaceId: "ws-2", contentHash: "abc" }),
    ).toBeNull();
  });
});

describe("imagegen/1 — NOT_WIRED store (fail-closed Stage-1 seam)", () => {
  it("throws StoreNotWiredError on every method (never silently no-ops)", async () => {
    const store = makeNotWiredImageStore();
    await expect(
      store.upload({ bucket: "b", key: "k", bytes: new Uint8Array(), contentType: "image/png" }),
    ).rejects.toThrow(StoreNotWiredError);
    await expect(
      store.findAssetByHash({ workspaceId: "ws", contentHash: "h" }),
    ).rejects.toThrow(StoreNotWiredError);
    await expect(
      store.insertAsset({
        workspaceId: "ws",
        source: "generated",
        storageKey: "k",
        contentHash: "h",
        bytes: 1,
        license: makeGeneratedLicense({ model: "m@v" }),
        tags: [],
      }),
    ).rejects.toThrow(StoreNotWiredError);
  });

  it("carries a 501 status code on the error", async () => {
    const store = makeNotWiredImageStore();
    try {
      await store.upload({ bucket: "b", key: "k", bytes: new Uint8Array(), contentType: "image/png" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(StoreNotWiredError);
      expect((err as StoreNotWiredError).statusCode).toBe(501);
    }
  });
});
