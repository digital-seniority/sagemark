/**
 * /api/versions/[id] — the version hub's server actions (P1.U.4 / PR 013).
 *
 *   GET  /api/versions/[id]?clientId=&workspaceId=   -> list a piece's versions
 *   POST /api/versions/[id]  { op: "switch" | "name" } -> switch / name a version
 *
 * `[id]` is the CONTENT PIECE id. The hub switches between / names / compares the
 * piece's append-only `content_piece_versions` (PR 012 / P1.U.3). This route is
 * READS + a NAME (metadata) write only — there is NO destructive delete of a
 * version ANYWHERE in this PR (the undeletable-named-sign-off invariant). The
 * three ops:
 *
 *   - LIST   (GET): read the full version history (reads only — VersionDiff/VersionHub
 *     consume this).
 *   - SWITCH (POST op=switch): select which version is active/displayed — a
 *     pointer/metadata update via `setActiveVersion`. NEVER destroys other versions.
 *   - NAME   (POST op=name): attach a human-readable name to a version (esp. the
 *     sign-off) via `nameVersion`. Append-only metadata. A NAMED SIGN-OFF is
 *     UNDELETABLE + IMMUTABLE: re-naming/overwriting one is rejected (409
 *     signoff-immutable). There is no delete handler at all.
 *
 * The auth->bind->work shape mirrors `/api/edit` (PR 012): `authenticateBridgeRequest`
 * binds tenancy SERVER-side; a request-supplied tenancy that disagrees with the
 * bound context is 403; a foreign client id is 404 (no existence leak). Every
 * version read/write is scoped by the BOUND `clientId` — tenancy is never requested.
 *
 * Handler exported as `handleVersions(...)` for injection. PII rule: log only ids
 * + version + op.
 */

import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentWorkspace } from "@/lib/auth";
import type { Workspace } from "@/lib/auth";
import {
  CONTENT_CONTRACT_VERSION,
  checkContractVersion,
} from "@/lib/content/contract";
import {
  authenticateBridgeRequest,
  assertTenancyMatch,
  NOT_WIRED_DATA_ACCESS,
  SignoffImmutableError,
  type ContentDataAccess,
  type PersistedPieceVersion,
} from "@/lib/content/context";

export const runtime = "nodejs";

// ── Dependency seam ───────────────────────────────────────────────────────────

export interface VersionDeps {
  data: ContentDataAccess;
  resolveWorkspace: () => Promise<Workspace | null>;
  /** Bridge-JWT signing secret override (default: host env). Test-injectable. */
  jwtSecret?: string;
  /** Bridge-JWT clock override (epoch ms) for deterministic expiry tests. */
  bridgeNowMs?: () => number;
}

