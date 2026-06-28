/**
 * POST /api/revise — the DIRECT in-place operator edit (Slice 3, studio UX).
 *
 * The sibling of /api/edit. Where /api/edit is the AGENT-style BOUNDED edit
 * (region + instruction -> a model diff), this is the operator's DIRECT edit: the
 * operator typed the new full body in the studio's markdown editor and saves it.
 * No model is involved (the operator IS the author), so the same loop runs minus
 * the bounded-diff step:
 *
 *   1. AUTH -> bind tenancy SERVER-side (`authenticateBridgeRequest`). Operator
 *      session resolves the workspace + validates `clientId` ownership. Tenancy is
 *      the SERVER's; the body is tenancy-minimal ({ clientId, pieceId, body }), it
 *      never carries a workspaceId to widen with.
 *   2. DRAFT-STATUS guard (409): only a `status='draft'` piece is editable; a
 *      review/approved/published/archived piece is FROZEN.
 *   3. RATE-LIMIT per tenant (429): a runaway save loop cannot hammer the gate/DB.
 *   4. STALE-EDIT guard (409, OPTIONAL): if the client sends `baseVersionHash`
 *      (SHA-256 of the body it loaded) it must equal the current version's hash —
 *      a no-lost-update guard. The single-operator studio may omit it
 *      (last-write-wins); a future multi-editor surface sends it for strictness.
 *   5. FULL GATE RE-RUN: the SAME deterministic `@sagemark/core` `runSeoGate`
 *      (Stage-A vetoes + Stage-B composite) the audit route drives, over the
 *      EDITED body. We drive it, never fork it — a faithfulness-breaking edit is
 *      CAUGHT and its regressed verdict is what gets persisted.
 *   6. APPEND-ONLY VERSION: a NEW `content_piece_versions` row at version+1. A
 *      prior version is NEVER mutated.
 *
 * NO PUBLISH BYPASS: an edit writes a gated DRAFT version; `canPublish` stays the
 * separate fail-closed path. PII rule: log only ids + verdict + version.
 */

import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentWorkspace } from "@/lib/auth";
import type { Workspace } from "@/lib/auth";
import {
  runSeoGate,
  type AuditResult,
  type GateBrief,
  type GateDraft,
  type GateVoiceSpec,
  type Verdict,
} from "@sagemark/core";
import {
  CONTENT_CONTRACT_VERSION,
  checkContractVersion,
} from "@/lib/content/contract";
import {
  authenticateBridgeRequest,
  NOT_WIRED_DATA_ACCESS,
  type ContentDataAccess,
  type ContentPieceRow,
} from "@/lib/content/context";
import { resolveContentDataAccess } from "@/lib/content/resolve-data-access";
import { sourcesForYmylGrounding } from "@/lib/content/serp-fetch";
import { hashBody } from "@/lib/edit/constrained-edit-contract";
import { appendEditedVersion } from "@/lib/edit/version-write";

export const runtime = "nodejs";
export const maxDuration = 60;

const ReviseRequestSchema = z
  .object({
    contractVersion: z.literal(CONTENT_CONTRACT_VERSION).optional(),
    /** Tenancy-minimal: only the client; the workspace is bound SERVER-side. */
    clientId: z.string().uuid(),
    pieceId: z.string().uuid(),
    /** The full edited markdown body the operator typed. */
    body: z.string().min(1),
    /** OPTIONAL SHA-256 (hex) stale-edit guard; omit for last-write-wins. */
    baseVersionHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/, "baseVersionHash must be a 64-char lowercase hex SHA-256")
      .optional(),
  })
  .strict();

/** The FULL gate to re-run (default: the deterministic runSeoGate the audit route drives). */
export type GateRunner = (
  draft: GateDraft,
  brief: GateBrief,
  voiceSpec: GateVoiceSpec,
) => Promise<AuditResult>;

/** A per-tenant fixed-window rate limiter (a runaway save loop is throttled). */
export interface RateLimiter {
  take(tenantKey: string): boolean;
}

export const DEFAULT_REVISE_RATE_LIMIT = { max: 20, windowMs: 60_000 } as const;

export function inProcessRateLimiter(
  cfg: { max: number; windowMs: number } = DEFAULT_REVISE_RATE_LIMIT,
  now: () => number = () => Date.now(),
): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    take(tenantKey: string): boolean {
      const t = now();
      const w = windows.get(tenantKey);
      if (!w || t >= w.resetAt) {
        windows.set(tenantKey, { count: 1, resetAt: t + cfg.windowMs });
        return true;
      }
      if (w.count >= cfg.max) return false;
      w.count += 1;
      return true;
    },
  };
}

export interface ReviseDeps {
  data: ContentDataAccess;
  resolveWorkspace: () => Promise<Workspace | null>;
  runGate: GateRunner;
  rateLimiter: RateLimiter;
  jwtSecret?: string;
  bridgeNowMs?: () => number;
}

