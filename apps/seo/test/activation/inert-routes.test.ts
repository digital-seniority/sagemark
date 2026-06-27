/**
 * inert-routes.test.ts — the inert-by-default proof for the public + review seam
 * resolvers the routes compose (DR-026 activation).
 *
 * With NO service-role creds in the env, every route's data-access resolver returns
 * the fail-closed NOT_WIRED default (zero live adapter). Non-vacuous: we resolve the
 * seam and call a method, asserting it throws the NOT_WIRED error (the public seam)
 * / 404s the token (the review seam) exactly as today. No DB / network.
 *
 * The content resolver is covered in resolve-data-access.test.ts; this file covers
 * the public homepage seam + the review token/comment seams.
 */
import { describe, it, expect, afterEach } from "vitest";
import { resolvePublicContentDataAccess } from "@/lib/content/resolve-public-data-access";
import {
  resolveReviewTokenAccess,
  resolveReviewCommentAccess,
} from "@/lib/review/resolve-review-access";
import {
  NOT_WIRED_REVIEW_TOKEN_ACCESS,
  NOT_WIRED_REVIEW_COMMENT_ACCESS,
} from "@/lib/review/resolve-token";

const SAVED = {
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

function clearCreds(): void {
  delete process.env.SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE;
}

afterEach(() => {
  if (SAVED.url === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = SAVED.url;
  if (SAVED.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = SAVED.key;
});

describe("inert-routes: public homepage seam (no creds)", () => {
  it("resolves the fail-closed NOT_WIRED default — the published-content read throws", async () => {
    clearCreds();
    const data = await resolvePublicContentDataAccess();
    // Non-vacuous: the NOT_WIRED public default throws (the homepage 404s before
    // it ever reads a live row). No live adapter was composed.
    expect(() => data.resolveClientByBlogSlug("some-slug")).toThrow(/not wired/i);
  });
});

describe("inert-routes: review token + comment seams (no creds)", () => {
  it("the token seam resolves to the fail-closed NOT_WIRED default (every token 404s)", async () => {
    clearCreds();
    const tokens = await resolveReviewTokenAccess();
    // Identity-equal to the NOT_WIRED default — no live adapter built.
    expect(tokens).toBe(NOT_WIRED_REVIEW_TOKEN_ACCESS);
  });

  it("the comment seam resolves to the fail-closed NOT_WIRED default (no insert path)", async () => {
    clearCreds();
    const comments = await resolveReviewCommentAccess();
    expect(comments).toBe(NOT_WIRED_REVIEW_COMMENT_ACCESS);
  });
});
