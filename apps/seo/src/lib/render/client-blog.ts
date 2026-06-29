/**
 * client-blog — the SSR render core for a published content piece (PR 015, lane
 * render-geo) + the MD-convention rich-block renderer (lane hub-visual / H5).
 *
 * Two concerns live here:
 *   1. A tiny, dependency-free, INJECTION-SAFE markdown -> HTML renderer. The
 *      body is HTML-escaped FIRST (so no `<script>`/event-handler in a piece body
 *      can ever execute), THEN a conservative subset of markdown is upgraded to
 *      tags. On top of the base subset (headings / lists / paragraphs / inline),
 *      it renders the RICH BLOCKS the demo article template uses, driven by simple
 *      authoring conventions so the AI only has to emit an MD file:
 *        - GitHub-style tables            | a | b |  /  | --- | --- |
 *        - Blockquotes                    > quoted text
 *        - Container directives           :::tip … :::   (also: warn, note,
 *                                          quick-answer, takeaways, quote)
 *        - Heading anchors                every h2/h3 gets a slug id (TOC targets)
 *      Unknown constructs degrade to a paragraph. Everything stays escape-first:
 *      the only tags introduced are the ones authored HERE.
 *   2. `renderArticleBody(body)` — strip placeholder directives, then render.
 *
 * Pure + deterministic; no React, no network.
 */

import { resolvePlaceholders, hasLeakedPlaceholder } from "./resolve-placeholders";

/** Escape the five HTML-significant characters. The FIRST transform applied to
 * every piece of body text — the load-bearing XSS guard. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A URL-safe slug for a heading, used as the anchor id + TOC target. */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Render the safe inline markdown subset on an ALREADY-ESCAPED line:
 *   - `[text](http(s)://url)` -> <a href> (href scheme allow-listed to http/https/mailto)
 *   - `**bold**` / `__bold__`  -> <strong>
 *   - `*em*` / `_em_`          -> <em>
 *   - `` `code` ``             -> <code>
 */
function renderInline(escaped: string): string {
  let s = escaped;
  s = s.replace(
    /\[([^\]]+)\]\((https?:&#x2F;&#x2F;[^\s)]+|https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/gi,
    (_m, text: string, url: string) => {
      const safeUrl = url.replace(/&#x2F;/g, "/");
      if (!/^(https?:\/\/|mailto:)/i.test(safeUrl)) return `${text}`;
      return `<a href="${safeUrl}" rel="noopener">${text}</a>`;
    },
  );
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}

/** Is `line` the separator row of a GitHub table (e.g. `| --- | :--: |`)? */
function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
}

/** Split a table row into trimmed cells (dropping the empty leading/trailing). */
function tableCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

const CALLOUT_LABELS: Record<string, string> = {
  tip: "Tip",
  warn: "Good to know",
  note: "Note",
};

/**
 * Minimal block-level markdown -> HTML with rich blocks. Escape-first.
 */
export function renderMarkdownToSafeHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let listType: "ul" | "ol" | null = null;

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  while (i < lines.length) {
    const raw = lines[i]!;
    const line = raw.trimEnd();

    // Blank line — paragraph/list break.
    if (line.trim() === "") {
      closeList();
      i++;
      continue;
    }

    // Container directive:  :::name … :::
    const dir = /^:::\s*([a-z][a-z-]*)\s*$/i.exec(line);
    if (dir) {
      closeList();
      const name = dir[1]!.toLowerCase();
      const inner: string[] = [];
      i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i]!.trim())) {
        inner.push(lines[i]!);
        i++;
      }
      if (i < lines.length) i++; // consume the closing :::
      out.push(renderDirective(name, inner.join("\n")));
      continue;
    }

    // Table: a `|` row immediately followed by a separator row.
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) {
      closeList();
      const header = tableCells(line);
      i += 2; // header + separator
      const bodyRows: string[][] = [];
      while (i < lines.length && lines[i]!.trim() !== "" && lines[i]!.includes("|")) {
        bodyRows.push(tableCells(lines[i]!));
        i++;
      }
      const thead = `<thead><tr>${header
        .map((c) => `<th>${renderInline(escapeHtml(c))}</th>`)
        .join("")}</tr></thead>`;
      const tbody = `<tbody>${bodyRows
        .map(
          (r) =>
            `<tr>${r.map((c) => `<td>${renderInline(escapeHtml(c))}</td>`).join("")}</tr>`,
        )
        .join("")}</tbody>`;
      out.push(`<div class="table-wrap"><table class="data">${thead}${tbody}</table></div>`);
      continue;
    }

    // Blockquote: consecutive `> ` lines.
    if (/^>\s?/.test(line)) {
      closeList();
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!.trimEnd())) {
        quote.push(lines[i]!.replace(/^>\s?/, "").trim());
        i++;
      }
      out.push(`<blockquote>${renderInline(escapeHtml(quote.join(" ")))}</blockquote>`);
      continue;
    }

    // Heading (with anchor id for the TOC).
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const level = h[1]!.length;
      const rawText = h[2]!.trim();
      const text = renderInline(escapeHtml(rawText));
      const id = slugifyHeading(rawText);
      out.push(`<h${level} id="${id}">${text}</h${level}>`);
      i++;
      continue;
    }

    // Unordered list item.
    const ul = /^[-*]\s+(.*)$/.exec(line);
    if (ul) {
      if (listType !== "ul") {
        closeList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push(`<li>${renderInline(escapeHtml(ul[1]!.trim()))}</li>`);
      i++;
      continue;
    }

    // Ordered list item.
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      if (listType !== "ol") {
        closeList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push(`<li>${renderInline(escapeHtml(ol[1]!.trim()))}</li>`);
      i++;
      continue;
    }

    // Paragraph — gather consecutive non-blank, non-block lines.
    closeList();
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^(#{1,6})\s+/.test(lines[i]!) &&
      !/^[-*]\s+/.test(lines[i]!) &&
      !/^\d+\.\s+/.test(lines[i]!) &&
      !/^>\s?/.test(lines[i]!) &&
      !/^:::\s*[a-z]/i.test(lines[i]!) &&
      !(lines[i]!.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]!))
    ) {
      para.push(lines[i]!.trim());
      i++;
    }
    const text = renderInline(escapeHtml(para.join(" ")));
    out.push(`<p>${text}</p>`);
  }
  closeList();
  return out.join("\n");
}

