/**
 * POST /content/api/draft — host-validated `content_pieces` write.
 * Contract: `content-engine/1.0` (PR 005, lane engine-port).
 *
 * A host-side tool the worker calls. THE TENANCY-TRUST BOUNDARY:
 *   1. Parse + validate (contract version, body).
 *   2. Bind tenancy SERVER-side: resolve workspace (auth seam), validate
 *      `clientId` ownership (404). The binding is the SERVER's, never the
 *      request's.
 *   3. REJECT (403) any payload whose request-supplied `workspaceId`/`clientId`
 *      does not match the bound context (criterion 2) — request tenancy is
 *      checked against the binding, never used to widen it.
 *   4. HARD STOP unless an APPROVED voice spec exists (409) — no default voice.
 *   5. Resolve the byline author from the approved spec (server-side), write the
 *      content_pieces row in `draft` status scoped by the BOUND client id.
 *
 * The write goes ONLY through the host-validated data-access seam; the route
 * never trusts request tenancy for the insert. The handler is exported as
 * `handleDraft(request, deps)` for injection in tests.
 *
 * PII rule: log only ids + word count.
 */

import "server-only";
import { NextResponse } from "next/server";

import { getCurrentWorkspace } from "@/lib/auth";
import type { Workspace } from "@/lib/auth";
import type { GeoFaqItem } from "@sagemark/core";
import {
  DraftRequestSchema,
  CONTENT_CONTRACT_VERSION,
  checkContractVersion,
} from "@/lib/content/contract";
import {
  bindRequestContext,
  assertTenancyMatch,
  NOT_WIRED_DATA_ACCESS,
  type ContentDataAccess,
  type PersistedBriefSnapshot,
} from "@/lib/content/context";

export const runtime = "nodejs";
export const maxDuration = 30;

export interface DraftDeps {
  data: ContentDataAccess;
  resolveWorkspace: () => Promise<Workspace | null>;
}

const DEFAULT_DEPS: DraftDeps = {
  data: NOT_WIRED_DATA_ACCESS,
  resolveWorkspace: getCurrentWorkspace,
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

/** Narrow an unknown briefSnapshot blob to the typed shape (best-effort). */
function asBriefSnapshot(value: unknown): PersistedBriefSnapshot | null {
  if (
    value &&
    typeof value === "object" &&
    "sources" in value &&
    Array.isArray((value as { sources?: unknown }).sources)
  ) {
    return value as PersistedBriefSnapshot;
  }
  return null;
}

export async function handleDraft(
  request: Request,
  deps: DraftDeps = DEFAULT_DEPS,
): Promise<Response> {
  // 1. Parse + validate.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid json", code: "bad-request" }, 400);
  }
  const parsed = DraftRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid request body", code: "bad-request" }, 400);
  }
  const body = parsed.data;

  const mismatch = checkContractVersion(body.contractVersion);
  if (mismatch) return json({ error: "contract version mismatch", ...mismatch }, 409);

  // 2. Bind tenancy SERVER-side (resolve workspace + validate client ownership).
  const bound = await bindRequestContext(body.clientId, deps.data, deps.resolveWorkspace);
  if (!bound.ok) {
    return json({ error: bound.code, code: bound.code }, bound.status);
  }
  const ctx = bound.context;

  // 3. REJECT a request-supplied tenancy that does not match the binding (403).
  //    This is the criterion-2 trust boundary: request tenancy is never trusted.
  if (!assertTenancyMatch({ workspaceId: body.workspaceId, clientId: body.clientId }, ctx)) {
    return json(
      { error: "request tenancy does not match the bound context", code: "tenancy-mismatch" },
      403,
    );
  }

  // 4. HARD STOP — refuse creation unless an APPROVED voice spec exists.
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

  // 5. Resolve the byline author SERVER-side from the approved spec; write the row
  //    scoped by the BOUND client id (never the request's).
  const authorId = voiceSpec.spec.authors?.[0]?.id ?? null;
  const faqData = (body.faqData ?? null) as GeoFaqItem[] | null;
  const briefSnapshot = asBriefSnapshot(body.briefSnapshot);

  let inserted: { id: string; slug: string };
  try {
    inserted = await deps.data.insertDraftPiece({
      clientId: ctx.clientId,
      slug: body.slug,
      title: body.title,
      body: body.body,
      excerpt: body.excerpt,
      metaDescription: body.metaDescription,
      isYmyl: body.isYmyl ?? briefSnapshot?.isYmyl ?? false,
      authorId,
      faqData,
      briefSnapshot,
    });
  } catch (err) {
    console.error("[content/draft] persist failed", {
      workspaceId: ctx.workspaceId,
      clientId: ctx.clientId,
      message: err instanceof Error ? err.message : "unknown",
    });
    return json({ error: "draft could not be saved", code: "persist-failed" }, 500);
  }

  const wordCount = body.body.split(/\s+/).filter(Boolean).length;
  console.log(
    `[content/draft] ok workspaceId=${ctx.workspaceId} clientId=${ctx.clientId} pieceId=${inserted.id} wordCount=${wordCount}`,
  );

  return json(
    {
      contractVersion: CONTENT_CONTRACT_VERSION,
      pieceId: inserted.id,
      slug: inserted.slug,
      status: "draft",
    },
    200,
  );
}

export async function POST(request: Request): Promise<Response> {
  return handleDraft(request);
}