const DEFAULT_DEPS: VersionDeps = {
  data: NOT_WIRED_DATA_ACCESS,
  resolveWorkspace: getCurrentWorkspace,
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

// ── Request schemas ───────────────────────────────────────────────────────────

/** Tenancy supplied by the caller — NEVER trusted for the bind (criterion 2). */
const TenancySchema = z.object({
  workspaceId: z.string().uuid(),
  clientId: z.string().uuid(),
});

/**
 * The POST body. A discriminated union on `op`:
 *   - switch: select the active/displayed version (pointer update).
 *   - name:   attach a name to a version (esp. the sign-off). Append-only metadata.
 * There is deliberately NO `delete` op — the version history is append-only and a
 * named sign-off is undeletable (P1.U.4 invariant).
 */
const VersionActionSchema = z
  .object({ contractVersion: z.literal(CONTENT_CONTRACT_VERSION).optional() })
  .merge(TenancySchema)
  .and(
    z.discriminatedUnion("op", [
      z.object({ op: z.literal("switch"), version: z.number().int().positive() }),
      z.object({
        op: z.literal("name"),
        version: z.number().int().positive(),
        name: z.string().trim().min(1).max(120),
        /** Mark this named version as the (undeletable) sign-off marker. */
        asSignoff: z.boolean().optional(),
      }),
    ]),
  );

// ── Shared auth/bind (mirrors /api/edit) ──────────────────────────────────────

type Bound =
  | { ok: true; context: { workspaceId: string; clientId: string } }
  | { ok: false; res: Response };

/**
 * Authenticate + bind tenancy SERVER-side, then assert the request-supplied
 * tenancy matches the bound context. 401 unauth / 404 foreign-client / 403
 * tenancy-mismatch. Tenancy is bound, never requested.
 */
async function bindTenancy(
  request: Request,
  pieceId: string,
  supplied: { workspaceId: string; clientId: string },
  deps: VersionDeps,
): Promise<Bound> {
  const bound = await authenticateBridgeRequest(
    request,
    supplied.clientId,
    deps.data,
    deps.resolveWorkspace,
    { secret: deps.jwtSecret, nowMs: deps.bridgeNowMs?.() },
  );
  if (!bound.ok) {
    return { ok: false, res: json({ error: bound.code, code: bound.code }, bound.status) };
  }
  const ctx = bound.context;
  if (!assertTenancyMatch(supplied, ctx)) {
    return {
      ok: false,
      res: json(
        { error: "request tenancy does not match the bound context", code: "tenancy-mismatch" },
        403,
      ),
    };
  }
  // Sanity: a non-uuid piece id is a bad request (the [id] segment is the pieceId).
  if (!z.string().uuid().safeParse(pieceId).success) {
    return { ok: false, res: json({ error: "invalid piece id", code: "bad-request" }, 400) };
  }
  return { ok: true, context: ctx };
}

/** Project a persisted version to the wire shape the hub/diff consume (reads only). */
function toWire(v: PersistedPieceVersion) {
  return {
    id: v.id,
    version: v.version,
    body: v.body,
    verdict: v.verdict,
    snapshotAt: v.snapshotAt,
    name: v.name,
    isActive: v.isActive,
    isSignoff: v.isSignoff,
  };
}

// ── GET: list the piece's version history (reads only) ─────────────────────────

export async function handleVersionsList(
  request: Request,
  pieceId: string,
  deps: VersionDeps = DEFAULT_DEPS,
): Promise<Response> {
  const url = new URL(request.url);
  const supplied = TenancySchema.safeParse({
    workspaceId: url.searchParams.get("workspaceId") ?? "",
    clientId: url.searchParams.get("clientId") ?? "",
  });
  if (!supplied.success) {
    return json({ error: "missing or invalid tenancy", code: "bad-request" }, 400);
  }
  const bound = await bindTenancy(request, pieceId, supplied.data, deps);
  if (!bound.ok) return bound.res;

  // Scoped by the BOUND clientId — never the request's.
  const versions = await deps.data.listPieceVersions(pieceId, bound.context.clientId);
  return json(
    {
      contractVersion: CONTENT_CONTRACT_VERSION,
      pieceId,
      versions: versions
        .slice()
        .sort((a, b) => a.version - b.version)
        .map(toWire),
    },
    200,
  );
}

// ── POST: switch / name (no delete path) ──────────────────────────────────────

export async function handleVersionsAction(
  request: Request,
  pieceId: string,
  deps: VersionDeps = DEFAULT_DEPS,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid json", code: "bad-request" }, 400);
  }
  const parsed = VersionActionSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid request body", code: "bad-request" }, 400);
  }
  const body = parsed.data;

  const mismatch = checkContractVersion(body.contractVersion);
  if (mismatch) return json({ error: "contract version mismatch", ...mismatch }, 409);

  const bound = await bindTenancy(
    request,
    pieceId,
    { workspaceId: body.workspaceId, clientId: body.clientId },
    deps,
  );
  if (!bound.ok) return bound.res;
  const ctx = bound.context;

  if (body.op === "switch") {
    // SWITCH: a pointer/metadata update — select the active version. NEVER destroys
    // any version; the append-only history is untouched.
    const updated = await deps.data.setActiveVersion({
      pieceId,
      clientId: ctx.clientId,
      version: body.version,
    });
    console.log(
      `[api/versions] switch pieceId=${pieceId} clientId=${ctx.clientId} version=${body.version}`,
    );
    return json(
      { contractVersion: CONTENT_CONTRACT_VERSION, op: "switch", version: toWire(updated) },
      200,
    );
  }

  // NAME: attach a human-readable name (append-only metadata). A NAMED SIGN-OFF is
  // immutable — re-naming/overwriting one is rejected (409). There is no delete.
  try {
    const named = await deps.data.nameVersion({
      pieceId,
      clientId: ctx.clientId,
      version: body.version,
      name: body.name,
      asSignoff: body.asSignoff,
    });
    console.log(
      `[api/versions] name pieceId=${pieceId} clientId=${ctx.clientId} version=${body.version} ` +
        `signoff=${Boolean(body.asSignoff)}`,
    );
    return json(
      { contractVersion: CONTENT_CONTRACT_VERSION, op: "name", version: toWire(named) },
      200,
    );
  } catch (err) {
    if (err instanceof SignoffImmutableError) {
      // The undeletable-named-sign-off invariant: a sign-off version cannot be
      // re-named/overwritten. NOTHING applied.
      return json({ error: err.message, code: "signoff-immutable" }, 409);
    }
    throw err;
  }
}

// ── Next 16 dynamic route handlers (async params) ─────────────────────────────

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return handleVersionsList(request, id);
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return handleVersionsAction(request, id);
}
