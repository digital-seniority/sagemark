/**
 * persist.test.ts — persist + URL resolution (`imagegen/1`).
 *
 * Uses the in-memory store + fake signUrl — no live Supabase, no spend.
 */
import { describe, it, expect, vi } from "vitest";
import {
  persistGeneratedImage,
  resolveGeneratedAssetUrl,
  contentHashOf,
  generatedStorageKey,
  deriveProvenanceFlags,
  GENERATED_IMAGE_BUCKET,
} from "../src/engine/persist";
import { makeInMemoryImageStore } from "../src/engine/store";
import type { GeneratedImage } from "../src/engine/generate";
import {
  CanonicalImageSpecSchema,
  IMAGE_SPEC_VERSION,
} from "../src/engine/spec";

function spec() {
  return CanonicalImageSpecSchema.parse({
    schemaVersion: IMAGE_SPEC_VERSION,
    job: "hero",
    subject: "blue gradient",
    style: "abstract-gradient",
    aspectRatio: "16:9",
  });
}

function generated(): GeneratedImage {
  return {
    bytes: new Uint8Array([1, 2, 3, 4, 5]),
    contentType: "image/png",
    seedUsed: 7,
    costReported: 5,
    providerMetadata: { blackForestLabs: { images: [{ cost: 5 }] } },
    modelId: "bfl/flux-2-flex",
    modelVersion: "flux-2-flex",
  };
}

describe("imagegen/1 — content hash + key", () => {
  it("contentHashOf is deterministic", () => {
    expect(contentHashOf(new Uint8Array([1, 2, 3]))).toBe(
      contentHashOf(new Uint8Array([1, 2, 3])),
    );
  });
  it("generatedStorageKey is workspace-prefixed under generated/", () => {
    const key = generatedStorageKey({
      workspaceId: "ws-1",
      contentHash: "abc",
      contentType: "image/png",
    });
    expect(key).toBe("ws-1/generated/abc.png");
  });
});

describe("imagegen/1 — persistGeneratedImage", () => {
  it("uploads to the SEO bucket, inserts an asset, writes a provenance + license record", async () => {
    const store = makeInMemoryImageStore();
    const { asset, license, contentHash } = await persistGeneratedImage({
      store,
      workspaceId: "ws-1",
      clientId: "client-1",
      slug: "memory-care",
      spec: spec(),
      promptHash: "ph-1",
      generated: generated(),
      costCredits: 1,
    });
    expect(store.uploads.length).toBe(1);
    expect(store.uploads[0]!.bucket).toBe(GENERATED_IMAGE_BUCKET);
    expect(store.assets.length).toBe(1);
    expect(store.records.length).toBe(1);
    expect(asset.source).toBe("generated");
    expect(contentHash).toBe(contentHashOf(generated().bytes));
    // License recorded (Never-list #8 precondition).
    expect(license.provider).toBe("generated");
    expect(license.model).toBe("bfl/flux-2-flex@flux-2-flex");

    const rec = store.records[0]!;
    expect(rec.status).toBe("succeeded");
    expect(rec.assetId).toBe(asset.id);
    expect(rec.seed).toBe(7);
    expect(rec.costReported).toBe(5);
    expect(rec.clientId).toBe("client-1");
    expect(rec.slug).toBe("memory-care");
    expect(rec.license.provider).toBe("generated");
    expect(typeof rec.generatedAt).toBe("string");
    expect(rec.contentHash).toBe(contentHash);
    expect(rec.provenance).toMatchObject({
      synthidPresent: false,
      c2paPresent: false,
    });
  });

  it("dedups by content hash: no re-upload, still records provenance", async () => {
    const store = makeInMemoryImageStore();
    const args = {
      store,
      workspaceId: "ws-1",
      clientId: "client-1",
      slug: "memory-care",
      spec: spec(),
      promptHash: "ph-1",
      generated: generated(),
      costCredits: 1,
    };
    const first = await persistGeneratedImage(args);
    const second = await persistGeneratedImage(args);
    expect(store.uploads.length).toBe(1); // only the first uploaded
    expect(store.assets.length).toBe(1); // dedup — one asset
    expect(store.records.length).toBe(2); // provenance written both times
    expect(second.asset.id).toBe(first.asset.id);
  });
});

describe("imagegen/1 — deriveProvenanceFlags", () => {
  it("flags SynthID when present (e.g. Imagen)", () => {
    expect(
      deriveProvenanceFlags({ google: { synthID: { watermark: true } } })
        .synthidPresent,
    ).toBe(true);
  });
  it("flags C2PA / content credentials", () => {
    expect(deriveProvenanceFlags({ x: { c2pa: "manifest" } }).c2paPresent).toBe(
      true,
    );
    expect(
      deriveProvenanceFlags({ x: { contentCredentials: true } }).c2paPresent,
    ).toBe(true);
  });
  it("captures a provider revised prompt", () => {
    expect(
      deriveProvenanceFlags({ openai: { revised_prompt: "a nicer prompt" } })
        .revisedPrompt,
    ).toBe("a nicer prompt");
  });
  it("never throws on null/garbage and preserves the raw blob", () => {
    expect(deriveProvenanceFlags(null)).toMatchObject({
      synthidPresent: false,
      c2paPresent: false,
    });
    const raw = { bfl: { images: [{ cost: 5 }] } };
    expect(deriveProvenanceFlags(raw).providerRaw).toBe(raw);
  });
});

describe("imagegen/1 — resolveGeneratedAssetUrl", () => {
  it("leaves an asset with externalUrl present unchanged — no signing", async () => {
    const signUrl = vi.fn();
    const out = await resolveGeneratedAssetUrl(
      { externalUrl: "https://cdn/x.jpg", storageKey: null },
      { workspaceId: "ws-1", signUrl },
    );
    expect(out.externalUrl).toBe("https://cdn/x.jpg");
    expect(signUrl).not.toHaveBeenCalled();
  });

  it("mints a FRESH signed URL for a generated asset (storageKey only)", async () => {
    const signUrl = vi.fn(async () => "https://signed/fresh?token=abc");
    const out = await resolveGeneratedAssetUrl(
      { externalUrl: null, storageKey: "ws-1/generated/abc.png" },
      { workspaceId: "ws-1", signUrl },
    );
    expect(signUrl).toHaveBeenCalledWith({
      key: "ws-1/generated/abc.png",
      workspaceId: "ws-1",
    });
    expect(out.externalUrl).toBe("https://signed/fresh?token=abc");
  });
});
