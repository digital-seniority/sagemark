/**
 * Slice 4 — article export core (node).
 *
 * The studio export turns the live draft body into the deliverable shapes. These
 * assert the load-bearing properties: standalone HTML is a complete, escaped,
 * self-contained document with the body rendered (and FAQ JSON-LD when present);
 * the fragment is body-only (no doctype); markdown strips placeholders; the meta
 * description is derived + truncated; and the filename stem is slug-safe.
 */

import { describe, it, expect } from "vitest";

import {
  buildStandaloneHtml,
  buildFragmentHtml,
  buildMarkdown,
  buildMeta,
  deriveMetaDescription,
  exportStem,
} from "@/lib/export/article-html";

const BODY = "# Early signs of dementia\n\nFamilies often notice **small changes** first.\n\n## When to act\n\nTrust your instinct.";

describe("buildStandaloneHtml", () => {
  it("is a complete self-contained document with the rendered body", () => {
    const html = buildStandaloneHtml({ title: "Early signs of dementia", slug: "early-signs", body: BODY });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<title>Early signs of dementia</title>");
    expect(html).toContain('<meta name="description"');
    expect(html).toContain("<style>"); // inline CSS — self-contained
    // The body rendered to tags (escape-first), not raw markdown.
    expect(html).toContain("<h1>Early signs of dementia</h1>");
    expect(html).toContain("<strong>small changes</strong>");
    expect(html).toContain("<h2>When to act</h2>");
    expect(html).not.toContain("# Early signs"); // no raw markdown
    // Exactly one H1 (the body's), not a duplicated explicit one.
    expect(html.match(/<h1>/g) ?? []).toHaveLength(1);
  });

  it("escapes the title and emits FAQ JSON-LD when faqData is present", () => {
    const html = buildStandaloneHtml({
      title: "A <b>bold</b> & risky title",
      slug: "x",
      body: BODY,
      faqData: [{ question: "Is it dementia?", answer: "Ask a clinician." }] as never,
    });
    expect(html).toContain("A &lt;b&gt;bold&lt;/b&gt; &amp; risky title");
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('"@type":"FAQPage"');
  });
});

describe("buildFragmentHtml / buildMarkdown", () => {
  it("fragment is body-only (no doctype, no <html>)", () => {
    const frag = buildFragmentHtml(BODY);
    expect(frag).not.toContain("<!DOCTYPE");
    expect(frag).not.toContain("<html");
    expect(frag).toContain("<h1>Early signs of dementia</h1>");
  });

  it("markdown strips studio placeholder directives", () => {
    const md = buildMarkdown("# Title\n\n[photo:hero]\n\nReal prose here.");
    expect(md).toContain("# Title");
    expect(md).toContain("Real prose here.");
    expect(md).not.toContain("[photo:hero]");
  });
});

describe("deriveMetaDescription / buildMeta / exportStem", () => {
  it("derives a truncated, punctuation-free description from the prose", () => {
    const desc = deriveMetaDescription(BODY);
    expect(desc).toContain("Families often notice");
    expect(desc).not.toContain("#");
    expect(desc).not.toContain("**");
    expect(deriveMetaDescription("word ".repeat(100), 40).length).toBeLessThanOrEqual(40);
  });

  it("buildMeta carries the title/slug/keyword", () => {
    const meta = buildMeta({ title: "T", slug: "the-slug", body: BODY, primaryKeyword: "dementia signs" });
    expect(meta).toMatchObject({ title: "T", slug: "the-slug", primaryKeyword: "dementia signs" });
    expect(typeof meta.metaDescription).toBe("string");
  });

  it("exportStem slugifies the title/slug for a filename", () => {
    expect(exportStem("Early Signs!")).toBe("early-signs");
    expect(exportStem("")).toBe("article");
    expect(exportStem("already-a-slug")).toBe("already-a-slug");
  });
});
