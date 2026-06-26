/**
 * generate.test.ts — the generation boundary (`imagegen/1`).
 *
 * Uses the FAKE generator + a stubbed gateway — NO live calls, NO spend.
 */
import { describe, it, expect, vi } from "vitest";
import {
  makeFakeImageGenerator,
  makeGatewayImageGenerator,
  extractReportedCost,
  extractSeedUsed,
} from "../src/engine/generate";
import { compileSpec } from "../src/engine/compile";
import {
  CanonicalImageSpecSchema,
  IMAGE_SPEC_VERSION,
} from "../src/engine/spec";

function req(modelId = "bfl/flux-2-klein-4b") {
  const spec = CanonicalImageSpecSchema.parse({
    schemaVersion: IMAGE_SPEC_VERSION,
    job: "hero",
    subject: "soft blue gradient",
    style: "abstract-gradient",
    aspectRatio: "16:9",
    seed: 7,
  });
  return compileSpec(spec, modelId);
}

describe("imagegen/1 — fake generator", () => {
  it("produces non-empty bytes and echoes provenance", async () => {
    const gen = makeFakeImageGenerator({ costReported: 5 });
    const out = await gen.generate(req());
    expect(out.bytes.length).toBeGreaterThan(0);
    expect(out.contentType).toBe("image/png");
    expect(out.modelId).toBe("bfl/flux-2-klein-4b");
    expect(out.modelVersion).toBe("flux-2-klein-4b");
    expect(out.seedUsed).toBe(7);
    expect(out.costReported).toBe(5);
  });
});

describe("imagegen/1 — cost/seed extraction (BFL shape)", () => {
  const meta = {
    blackForestLabs: {
      images: [{ seed: 2970106963, cost: 5, outputMegapixels: 1 }],
    },
    gateway: { routing: { finalProvider: "bfl" } },
  };
  it("extractReportedCost reads provider.images[0].cost", () => {
    expect(extractReportedCost(meta)).toBe(5);
  });
  it("extractSeedUsed reads provider.images[0].seed", () => {
    expect(extractSeedUsed(meta)).toBe(2970106963);
  });
  it("both return undefined when metadata is empty/missing", () => {
    expect(extractReportedCost(null)).toBeUndefined();
    expect(extractReportedCost({})).toBeUndefined();
    expect(extractSeedUsed(undefined)).toBeUndefined();
  });
});

describe("imagegen/1 — gateway generator (stubbed AI SDK, no network)", () => {
  it("calls generateImage with the compiled request and maps the result", async () => {
    const fakeBytes = new Uint8Array([1, 2, 3, 4]);
    const generateImage = vi.fn(async (args: Record<string, unknown>) => {
      expect(args.prompt).toContain("soft blue gradient");
      expect(args.size).toBe("1920x1080");
      expect(args.seed).toBe(7);
      return {
        image: { uint8Array: fakeBytes, mediaType: "image/png" },
        providerMetadata: {
          blackForestLabs: { images: [{ cost: 5, seed: 999 }] },
        },
      };
    });
    const gatewayImageModel = vi.fn((id: string) => ({ __model: id }));
    const gen = makeGatewayImageGenerator({ generateImage, gatewayImageModel });

    const out = await gen.generate(req());
    expect(gatewayImageModel).toHaveBeenCalledWith("bfl/flux-2-klein-4b");
    expect(out.bytes).toEqual(fakeBytes);
    expect(out.costReported).toBe(5);
    expect(out.seedUsed).toBe(999); // provider-reported seed wins over requested
  });

  it("throws when the model returns no image", async () => {
    const generateImage = vi.fn(async () => ({ images: [] }));
    const gen = makeGatewayImageGenerator({
      generateImage,
      gatewayImageModel: (id: string) => id,
    });
    await expect(gen.generate(req())).rejects.toThrow(/no image/);
  });

  it("throws on empty bytes (a model that returned a zero-length payload)", async () => {
    const generateImage = vi.fn(async () => ({
      image: { uint8Array: new Uint8Array() },
    }));
    const gen = makeGatewayImageGenerator({
      generateImage,
      gatewayImageModel: (id: string) => id,
    });
    await expect(gen.generate(req())).rejects.toThrow(/empty bytes/);
  });
});
