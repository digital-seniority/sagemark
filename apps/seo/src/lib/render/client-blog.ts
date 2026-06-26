/**
 * client-blog — the SSR render core for a published content piece (PR 015, lane
 * render-geo).
 *
 * THE PUBLIC RENDER FLOOR (audit-003 Slice-1): turn a persisted, PUBLISHED
 * content piece into the article HTML that ships in the INITIAL server response
 * (acceptance criterion 1 — body-in-initial-HTML, the SEO/GEO requirement).
 *
 * Two concerns live here:
 *   1. A tiny, dependency-free, INJECTION-SAFE markdown -> HTML renderer. The
 *      body is HTML-escaped FIRST (so no `<script>`/event-handler in a piece body
 *      can ever execute — guardrail: "no script injection from piece body"),
 *      THEN a conservative subset of markdown is upgraded to tags. Adding a
 *      markdown dependency was avoided deliberately (tight write-scope + the
 *      escape-first design is the security property).
 *   2. `renderArticleBody(body)` — the one call the page uses: strip the
 *      placeholder directives (resolve-placeholders), then render to safe HTML.
 *
 * Pure + deterministic; no React, no network. The page server-component embeds
 * the produced HTML string via `dangerouslySetInnerHTML` — safe BECAUSE the
 * string is escape-first.
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

/**
 * Render the safe inline markdown subset on an ALREADY-ESCAPED line:
 *   - `[text](http(s)://url)` -> <a href> (href scheme allow-listed to http/https/mailto)
 *   - `**bold**` / `__bold__`  -> <strong>
 *   - `*em*` / `_em_`          -> <em>
 *   - `` `code` ``             -> <code>
 * Because the input is escaped, the only `<`/`>` we ever introduce are the ones
 * we author here — there is no path for body content to produce a live tag.
 */
function renderInline(escaped: string): string {
  let s = escaped;
  // Links: the text/url were escaped, so `"` is `&quot;` and `<` is `&lt;`. We
  // only accept http/https/mailto schemes; anything else is left as literal text.
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

/**
 * Minimal block-level markdown -> HTML. Handles: ATX headings (`#`..`######`),
 * unordered (`-`/`*`) and ordered (`1.`) lists, and paragraphs. Everything is
 * escaped before any tag is introduced. Unknown constructs degrade to a <p>.
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

    // Heading.
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const level = h[1]!.length;
      const text = renderInline(escapeHtml(h[2]!.trim()));
      out.push(`<h${level}>${text}</h${level}>`);
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
      !/^\d+\.\s+/.test(lines[i]!)
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

/**
 * The one render call the page makes: strip placeholder directives, then render
 * the body to injection-safe HTML. Throws if a placeholder somehow survives —
 * a fail-loud guard so a leaked `[photo:]` can never reach the public HTML
 * (acceptance criterion 3).
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
