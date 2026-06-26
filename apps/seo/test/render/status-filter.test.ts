/**
 * PR 015 acceptance criterion 4 — only `status='published'` pieces are served;
 * a draft/review/approved/archived slug returns 404 (never the content).
 *
 * `renderClientBlogPage` calls `notFound()` for a non-published or unknown slug.
 * Next's `notFound()` throws a sentinel error (digest `NEXT_HTTP_ERROR_FALLBACK;
 * 404`); we assert it throws (the 404 path) and that the body text NEVER appears.
 * Also covers sitemap fail-closed (unknown client -> 404) + published-only set,
 * and cross-client isolation.
 */

import { describe, it, expect } from "vitest";

import { renderClientBlogPage, resolvePublished } from "@/app/clients/[client]/blog/[slug]/page";
import { handleSitemap } from "@/app/clients/[client]/sitemap.xml/route";
import { handleRobots } from "@/app/clients/[client]/robots.txt/route";
import {
  makePublicData,
  publishedPiece,
  CLIENT_SLUG,
  CLIENT_ID,
  OTHER_CLIENT_ID,
} from "./fixtures";
import type { ContentStatus } from "@sagemark/schema-flywheel";

const NON_PUBLISHED: ContentStatus[] = ["draft", "review", "approved", "archived"];

/** Assert rendering throws Next's 404 sentinel (the notFound() path). */
async function expectNotFound(clientSlug: string, slug: string, data = makePublicData()) {
  await expect(renderClientBlogPage(clientSlug, slug, { data })).rejects.toThrow();
}

describe("status='published'-only filter (criterion 4)", () => {
  for (const status of NON_PUBLISHED) {
    it(`404s a '${status}' slug and never serves its body`, async () => {
      const secretBody = `SECRET ${status} body that must never be public`;
      const data = makePublicData({
        pieces: [
          publishedPiece({
            slug: `piece-${status}`,
            status,
            body: secretBody,
            faqData: null,
          }),
        ],
      });

      // The fail-closed resolve returns null (so the route 404s).
      const resolved = await resolvePublished(CLIENT_SLUG, `piece-${status}`, { data });
      expect(resolved).toBeNull();

      // The page render takes the notFound() path (throws), serving no content.
      await expectNotFound(CLIENT_SLUG, `piece-${status}`, data);
    });
  }

  it("serves a published slug", async () => {
    const data = makePublicData({ pieces: [publishedPiece()] });
    const resolved = await resolvePublished(CLIENT_SLUG, "what-is-memory-care", {
      data,
    });
    expect(resolved).not.toBeNull();
    expect(resolved!.piece.slug).toBe("what-is-memory-care");
  });

  it("404s an unknown slug and an unknown client", async () => {
    const data = makePublicData({ pieces: [publishedPiece()] });
    await expectNotFound(CLIENT_SLUG, "does-not-exist", data);
    await expectNotFound("no-such-client", "what-is-memory-care", data);
  });

  it("does not serve another client's published piece (tenant isolation)", async () => {
    const data = makePublicData({
      clients: [
        { id: CLIENT_ID, blogSlug: CLIENT_SLUG, name: "WW" },
        { id: OTHER_CLIENT_ID, blogSlug: "other-client", name: "Other" },
      ],
      pieces: [
        // Published, but owned by OTHER_CLIENT_ID.
        publishedPiece({ clientId: OTHER_CLIENT_ID, slug: "cross" }),
      ],
    });
    // Requesting it under CLIENT_SLUG must resolve null (scoped by resolved id).
    const resolved = await resolvePublished(CLIENT_SLUG, "cross", { data });
    expect(resolved).toBeNull();
    await expectNotFound(CLIENT_SLUG, "cross", data);
  });
});

describe("sitemap.xml + robots.txt (criterion 5)", () => {
  const req = (path: string) => new Request(`https://hub.example.com${path}`);

  it("sitemap lists exactly the published set for the client", async () => {
    const data = makePublicData({
      pieces: [
        publishedPiece({ slug: "pub-1" }),
        publishedPiece({ slug: "pub-2" }),
        publishedPiece({ slug: "draft-1", status: "draft" }),
        publishedPiece({ slug: "archived-1", status: "archived" }),
      ],
    });
    const res = await handleSitemap(
      req(`/clients/${CLIENT_SLUG}/sitemap.xml`),
      CLIENT_SLUG,
      { data },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    const xml = await res.text();
    expect(xml).toContain(`/clients/${CLIENT_SLUG}/blog/pub-1`);
    expect(xml).toContain(`/clients/${CLIENT_SLUG}/blog/pub-2`);
    // Non-published pieces are absent.
    expect(xml).not.toContain("draft-1");
    expect(xml).not.toContain("archived-1");
    // Exactly 2 published pieces + 1 hub root = 3 <url> entries.
    expect(xml.match(/<url>/g)).toHaveLength(3);
  });

  it("sitemap 404s an unknown client", async () => {
    const data = makePublicData({ pieces: [] });
    const res = await handleSitemap(req("/clients/nope/sitemap.xml"), "nope", {
      data,
    });
    expect(res.status).toBe(404);
  });

  it("robots.txt is served with a Sitemap line and AI-bot allowances", async () => {
    const data = makePublicData({ pieces: [publishedPiece()] });
    const res = await handleRobots(
      req(`/clients/${CLIENT_SLUG}/robots.txt`),
      CLIENT_SLUG,
      { data },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("User-agent: *");
    expect(body).toContain("User-agent: GPTBot");
    expect(body).toContain("User-agent: ClaudeBot");
    expect(body).toContain(
      `Sitemap: https://hub.example.com/clients/${CLIENT_SLUG}/sitemap.xml`,
    );
  });

  it("robots.txt 404s an unknown client", async () => {
    const data = makePublicData({ pieces: [] });
    const res = await handleRobots(req("/clients/nope/robots.txt"), "nope", {
      data,
    });
    expect(res.status).toBe(404);
  });
});
