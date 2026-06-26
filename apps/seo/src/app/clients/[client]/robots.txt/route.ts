/**
 * Per-client robots.txt (PR 015, lane render-geo).
 *
 *   GET /clients/[client]/robots.txt
 *
 * Serves a robots policy that explicitly WELCOMES AI answer engines (the GEO
 * posture — mirrors the vendored whispering-willows demo robots.txt) and points
 * at the client's sitemap (acceptance criterion 5: "robots.txt is served").
 * Fail-closed on tenant existence: an unknown `[client]` slug -> 404.
 *
 * Dynamic (request-time): derives the absolute Sitemap URL from the request
 * origin.
 */

import {
  NOT_WIRED_PUBLIC_DATA_ACCESS,
  type PublicContentDataAccess,
} from "@/lib/content/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface RobotsDeps {
  data: PublicContentDataAccess;
}

const DEFAULT_DEPS: RobotsDeps = { data: NOT_WIRED_PUBLIC_DATA_ACCESS };

/** AI answer-engine crawlers we explicitly allow (GEO posture). */
const AI_BOTS = [
  "GPTBot",
  "OAI-SearchBot",
  "PerplexityBot",
  "Google-Extended",
  "ClaudeBot",
] as const;

function originOf(request: Request): string {
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

/**
 * Build the robots.txt body for a client. Exported so the SSR test can assert
 * the served policy + the absolute Sitemap line from injected data.
 */
export function buildRobotsTxt(origin: string, clientSlug: string): string {
  const base = `${origin}/clients/${encodeURIComponent(clientSlug)}`;
  const lines: string[] = ["User-agent: *", "Allow: /", ""];
  lines.push("# AI answer engines are explicitly welcome to read and cite this content.");
  for (const bot of AI_BOTS) {
    lines.push(`User-agent: ${bot}`, "Allow: /");
  }
  lines.push("", `Sitemap: ${base}/sitemap.xml`, "");
  return lines.join("\n");
}

export async function handleRobots(
  request: Request,
  clientSlug: string,
  deps: RobotsDeps = DEFAULT_DEPS,
): Promise<Response> {
  const client = await deps.data.resolveClientByBlogSlug(clientSlug);
  if (!client) {
    return new Response("Not found", { status: 404 });
  }
  const body = buildRobotsTxt(originOf(request), clientSlug);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ client: string }> },
): Promise<Response> {
  const { client } = await ctx.params;
  return handleRobots(request, client);
}
