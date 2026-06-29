/**
 * H5 — the MD-convention rich-block renderer. Proves the authoring conventions
 * (container directives, GitHub tables, blockquotes, heading anchors) render to
 * the demo article components, the TOC extractor reads the h2s, and the
 * escape-first XSS guard still holds INSIDE a directive block.
 */

import { describe, it, expect } from "vitest";

import {
  renderMarkdownToSafeHtml,
  extractToc,
  estimateReadingMinutes,
  slugifyHeading,
} from "@/lib/render/client-blog";

describe("container directives → demo components", () => {
  it("renders a callout (:::tip)", () => {
    const html = renderMarkdownToSafeHtml(":::tip\nVisit in the **morning**.\n:::");
    expect(html).toContain('<div class="callout tip">');
    expect(html).toContain('<div class="lbl">Tip</div>');
    expect(html).toContain("<strong>morning</strong>");
  });

  it("renders a quick-answer box", () => {
    const html = renderMarkdownToSafeHtml(":::quick-answer\nMemory care is secured.\n:::");
    expect(html).toContain('<div class="quick-answer">');
    expect(html).toContain('<div class="lbl">Quick answer</div>');
  });

  it("renders key takeaways with a list", () => {
    const html = renderMarkdownToSafeHtml(":::takeaways\n- First point\n- Second point\n:::");
    expect(html).toContain('<div class="takeaways">');
    expect(html).toContain("<h2>Key takeaways</h2>");
    expect(html).toContain("<li>First point</li>");
  });

  it("renders a pull quote with an attribution", () => {
    const html = renderMarkdownToSafeHtml(":::quote\nCare feels like home.\n— A daughter\n:::");
    expect(html).toContain('<div class="pullquote">');
    expect(html).toContain("<cite>A daughter</cite>");
  });
});

describe("GitHub tables → styled table", () => {
  it("renders a table with thead/tbody", () => {
    const md = ["| Feature | Memory care |", "| --- | --- |", "| Staff | Trained |"].join("\n");
    const html = renderMarkdownToSafeHtml(md);
    expect(html).toContain('<div class="table-wrap"><table class="data">');
    expect(html).toContain("<thead><tr><th>Feature</th><th>Memory care</th></tr></thead>");
    expect(html).toContain("<td>Trained</td>");
  });
});

describe("blockquotes + heading anchors", () => {
  it("renders a blockquote", () => {
    expect(renderMarkdownToSafeHtml("> A calm note")).toContain("<blockquote>A calm note</blockquote>");
  });

  it("gives every heading a slug id", () => {
    const html = renderMarkdownToSafeHtml("## What Is Memory Care?");
    expect(html).toContain('<h2 id="what-is-memory-care">What Is Memory Care?</h2>');
  });

  it("slugifyHeading is url-safe", () => {
    expect(slugifyHeading("Paying for Care: Medicaid & VA")).toBe("paying-for-care-medicaid-va");
  });
});

describe("TOC extraction + read time", () => {
  it("extracts h2s but skips headings inside a directive", () => {
    const md = [
      "## Section One",
      "text",
      ":::takeaways",
      "## Not a section",
      ":::",
      "## Section Two",
    ].join("\n");
    const toc = extractToc(md);
    expect(toc.map((t) => t.text)).toEqual(["Section One", "Section Two"]);
    expect(toc[0]!.id).toBe("section-one");
  });

  it("estimates reading minutes (>=1)", () => {
    expect(estimateReadingMinutes("one two three")).toBe(1);
    expect(estimateReadingMinutes(Array(440).fill("word").join(" "))).toBe(2);
  });
});

describe("escape-first holds inside a directive", () => {
  it("escapes a script tag authored inside a callout", () => {
    const html = renderMarkdownToSafeHtml(":::note\n<script>alert(1)</script>\n:::");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