const DEFAULT_DEPS: ReviseDeps = {
  data: NOT_WIRED_DATA_ACCESS,
  resolveWorkspace: getCurrentWorkspace,
  runGate: runSeoGate,
  rateLimiter: inProcessRateLimiter(),
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

/** Build the gate brief from the persisted piece — is_ymyl from the row, sources YMYL-filtered. */
function gateBriefFromPiece(piece: ContentPieceRow): GateBrief {
  const snapshotSources = piece.briefSnapshot?.sources ?? [];
  const grounding = sourcesForYmylGrounding(
    snapshotSources.map((s) => ({
      url: s.url,
      domain: s.domain,
      title: s.title,
      snippet: s.snippet,
      fetchedAt: s.fetchedAt,
      authorityClass: s.authorityClass,
    })),
    piece.isYmyl,
  );
  return {
    keyword: piece.briefSnapshot?.keyword ?? piece.title,
    isYmyl: piece.isYmyl,
    sources: grounding.map((s) => ({ url: s.url, title: s.title, snippet: s.snippet })),
  };
}

export async function handleRevise(
  request: Request,
  deps: ReviseDeps = DEFAULT_DEPS,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid json", code: "bad-request" }, 400);
  }
  const parsed = ReviseRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid request body", code: "bad-request" }, 400);
  }
  const body = parsed.data;

  const mismatch = checkContractVersion(body.contractVersion);
  if (mismatch) return json({ error: "contract version mismatch", ...mismatch }, 409);

  // 1. AUTH -> bind tenancy SERVER-side (operator session resolves the workspace +
  //    validates client ownership). 401 unauth / 404 foreign-client.
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

  // 2. Load the piece (scoped by the bound client). Loaded BEFORE the rate-limit
  //    take() so the cheap draft-status guard rejects a frozen piece for free.
  const piece = await deps.data.loadPiece(body.pieceId, ctx.clientId);
  if (!piece) {
    return json({ error: "not found", code: "not-found" }, 404);
  }

  // 3. DRAFT-STATUS guard (409). Only a draft is editable — a reviewed/approved/
  //    published/archived piece is frozen; editing it would mutate a settled artifact.
  if (piece.status !== "draft") {
    return json(
      { error: "piece-not-editable", code: "piece-not-editable", status: piece.status },
      409,
    );
  }

  // 4. RATE-LIMIT per tenant (429), after ownership + editability so a foreign /
  //    frozen-piece caller cannot consume the victim tenant's budget.
  const tenantKey = `${ctx.workspaceId}:${ctx.clientId}`;
  if (!deps.rateLimiter.take(tenantKey)) {
    return json({ error: "edit rate limit exceeded", code: "rate-limited" }, 429);
  }

  // 5. Load the current (highest) version. Its version drives the append; its body
  //    hash drives the OPTIONAL stale-edit guard.
  const latest = await deps.data.loadLatestVersion(body.pieceId, ctx.clientId);
  if (!latest) {
    return json({ error: "piece has no version to edit", code: "no-version" }, 409);
  }
  if (body.baseVersionHash) {
    const currentHash = hashBody(latest.body);
    if (currentHash !== body.baseVersionHash) {
      return json(
        {
          error: "base version is stale — re-base on the current version and retry",
          code: "stale-edit",
          currentHash,
        },
        409,
      );
    }
  }

  // 6. FULL GATE RE-RUN on the EDITED body — the SAME deterministic gate the audit
  //    route drives. A faithfulness-breaking edit regresses its verdict here, and
  //    THAT regressed verdict is what we persist (an edit can't bank a stale PUBLISH).
  let voiceSpec: GateVoiceSpec = {};
  const approved = await deps.data.getApprovedVoiceSpec(ctx.clientId);
  if (approved) {
    voiceSpec = { bannedTerms: approved.spec.bannedLexicon ?? [] };
  }
  const draft: GateDraft = {
    title: piece.title,
    body: body.body, // the EDITED body — the gate re-runs on what changed
    slug: piece.slug,
    faqData: piece.faqData,
    author: piece.authorId ? { id: piece.authorId } : null,
  };
  const brief = gateBriefFromPiece(piece);
  const audit = await deps.runGate(draft, brief, voiceSpec);

  // 7. APPEND-ONLY new version at latest.version + 1, carrying the re-gated verdict.
  let written: { id: string; version: number };
  try {
    written = await appendEditedVersion(deps.data, {
      pieceId: body.pieceId,
      clientId: ctx.clientId,
      baseVersion: latest.version,
      body: body.body,
      verdict: (audit.verdict as Verdict) ?? null,
      dimensions: audit.stageAClean ? audit.dimensions : null,
    });
  } catch (err) {
    console.error("[api/revise] version write failed", {
      workspaceId: ctx.workspaceId,
      clientId: ctx.clientId,
      pieceId: body.pieceId,
      message: err instanceof Error ? err.message : "unknown",
    });
    return json({ error: "edited version could not be saved", code: "persist-failed" }, 500);
  }

  console.log(
    `[api/revise] ok workspaceId=${ctx.workspaceId} clientId=${ctx.clientId} pieceId=${body.pieceId} ` +
      `version=${written.version} verdict=${audit.verdict} score=${audit.score ?? "null"} stageAClean=${audit.stageAClean}`,
  );

  return json(
    {
      contractVersion: CONTENT_CONTRACT_VERSION,
      pieceId: body.pieceId,
      version: written.version,
      verdict: audit.verdict,
      score: audit.score,
      stageAClean: audit.stageAClean,
      failureCodes: audit.failureCodes,
      newHash: hashBody(body.body),
    },
    200,
  );
}

export async function POST(request: Request): Promise<Response> {
  // ACTIVATION (DR-026): resolve the live write-capable data access BEHIND the
  // service-role creds gate (same pattern as /content/api/draft). With no creds
  // this is NOT_WIRED_DATA_ACCESS (fail-closed, unchanged).
  const data = await resolveContentDataAccess();
  return handleRevise(request, { ...DEFAULT_DEPS, data });
}
