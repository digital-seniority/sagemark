/**
 * moderate.test.ts — pre-spend moderation + typed refusal (`imagegen/1`).
 */
import { describe, it, expect } from "vitest";
import {
  makeLocalPromptModerator,
  classifyProviderError,
  isRetriable,
} from "../src/engine/moderate";

describe("imagegen/1 — local pre-spend moderator", () => {
  const mod = makeLocalPromptModerator();

  it("allows a benign hero prompt", async () => {
    const v = await mod.moderate(
      "a warm common room in a senior-living community, no text",
    );
    expect(v.allowed).toBe(true);
  });

  it("blocks an egregiously unsafe prompt before any spend", async () => {
    const v = await mod.moderate("graphic gore and dismemberment scene");
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("local-denylist");
  });
});

describe("imagegen/1 — typed refusal classification", () => {
  it("classifies a 400 / policy message as content_policy (non-retriable)", () => {
    expect(classifyProviderError({ statusCode: 400 })).toBe("content_policy");
    expect(
      classifyProviderError(new Error("request blocked by content policy")),
    ).toBe("content_policy");
    expect(isRetriable("content_policy")).toBe(false);
  });

  it("classifies 429 as rate_limit (retriable)", () => {
    expect(classifyProviderError({ status: 429 })).toBe("rate_limit");
    expect(isRetriable("rate_limit")).toBe(true);
  });

  it("classifies 5xx / network as transient (retriable)", () => {
    expect(classifyProviderError({ statusCode: 503 })).toBe("transient");
    expect(classifyProviderError(new Error("fetch failed"))).toBe("transient");
    expect(isRetriable("transient")).toBe(true);
  });

  it("defaults unknown errors to non-retriable (don't grind money)", () => {
    expect(classifyProviderError(new Error("???"))).toBe("unknown");
    expect(isRetriable("unknown")).toBe(false);
  });
});
