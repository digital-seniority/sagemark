/**
 * PR 015 acceptance criterion 3 — placeholder directives (`[photo:...]`,
 * `[cta:...]`, any `[...]` markers) are stripped; none leak into rendered HTML.
 *
 * Asserts the pure stripper (`resolvePlaceholders` / `hasLeakedPlaceholder`) AND
 * the rendered page markup (no `[photo:` / `[cta:` anywhere in the output).
 * Also proves a legitimate markdown link `[text](url)` is NOT stripped.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  resolvePlaceholders,
  hasLeakedPlaceholder,
} from "@/lib/render/resolve-placeholders";
import { renderArticleBody } from "@/lib/render/client-blog";
import { renderClientBlogPage } from "@/app/clients/[client]/blog/[slug]/page";
import { makePublicData, publishedPiece, CLIENT_SLUG } from "./fixtures";

describe("placeholder stripping (criterion 3)", () => {
  it("strips colon directives and bare markers", () => {
    const out = resolvePlaceholders(
      "Intro.\n\n[photo: a porch]\n\nBody text.\n\n[cta: book a tour]\n\n[photo]\n",
    );
    expect(out).not.toMatch(/\[photo/);
    expect(out).not.toMatch(/\[cta/);
    expect(out).toContain("Intro.");
    expect(out).toContain("Body text.");
    expect(hasLeakedPlaceholder(out)).toBe(false);
  });

  it("preserves a markdown link [text](url) (not a directive)", () => {
    const out = resolvePlaceholders(
      "See our [guide on costs](https://example.com/costs) for details.",
    );
    expect(out).toContain("[guide on costs](https://example.com/costs)");
    expect(hasLeakedPlaceholder(out)).toBe(false);
  });

  it("renderArticleBody throws if a directive somehow survived (fail-loud)", () => {
    // resolvePlaceholders handles real input; this guards the invariant.
    expect(hasLeakedPlaceholder("text [photo: leaked]")).toBe(true);
  });

  it("no placeholder token appears in the rendered page HTML", async () => {
    const data = makePublicData({ pieces: [publishedPiece()] });
    const element = await renderClientBlogPage(CLIENT_SLUG, "what-is-memory-care", {
      data,
    });
    const html = renderToStaticMarkup(element);
    expect(html).not.toContain("[photo:");
    expect(html).not.toContain("[cta:");
    expect(html).not.toMatch(/\[(?:photo|cta)\]/);
    // The surrounding prose is intact.
    expect(html).toContain("Memory care is a specialized type of long-term care");
  });

  it("rendered body HTML from a placeholder-heavy body is clean", () => {
    const html = renderArticleBody(
      "## Title\n\n[photo: x]\n\nReal sentence.\n\n[cta: y]\n",
    );
    expect(html).toMatch(/<h2 id="title">Title<\/h2>/);
    expect(html).toContain("<p>Real sentence.</p>");
    expect(html).not.toMatch(/\[(photo|cta)/);
  });
});
