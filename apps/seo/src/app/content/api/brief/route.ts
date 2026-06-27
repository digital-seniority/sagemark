/**
 * POST /content/api/brief — SERP-grounded, SSRF-guarded brief builder.
 * Contract: `content-engine/1.0` (PR 005, lane engine-port).
 *
 * A host-side tool the worker calls. Pipeline:
 *   1. Parse + validate (contract version, body).
 *   2. Bind tenancy server-side: resolve the operator's workspace (auth seam),
 *      validate `clientId` belongs to it (404 on a forged/foreign id). Every
 *      call is keyed to exactly one (workspaceId, clientId) (criterion 7).
 *   3. HARD STOP unless an APPROVED voice spec exists (409) — no default voice.
 *   4. Fetch the SERP + top pages, SSRF-guarded + content-capped (criterion 4).
 *   5. Grade every source: canonical URL + domain + fetched-at + authority class
 *      (a/b/c), dedupe near-duplicates, honor robots (criterion 5).
 *   6. Return the brief with graded `sources` + the contract version stamp.
 *
 * The route NEVER mutates. Fetched page text is UNTRUSTED — stored as snippet
 * data only, never executed, never re-injected verbatim into a privileged path.
 *
 * The handler is exported as `handleBrief(request, deps)` so tests inject the
 * data-access seam, the auth/workspace resolver, the SERP fetcher, and the clock
 * (no live Supabase, no network). `POST` wires the production defaults.
 *
 * PII rule: log only ids + keyword length + source count.
 */

import "server-only";
import { NextResponse } from "next/server";

import { getCurrentWorkspace } from "@/lib/auth";
import type { Workspace } from "@/lib/auth";
import {
  BriefRequestSchema,
  CONTENT_CONTRACT_VERSION,
  checkContractVersion,
  type BriefSource,
} from "@/lib/content/contract";
import {
  authenticateBridgeRequest,
  NOT_WIRED_DATA_ACCESS,
  type ContentDataAccess,
} from "@/lib/content/context";
import { resolveContentDataAccess } from "@/lib/content/resolve-data-access";
import {
  assembleSources,
  attributionDomainSet,
  fetchPageText,
  type Fetcher,
  type RawSerpResult,
} from "@/lib/content/serp-fetch";

export const runtime = "nodejs";
export const maxDuration = 30;

/** A SERP provider: keyword -> raw organic results (already URL+title+snippet). */
export type SerpProvider = (keyword: string, fetcher: Fetcher) => Promise<RawSerpResult[]>;

export interface BriefDeps {
  data: ContentDataAccess;
  resolveWorkspace: () => Promise<Workspace | null>;
  serpProvider: SerpProvider;
  fetcher: Fetcher;
  now: () => Date;
  /** Bridge-JWT signing secret override (default: host env). Test-injectable. */
  jwtSecret?: string;
  /** Bridge-JWT clock override (epoch ms) for deterministic expiry tests. */
  bridgeNowMs?: () => number;
}

/** Production default SERP provider — DuckDuckGo HTML SERP, SSRF-guarded per fetch. */
const DEFAULT_SERP_PROVIDER: SerpProvider = async (keyword, fetcher) => {
  const params = new URLSearchParams({ q: keyword });
  let html = "";
  try {
    const res = await fetcher(`https://html.duckduckgo.com/html/?${params.toString()}`, {
      headers: { Accept: "text/html" },
    });
    if (res.ok) html = await res.text();
  } catch {
    return [];
  }
  return parseDuckDuckGo(html);
};

/** Parse DuckDuckGo HTML SERP into raw results (top MAX_SOURCES). */
function parseDuckDuckGo(html: string): RawSerpResult[] {
  const results: RawSerpResult[] = [];
  if (!html) return results;
  const linkRe = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null && results.length < 10) {
    const href = m[1] ?? "";
    const title = (m[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const url = extractRealUrl(href);
    if (!url || !title) continue;
    results.push({ url, title, snippet: "" });
  }
  return results;
}

function extractRealUrl(href: string): string {
  if (href.includes("duckduckgo.com/l/")) {
    try {
      const parsed = new URL(href.startsWith("//") ? `https:${href}` : href);
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) return decodeURIComponent(uddg);
    } catch {
      return "";
    }
  }
  if (!href.startsWith("http")) return "";
  return href;
}

