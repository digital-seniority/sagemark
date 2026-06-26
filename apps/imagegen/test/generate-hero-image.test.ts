/**
 * generate-hero-image.test.ts — the SEO ImageGen orchestrator (`imagegen/1`).
 *
 * All fakes — the in-memory store + the fake generator. NO live AI Gateway, NO
 * Supabase, ZERO spend. Asserts: the moderation gate (pre-spend), the cost-cap
 * refusal (pre-spend), the healthcare hero spec constraints, the provenance +
 * AI-generated license record, the persist call, the dedup path, and the
 * [photo:slug] resolution path (P1.R.3).
 */
import { describe, it, expect, vi } from "vitest";
import {
  generateHeroImage,
  resolveHeroPlaceholder,
  parsePhotoToken,
  HERO_CONSTRAINTS,
  type HeroImageDeps,
} from "../src/engine/generate-hero-image";
import { makeInMemoryImageStore } from "../src/engine/store";
import { makeFakeImageGenerator } from "../src/engine/generate";
import { CostCapExceededError } from "../src/engine/cost";
import type { ImageGenerator } from "../src/engine/generate";
import type { PromptModerator } from "../src/engine/moderate";

function makeDeps(
  over: Partial<HeroImageDeps> = {},
): HeroImageDeps & { store: ReturnType<typeof makeInMemoryImageStore> } {
  const store = makeInMemoryImageStore();
  return {
    generator: makeFakeImageGenerator({ costReported: 4 }),
    store,
    signUrl: async ({ key }) => `https://signed.example/${key}`,
    ...over,
    store: (over.store as ReturnType<typeof makeInMemoryImageStore>) ?? store,
  };
}

const BASE = {
  subject: "a warm sunlit common room in a senior-living community",
  workspaceId: "ws-1",
  clientId: "client-1",
  slug: "memory-care",
} as const;

describe("generateHeroImage — happy path", () => {
  it("generates, persists, signs, and returns a result with a license + provenance", async () => {
    const deps = makeDeps();
    const result = await generateHeroImage({ ...BASE, deps });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url).toBe(
      `https://signed.example/${deps.store.assets[0]!.storageKey}`,
    );
    expect(result.license.provider).toBe("generated");
    // hero default routes to the mid model (flux-2-flex).
    expect(result.modelId).toBe("bfl/flux-2-flex");
    expect(result.costReported).toBe(4);
    expect(result.contentHash).toBeTruthy();
    expect(result.promptHash).toBeTruthy();

    // Persisted: one upload, one asset, one provenance row carrying the license.
    expect(deps.store.uploads.length).toBe(1);
    expect(deps.store.assets.length).toBe(1);
    expect(deps.store.records.length).toBe(1);
    const rec = deps.store.records[0]!;
    expect(rec.clientId).toBe("client-1");
    expect(rec.slug).toBe("memory-care");
    expect(rec.license.provider).toBe("generated");
    expect(rec.generatedAt).toBeTruthy();
  });

  it("bakes the healthcare hero constraints into the compiled prompt", async () => {
    const prompts: string[] = [];
    const capturing: ImageGenerator = {
      async generate(req) {
        prompts.push(req.prompt);
        return {
          bytes: new Uint8Array([1, 2, 3]),
          contentType: "image/png",
          modelId: req.modelId,
          modelVersion: req.modelVersion,
        };
      },
    };
    const deps = makeDeps({ generator: capturing });
    await generateHeroImage({ ...BASE, deps });
    const prompt = prompts[0]!;
    expect(prompt).toContain("no text");
    expect(prompt).toContain("no logos");
    expect(prompt).toContain("no watermarks");
    expect(prompt).toContain("respectful and dignified portrayal of older adults");
    // sanity: HERO_CONSTRAINTS is the source of truth
    expect(HERO_CONSTRAINTS).toContain("no identifiable faces");
  });

  it("routes photo job to the draft model", async () => {
    const deps = makeDeps();
    const result = await generateHeroImage({ ...BASE, job: "photo", deps });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.modelId).toBe("bfl/flux-2-klein-4b");
  });
});

