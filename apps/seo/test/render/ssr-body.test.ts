/**
 * PR 015 acceptance criterion 1 — the full article body is present in the
 * INITIAL server-rendered HTML (not injected client-side).
 *
 * We render the Server Component `renderClientBlogPage(...)` (with an injected
 * published-piece seam) to a STATIC HTML string via react-dom/server's
 * `renderToStaticMarkup` — the same pass that produces Next's initial response.
 * The assertion is on that string: the body prose + headings + list items are
 * all in the markup. There is NO client component / hydration in this route, so
 * the markup IS the body (the SEO/GEO requirement).
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { renderClientBlogPage } from "@/app/clients/[client]/blog/[slug]/page";
import {
  makePublicData,
  publishedPiece,
  CLIENT_SLUG,
} from "./fixtures";

async function renderHtml(clientSlug: string, slug: string, data = makePublicData({ pieces: [publishedPiece()] })) {
  // The Server Component is async; await it to the JSX element, then render the
  // element to a static HTML string (the initial-response markup).
  const element = await renderClientBlogPage(clientSlug, slug, { data });
  return renderToStaticMarkup(element);
}

describe("SSR body-in-initial-HTML (criterion 1)", () => {
  it("emits the full article body prose in the server-rendered markup", async () => {
    const html = await renderHtml(CLIENT_SLUG, "what-is-memory-care");

    // The heading text.
    expect(html).toContain("What is memory care?");
    // The body prose (a distinctive sentence from the body).
    expect(html).toContain(
      "Memory care is a specialized type of long-term care designed for people",
    );
    // List items rendered as <li>.
    expect(html).toContain("<li>Secured, calming environment</li>");
    expect(html).toContain("<li>Dementia-trained staff</li>");
    // The body lives inside the article-body container (server-rendered).
    expect(html).toContain('data-role="article-body"');
    expect(html).toMatch(/<article>[\s\S]*Memory care is a specialized[\s\S]*<\/article>/);
  });

  it("renders the markdown heading as an <h2> in the body (not raw markdown)", async () => {
    const html = await renderHtml(CLIENT_SLUG, "what-is-memory-care");
    expect(html).toContain("<h2>What is memory care?</h2>");
    // No raw markdown markers survive in the rendered body.
    expect(html).not.toContain("## What is memory care?");
  });

  it("escapes HTML in the body — a script in the piece body cannot execute", async () => {
    const data = makePublicData({
      pieces: [
        publishedPiece({
          slug: "xss",
          body: "Hello <script>alert(1)</script> world and a <b>bold</b> tag.",
          faqData: null,
        }),
      ],
    });
    const html = await renderHtml(CLIENT_SLUG, "xss", data);
    // The literal script tag is escaped — never a live <script> from the body.
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    // The benign-looking <b> from the body is also escaped (escape-first).
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });
});