/** Render a container directive block to its styled component (escape-first). */
function renderDirective(name: string, inner: string): string {
  // Callouts.
  if (name === "tip" || name === "warn" || name === "note") {
    return `<div class="callout ${name}"><div class="lbl">${escapeHtml(
      CALLOUT_LABELS[name]!,
    )}</div>${renderMarkdownToSafeHtml(inner)}</div>`;
  }
  // Quick-answer (featured-snippet / AI-answer box).
  if (name === "quick-answer" || name === "answer") {
    return `<div class="quick-answer"><div class="lbl">Quick answer</div>${renderMarkdownToSafeHtml(
      inner,
    )}</div>`;
  }
  // Key takeaways — inner is a list.
  if (name === "takeaways" || name === "key-takeaways") {
    return `<div class="takeaways"><h2>Key takeaways</h2>${renderMarkdownToSafeHtml(inner)}</div>`;
  }
  // Pull quote — first line is the quote; an optional trailing `— author` is the cite.
  if (name === "quote" || name === "pullquote") {
    const parts = inner.split("\n").map((l) => l.trim()).filter(Boolean);
    const citeIdx = parts.findIndex((l) => /^[—-]\s+/.test(l));
    const quoteText = (citeIdx >= 0 ? parts.slice(0, citeIdx) : parts).join(" ");
    const cite = citeIdx >= 0 ? parts[citeIdx]!.replace(/^[—-]\s+/, "") : "";
    return `<div class="pullquote"><p>${renderInline(escapeHtml(quoteText))}</p>${
      cite ? `<cite>${renderInline(escapeHtml(cite))}</cite>` : ""
    }</div>`;
  }
  // Unknown directive name — render the inner content plainly (never drop content).
  return renderMarkdownToSafeHtml(inner);
}

/** A table-of-contents entry (an h2 anchor in the body). */
export interface TocEntry {
  id: string;
  text: string;
}

/**
 * Extract the h2 headings (the TOC targets) from a body, skipping any that live
 * inside a container directive (those are not top-level sections). Returns the
 * clean text + the slug id the renderer will emit.
 */
export function extractToc(body: string): TocEntry[] {
  const lines = (body ?? "").replace(/\r\n/g, "\n").split("\n");
  const toc: TocEntry[] = [];
  let inDirective = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^:::\s*[a-z]/i.test(line)) {
      inDirective = true;
      continue;
    }
    if (/^:::\s*$/.test(line)) {
      inDirective = false;
      continue;
    }
    if (inDirective) continue;
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      const text = h[1]!.trim();
      toc.push({ id: slugifyHeading(text), text });
    }
  }
  return toc;
}

/** Estimate reading time in whole minutes (~220 wpm, min 1). */
export function estimateReadingMinutes(body: string): number {
  const words = (body ?? "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

/**
 * The one render call the page makes: strip placeholder directives, then render
 * the body to injection-safe HTML. Throws if a placeholder survives — a fail-loud
 * guard so a leaked `[photo:]` can never reach the public HTML.
 */
export function renderArticleBody(body: string): string {
  const stripped = resolvePlaceholders(body ?? "");
  if (hasLeakedPlaceholder(stripped)) {
    throw new Error(
      "render: placeholder directive survived stripping — refusing to leak it to public HTML",
    );
  }
  return renderMarkdownToSafeHtml(stripped);
}