describe("generateHeroImage — pre-spend moderation gate", () => {
  it("returns a typed refusal and NEVER calls the generator on a blocked prompt", async () => {
    const generate = vi.fn();
    const generator: ImageGenerator = {
      generate: generate as unknown as ImageGenerator["generate"],
    };
    const deps = makeDeps({ generator });
    const result = await generateHeroImage({
      ...BASE,
      subject: "graphic gore and dismemberment",
      deps,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toBe("moderation");
    expect(result.reason).toBe("local-denylist");
    // PRE-SPEND: no generate call, no persist.
    expect(generate).not.toHaveBeenCalled();
    expect(deps.store.uploads.length).toBe(0);
    expect(deps.store.records.length).toBe(0);
  });

  it("honours an injected custom moderator", async () => {
    const moderator: PromptModerator = {
      async moderate() {
        return { allowed: false, reason: "custom-block" };
      },
    };
    const deps = makeDeps({ moderator });
    const result = await generateHeroImage({ ...BASE, deps });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("custom-block");
  });
});

describe("generateHeroImage — pre-spend cost cap", () => {
  it("refuses (throws CostCapExceededError) BEFORE spend when over cap", async () => {
    const generate = vi.fn();
    const generator: ImageGenerator = {
      generate: generate as unknown as ImageGenerator["generate"],
    };
    const deps = makeDeps({ generator });
    // hero → mid tier (est $0.04); cap $0.01 → refuse.
    await expect(
      generateHeroImage({ ...BASE, costCapUsd: 0.01, deps }),
    ).rejects.toBeInstanceOf(CostCapExceededError);
    expect(generate).not.toHaveBeenCalled();
    expect(deps.store.records.length).toBe(0);
  });

  it("allows when the cap covers the tier estimate", async () => {
    const deps = makeDeps();
    const result = await generateHeroImage({ ...BASE, costCapUsd: 0.05, deps });
    expect(result.ok).toBe(true);
  });
});

describe("generateHeroImage — dedup", () => {
  it("reuses the asset on identical bytes but still writes provenance", async () => {
    const deps = makeDeps();
    const a = await generateHeroImage({ ...BASE, deps });
    const b = await generateHeroImage({ ...BASE, deps });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.assetId).toBe(b.assetId);
    expect(deps.store.uploads.length).toBe(1); // deduped
    expect(deps.store.records.length).toBe(2); // both recorded
  });
});

describe("generateHeroImage — failure propagation", () => {
  it("propagates generator errors", async () => {
    const generator: ImageGenerator = {
      async generate() {
        throw new Error("gateway 503");
      },
    };
    const deps = makeDeps({ generator });
    await expect(generateHeroImage({ ...BASE, deps })).rejects.toThrow(
      "gateway 503",
    );
  });
});

describe("parsePhotoToken + resolveHeroPlaceholder (P1.R.3)", () => {
  it("parses a [photo:slug] token", () => {
    expect(parsePhotoToken("[photo:sunlit-common-room]")).toBe(
      "sunlit-common-room",
    );
    expect(parsePhotoToken("[photo: spaced slug ]")).toBe("spaced slug");
    expect(parsePhotoToken("not a token")).toBeNull();
  });

  it("resolves a [photo:slug] placeholder to a generated hero image", async () => {
    const deps = makeDeps();
    const result = await resolveHeroPlaceholder({
      token: "[photo:sunlit-common-room]",
      workspaceId: "ws-1",
      clientId: "client-1",
      deps,
    });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    if (result!.ok) {
      expect(result!.url).toBeTruthy();
      expect(result!.license.provider).toBe("generated");
    }
    // provenance recorded against the slug.
    expect(deps.store.records[0]!.slug).toBe("sunlit-common-room");
  });

  it("uses an explicit subject when P1.R.3 supplies one", async () => {
    const prompts: string[] = [];
    const capturing: ImageGenerator = {
      async generate(req) {
        prompts.push(req.prompt);
        return {
          bytes: new Uint8Array([4, 5, 6]),
          contentType: "image/png",
          modelId: req.modelId,
          modelVersion: req.modelVersion,
        };
      },
    };
    const deps = makeDeps({ generator: capturing });
    await resolveHeroPlaceholder({
      token: "[photo:hero-1]",
      subject: "an explicit brief subject from the page",
      workspaceId: "ws-1",
      clientId: "client-1",
      deps,
    });
    expect(prompts[0]).toContain("an explicit brief subject from the page");
  });
});
