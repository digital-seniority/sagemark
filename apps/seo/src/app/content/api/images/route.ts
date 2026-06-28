/**
 * POST /content/api/images — per-page image request from the worker during hub authoring.
 *
 * Slice 6: the route validates the request + returns a `[photo:slug]` token that
 * the worker embeds in the draft body. The ACTUAL Pexels fetch + persistence is
 * Slice 7 (an async host step); this route intentionally does not block the worker
 * on the image download — it confirms the request was received and provides the
 * token the SSR render path will later resolve.
 *
 * Boundary follows the draft route pattern:
 *   1. Parse + validate (contract version, schema).
 *   2. Authenticate + bind tenancy SERVER-side.
 *   3. Assert tenancy match (403 on mismatch).
 *   4. Enqueue a Pexels fetch (Slice 7 — currently a no-op stub).
 *   5. Return the `[photo:slug]` render token + the query echo for the Pexels step.
 *
 * `PEXELS_API_KEY` is HOST-ONLY — never in `ALLOWED_ENV_KEYS` / worker env.
 * Clean ASCII / UTF-8.
 */

import "server-only";
import { NextResponse } from "next/server";

import { getCurrentWorkspace } from "@/lib/auth";
import type { Workspace } from "@/lib/auth";
import {
  RequestImagesSchema,
  CONTENT_CONTRACT_VERSION,
  checkContractVersion,
} from "@/lib/content/contract";
import {
  authenticateBridgeRequest,
  assertTenancyMatch,
  NOT_WIRED_DATA_ACCESS,
  type ContentDataAccess,
} from "@/lib/content/context";
import { resolveContentDataAccess } from "@/lib/content/resolve-data-access";

export const runtime = "nodejs";
export const maxDuration = 15;

export interface ImagesDeps {
  data: Pick<ContentDataAccess, "clientBelongsToWorkspace">;
  resolveWorkspace: () => Promise<Workspace | null>;
  jwtSecret?: string;
  bridgeNowMs?: () => number;
  /**
   * Slice 7 hook: called with (workspaceId, slug, query, alt) after tenancy is
   * bound. A no-op stub in Slice 6; the live Pexels fetch is wired in Slice 7.
   */
  enqueueImageFetch?: (opts: {
    workspaceId: string;
    clientId: string;
    slug: string;
    query: string;
    alt: string;
  }) => Promise<void>;
}

const DEFAULT_DEPS: ImagesDeps = {
  data: NOT_WIRED_DATA_ACCESS,
  resolveWorkspace: getCurrentWorkspace,
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

export async function handleRequestImages(
  request: Request,
  deps: ImagesDeps = DEFAULT_DEPS,
): Promise<Response> {
  // 1. Parse + validate.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid json", code: "bad-request" }, 400);
  }
  const parsed = RequestImagesSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid request body", code: "bad-request" }, 400);
  }
  const body = parsed.data;

  const mismatch = checkContractVersion(body.contractVersion);
  if (mismatch) return json({ error: "contract version mismatch", ...mismatch }, 409);

  // 2. Authenticate + bind tenancy SERVER-side.
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

  // 3. Assert tenancy match (403).
  if (!assertTenancyMatch({ workspaceId: body.workspaceId, clientId: body.clientId }, ctx)) {
    return json(
      { error: "request tenancy does not match the bound context", code: "tenancy-mismatch" },
      403,
    );
  }

  // 4. Enqueue the image fetch (Slice 7). Currently a no-op; when wired, downloads
  //    the Pexels result → uploads to bucket → inserts generated_images row.
  if (deps.enqueueImageFetch) {
    await deps.enqueueImageFetch({
      workspaceId: ctx.workspaceId,
      clientId: ctx.clientId,
      slug: body.slug,
      query: body.query,
      alt: body.alt,
    }).catch((err) => {
      // Image fetch is best-effort: log but do not fail the worker call.
      console.error("[content/images] image fetch failed (non-fatal)", {
        workspaceId: ctx.workspaceId,
        slug: body.slug,
        message: err instanceof Error ? err.message : "unknown",
      });
    });
  }

  console.log(
    `[content/images] ok workspaceId=${ctx.workspaceId} clientId=${ctx.clientId} slug=${body.slug} query="${body.query.slice(0, 60)}"`,
  );

  // 5. Return the render token. The worker embeds `[photo:<slug>]` in the draft body;
  //    the SSR resolver replaces it with a signed URL once the image is persisted.
  return json(
    {
      contractVersion: CONTENT_CONTRACT_VERSION,
      token: `[photo:${body.slug}]`,
      slug: body.slug,
    },
    200,
  );
}

export async function POST(request: Request): Promise<Response> {
  const data = await resolveContentDataAccess();
  return handleRequestImages(request, { ...DEFAULT_DEPS, data });
}