const DEFAULT_DEPS: BriefDeps = {
  data: NOT_WIRED_DATA_ACCESS,
  resolveWorkspace: getCurrentWorkspace,
  serpProvider: DEFAULT_SERP_PROVIDER,
  fetcher: fetch,
  now: () => new Date(),
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

export async function handleBrief(
  request: Request,
  deps: BriefDeps = DEFAULT_DEPS,
): Promise<Response> {
  // 1. Parse + validate.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid json", code: "bad-request" }, 400);
  }
  const parsed = BriefRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid request body", code: "bad-request" }, 400);
  }
  const body = parsed.data;

  // Contract-version handshake (criterion 8).
  const mismatch = checkContractVersion(body.contractVersion);
  if (mismatch) return json({ error: "contract version mismatch", ...mismatch }, 409);

  // 2. Authenticate + bind tenancy SERVER-side (criterion 7). A worker call
  //    carrying a Bearer per-run JWT is authenticated by the TOKEN (DR-018); an
  //    operator-console call (no bearer) uses the unchanged session path. Either
  //    way the bound (workspaceId, clientId) is the SERVER's, never the body's.
  const bound = await authenticateBridgeRequest(
    request,
    body.clientId,
    deps.data,
    deps.resolveWorkspace,
    { secret: deps.jwtSecret, nowMs: deps.bridgeNowMs?.() },
  );
  if (!bound.ok) {
    return json({ error: bound.code, code: bound.code }, bound.status);
  }
  const ctx = bound.context;

  // 3. HARD STOP — refuse unless an APPROVED voice spec exists (criterion 2 sibling).
  const voiceSpec = await deps.data.getApprovedVoiceSpec(ctx.clientId);
  if (!voiceSpec) {
    return json(
      {
        error: "client has no approved voice spec — approve one before drafting",
        code: "no-approved-voice-spec",
      },
      409,
    );
  }

  // 4. Fetch SERP + top page bodies (SSRF-guarded inside fetchPageText).
  const serpResults = await deps.serpProvider(body.keyword, deps.fetcher);
  const top = serpResults.slice(0, 3);
  const pageTexts = await Promise.all(
    top.map((r) => fetchPageText(r.url, deps.fetcher)),
  );
  const withText: RawSerpResult[] = serpResults.map((r, i) => ({
    url: r.url,
    title: r.title,
    // null (SSRF-blocked) or "" (fetch failed) → fall back to the SERP snippet.
    snippet: (i < pageTexts.length && pageTexts[i]) || r.snippet,
  }));

  // 5. Grade + dedupe sources (authority class a/b/c, near-dup drop).
  const attributionDomains = attributionDomainSet(voiceSpec.spec.attributionSources);
  const sources: BriefSource[] = assembleSources(withText, attributionDomains, deps.now);

  const groundingQuality: "good" | "partial" | "none" =
    sources.length >= 3 ? "good" : sources.length >= 1 ? "partial" : "none";

  console.log(
    `[content/brief] ok workspaceId=${ctx.workspaceId} clientId=${ctx.clientId} kwLen=${body.keyword.length} sourceCount=${sources.length} grounding=${groundingQuality}`,
  );

  return json(
    {
      contractVersion: CONTENT_CONTRACT_VERSION,
      keyword: body.keyword,
      audience: body.audience,
      sources,
      sourcesFound: sources.length,
      groundingQuality,
    },
    200,
  );
}

export async function POST(request: Request): Promise<Response> {
  // ACTIVATION (DR-026): resolve the live ContentDataAccess BEHIND the service-role
  // creds gate. With no creds set this returns NOT_WIRED_DATA_ACCESS (today's
  // fail-closed default) — the route behaves EXACTLY as before. The rest of the
  // deps (SERP provider, fetcher, clock, auth) keep their production defaults.
  const data = await resolveContentDataAccess();
  return handleBrief(request, { ...DEFAULT_DEPS, data });
}
