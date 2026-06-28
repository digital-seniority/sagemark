/**
 * article-export — turn the live draft into the deliverable formats (Slice 4).
 *
 * The studio exports the CURRENT draft body (markdown) into the shapes an operator
 * hands off: a standalone HTML document, a CMS-paste body fragment, clean markdown,
 * and a meta sidecar. Everything reuses the SAME escape-first renderer the public
 * SSR page uses (`renderMarkdownToSafeHtml`) so the exported HTML is injection-safe
 * and visually faithful to what will publish.
 *
 * Placeholders (`[photo:]`/`[cta:]`) are stripped (resolvePlaceholders) rather than
 * fail-loud here: a studio export of an in-progress draft must never throw (unlike
 * the public render's hard publish-time guard). Pure + client-safe (no React, no
 * server-only, no network) — runs in the browser export menu and in unit tests.
 */

import { escapeHtml, renderMarkdownToSafeHtml } from "@/lib/render/client-blog";
import { resolvePlaceholders } from "@/lib/render/resolve-placeholders";
import { serializeFaqJsonLd } from "@/lib/render/build-faq-jsonld";
import type { GeoFaqItem } from "@sagemark/core";

export interface ArticleExportInput {
  /** The piece title (the H1 + <title>). */
  title: string;
  /** The url slug (filename stem + display URL). */
  slug: string;
  /** The draft markdown body (live — may still contain placeholders). */
  body: string;
  /** Optional meta description; derived from the body when absent. */
  metaDescription?: string | null;
  /** Optional primary keyword (carried into meta.json). */
  primaryKeyword?: string | null;
  /** Optional FAQ data (emitted as FAQPage JSON-LD when present). */
  faqData?: GeoFaqItem[] | null;
}

/** Render the body markdown to safe HTML with placeholder directives stripped. */
export function bodyToSafeHtml(body: string): string {
  return renderMarkdownToSafeHtml(resolvePlaceholders(body ?? ""));
}

/** A CMS-paste fragment: the rendered article body only (no doctype/page chrome). */
export function buildFragmentHtml(body: string): string {
  return bodyToSafeHtml(body);
}

/** Clean markdown for a CMS paste: the body with studio placeholder directives removed. */
export function buildMarkdown(body: string): string {
  return resolvePlaceholders(body ?? "").trim() + "\n";
}

/** Derive a ~160-char meta description from the first prose paragraph of the body. */
export function deriveMetaDescription(body: string, max = 160): string {
  const plain = resolvePlaceholders(body ?? "")
    .replace(/^#{1,6}\s+.*$/gm, "") // drop heading lines
    .replace(/[*_`>#-]/g, " ") // drop markdown punctuation
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  return plain.slice(0, max - 1).trimEnd() + "…";
}

/** A light, self-contained article stylesheet for the exported document. */
const STANDALONE_CSS = [
  "body{max-width:720px;margin:40px auto;padding:0 20px;background:#ffffff;color:#1a1a1a;",
  "font-family:Georgia,'Times New Roman',serif;line-height:1.7}",
  "h1{font-size:32px;line-height:1.2;margin:0 0 10px}",
  "h2{font-size:22px;margin:32px 0 10px}h3{font-size:18px;margin:24px 0 8px}",
  "p{font-size:18px;margin:0 0 16px}ul,ol{font-size:18px;padding-left:1.4em}li{margin-bottom:6px}",
  "a{color:#0b66c3}strong{font-weight:700}",
  "code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f3f3f3;padding:1px 5px;border-radius:4px;font-size:.9em}",
].join("");

/**
 * A standalone, self-contained HTML document (doctype + head + inline CSS + the
 * article + FAQPage JSON-LD). Drop-in for a CMS or a leave-behind file. The title
 * is attribute/element escaped; the body is escape-first rendered.
 */
export function buildStandaloneHtml(input: ArticleExportInput): string {
  const title = escapeHtml(input.title || "Untitled");
  const meta = escapeHtml(input.metaDescription || deriveMetaDescription(input.body));
  const bodyHtml = bodyToSafeHtml(input.body);
  const faq = serializeFaqJsonLd(input.faqData);
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${title}</title>`,
    meta ? `<meta name="description" content="${meta}" />` : "",
    `<style>${STANDALONE_CSS}</style>`,
    "</head>",
    "<body>",
    // The draft body already carries its own leading `# Title` (the worker writes
    // the title as the first markdown heading), so the rendered body supplies the
    // H1 — we don't add a second one. `<title>` above is the document/SEO title.
    "<article>",
    bodyHtml,
    "</article>",
    faq ? `<script type="application/ld+json">${faq}</script>` : "",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** The meta sidecar object for the ZIP bundle (title/slug/description/keyword). */
export function buildMeta(input: ArticleExportInput): Record<string, unknown> {
  return {
    title: input.title || "Untitled",
    slug: input.slug || "",
    metaDescription: input.metaDescription || deriveMetaDescription(input.body),
    primaryKeyword: input.primaryKeyword ?? null,
  };
}

/** A filesystem-safe filename stem from the slug (or a fallback). */
export function exportStem(slug: string): string {
  const s = (slug || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "article";
}
