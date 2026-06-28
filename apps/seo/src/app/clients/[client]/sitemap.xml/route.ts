/**
 * Per-client sitemap.xml (PR 015, lane render-geo).
 *
 *   GET /clients/[client]/sitemap.xml
 *
 * Lists EXACTLY the client's published, indexable pieces (acceptance criterion
 * 5) — one `<url>` per `status='published'` piece, plus the client hub root.
 * Fail-closed: an unknown `[client]` slug -> 404 (no empty sitemap for a
 * non-existent tenant, no cross-client leak). Only published pieces appear (the
 * seam returns published-only).
 *
 * Dynamic (request-time): reads the per-request public seam + derives the base
 * URL from the request origin, so it is never statically baked.
 */

import {
  NOT_WIRED_PUBLIC_DATA_ACCESS,
  type PublicContentDataAccess,
} from "@/lib/content/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface SitemapDeps {
  data: PublicContentDataAccess;
}

const DEFAULT_DEPS: SitemapDeps = { data: NOT_WIRED_PUBLIC_DATA_ACCESS };

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Derive the absolute origin (scheme+host) from the request, fail-safe. */
function originOf(request: Request): string {
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

/**
 * Build the sitemap XML for a client's published pieces. Exported so the SSR
 * test can assert the URL set directly from injected data (no live server).
 */
export function buildSitemapXml(
  origin: string,
  clientSlug: string,
  pieces: Array<{ slug: string; updatedAt: string | null; publishedAt: string | null }>,
): string {
  const base = `${origin}/clients/${encodeURIComponent(clientSlug)}`;
  const urls: string[] = [];
  // The client hub root (the branded homepage, not /blog).
  urls.push(`  <url>\n    <loc>${xmlEscape(base)}</loc>\n  </url>`);
  for (const p of pieces) {
    const loc = `${base}/blog/${encodeURIComponent(p.slug)}`;
    const lastmod = (p.updatedAt ?? p.publishedAt ?? "").slice(0, 10);
    const lastmodTag = lastmod ? `\n    <lastmod>${xmlEscape(lastmod)}</lastmod>` : "";
    urls.push(`  <url>\n    <loc>${xmlEscape(loc)}</loc>${lastmodTag}\n  </url>`);
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.join("\n") +
    `\n</urlset>\n`
  );
}

export async function handleSitemap(
  request: Request,
  clientSlug: string,
  deps: SitemapDeps = DEFAULT_DEPS,
): Promise<Response> {
  const client = await deps.data.resolveClientByBlogSlug(clientSlug);
  if (!client) {
    return new Response("Not found", { status: 404 });
  }
  const pieces = await deps.data.listPublishedPieces(client.id);
  const xml = buildSitemapXml(originOf(request), clientSlug, pieces);
  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ client: string }> },
): Promise<Response> {
  const { client } = await ctx.params;
  return handleSitemap(request, client);
}
