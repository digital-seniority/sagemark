/**
 * POST /api/edit — the bounded conversational fine-tune (PR 012 / P1.U.3).
 *
 * THE SLICE-1 EDIT FLOOR. This closes the Slice-1 loop: brief -> draft -> gate ->
 * persist -> render -> **one bounded edit -> re-gate -> gated version**. An
 * operator (or the agent UI) asks for a scoped change to ONE region of a piece;
 * the route:
 *
 *   1. AUTH -> bind tenancy SERVER-side (`authenticateBridgeRequest`). The
 *      workspace is the SERVER's resolution of "who"; `clientId` is validated to
 *      belong to it. A foreign client id is 404 (no existence leak); a request
 *      tenancy that disagrees with the bound context is 403 (criterion 2/7).
 *      WORKSPACE-OWNERSHIP guard => 403/404.
 *   2. RATE-LIMIT per tenant (criterion: a runaway edit loop cannot hammer the
 *      model/DB). Over the per-tenant window => 429, NOTHING applied.
 *   3. STALE-EDIT guard: the request's `baseVersionHash` (SHA-256 of the body the
 *      operator saw) MUST equal the current persisted version's hash. A stale
 *      edit => 409, NOTHING applied — a no-lost-update guard.
 *   4. BOUNDED EDIT: resolve the addressed region to an exact span, call the
 *      injected `EditModel` for a bounded diff (scoped replacement + summary, NOT
 *      a free rewrite), and splice ONLY that span. An edit that breaks its bound
 *      (bad region / oversized replacement) => 422, NOTHING applied.
 *   5. FULL GATE RE-RUN: the SAME `@sagemark/core` gate (faithfulness +
 *      seo-gate Stage-A/Stage-B) runs over the EDITED body. We drive the gate; we
 *      do NOT fork it. A faithfulness-breaking edit is CAUGHT here — its verdict
 *      regresses and that regressed verdict is what gets persisted.
 *   6. APPEND-ONLY VERSION: a NEW `content_piece_versions` row at version+1 with
 *      the edited body + the re-gated verdict/dimensions. A prior version is NEVER
 *      mutated.
 *
 * NO PUBLISH BYPASS. An edit writes a draft version + re-gates. It NEVER
 * publishes; `canPublish` stays the separate fail-closed path (PR 009). The
 * faithfulness gate runs a DIFFERENT model from any drafter (drafter != verifier
 * preserved).
 *
 * The live model edit is a Tier-3 NEEDS-INPUT seam: with no provider key, the
 * route's `EditModel` is injected in tests with a deterministic bounded diff, so
 * the contract / guards / versioning / gate-re-run logic is fully unit-tested.
 *
 * Handler exported as `handleEdit(request, deps)` for injection. PII rule: log
 * only ids + verdict + version.
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
  assertTenancyMatch,
  NOT_WIRED_DATA_ACCESS,
  type ContentDataAccess,
  type ContentPieceRow,
} from "@/lib/content/context";
import { sourcesForYmylGrounding } from "@/lib/content/serp-fetch";
import {
  ConstrainedEditRequestSchema,
  applyBoundedEdit,
  resolveRegion,
  hashBody,
  EditBoundExceededError,
  type BoundedDiff,
  type EditRegion,
  type ResolvedSpan,
} from "@/lib/edit/constrained-edit-contract";
import {
  checkBaseVersionHash,
  appendEditedVersion,
} from "@/lib/edit/version-write";

export const runtime = "nodejs";
export const maxDuration = 60;

// ── The bounded-edit request body (tenancy + region/instruction/baseHash) ──────

const EditRequestSchema = z
  .object({
    contractVersion: z.literal(CONTENT_CONTRACT_VERSION).optional(),
    /** Request-supplied tenancy — NEVER trusted for the bind (criterion 2). */
    workspaceId: z.string().uuid(),
    clientId: z.string().uuid(),
    pieceId: z.string().uuid(),
  })
  // The bounded-edit body (region + instruction + baseVersionHash).
  .merge(ConstrainedEditRequestSchema)
  .strict();

// ── The live-model seam (Tier-3 NEEDS-INPUT) ──────────────────────────────────

/**
 * The bounded-edit model. Given the region's current text + the instruction +
 * the grounding sources, it returns a bounded diff (scoped replacement +
 * summary). The production impl routes through the metered AI Gateway with
 * `seo-edit.system.md`; tests inject a deterministic stub so the contract /
 * guards / versioning / gate-re-run are exercised with NO provider key.
 */
export type EditModel = (input: {
  regionText: string;
  instruction: string;
  sources: GateBrief["sources"];
}) => Promise<BoundedDiff>;

/** Fail-closed default: no provider key in this build (Tier-3 NEEDS-INPUT). */
const NOT_WIRED_EDIT_MODEL: EditModel = () => {
  throw new Error(
    "edit model is not wired: the live bounded-edit call needs a provider key " +
      "(Tier-3 NEEDS-INPUT). Inject an EditModel via EditDeps, or wire the AI Gateway seam.",
  );
};

// ── Per-tenant rate limiter (criterion: 429) ──────────────────────────────────

/**
 * A minimal per-tenant fixed-window rate limiter. Keyed on `(workspaceId,
 * clientId)` so one tenant's edit loop cannot exhaust another's budget — and so a
 * runaway edit loop is throttled (429) before it hammers the model/DB. The
 * default is an in-process window; production swaps a shared (KV) impl. The seam
 * is injectable so the 429 guard is deterministically tested.
 */
export interface RateLimiter {
  /** True iff this tenant is WITHIN the limit (and consumes one token). */
  take(tenantKey: string): boolean;
}

export const DEFAULT_EDIT_RATE_LIMIT = { max: 10, windowMs: 60_000 } as const;

/** Build an in-process fixed-window limiter (default for the route). */
export function inProcessRateLimiter(
  cfg: { max: number; windowMs: number } = DEFAULT_EDIT_RATE_LIMIT,
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

// ── Dependency seam ───────────────────────────────────────────────────────────

/**
 * The gate runner — defaults to `@sagemark/core`'s `runSeoGate` (the SAME gate the
 * audit route drives). Injected in tests with a deterministic faithfulness stub so
 * the full-gate-re-run (and a faithfulness-break being CAUGHT) is DB-free + key-free.
 */
export type GateRunner = (
  draft: GateDraft,
  brief: GateBrief,
  voiceSpec: GateVoiceSpec,
) => Promise<AuditResult>;

export interface EditDeps {
  data: ContentDataAccess;
  resolveWorkspace: () => Promise<Workspace | null>;
  /** The bounded-edit model (Tier-3 NEEDS-INPUT seam). */
  editModel: EditModel;
  /** The FULL gate to re-run on the edited body (default: runSeoGate). */
  runGate: GateRunner;
  /** Per-tenant rate limiter (default: in-process fixed window). */
  rateLimiter: RateLimiter;
  /** Bridge-JWT signing secret override (default: host env). Test-injectable. */
  jwtSecret?: string;
  /** Bridge-JWT clock override (epoch ms) for deterministic expiry tests. */
  bridgeNowMs?: () => number;
}

const DEFAULT_DEPS: EditDeps = {
  data: NOT_WIRED_DATA_ACCESS,
  resolveWorkspace: getCurrentWorkspace,
  editModel: NOT_WIRED_EDIT_MODEL,
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
    isYmyl: piece.isYmyl, // PERSISTED column — authoritative, never re-derived
    sources: grounding.map((s) => ({ url: s.url, title: s.title, snippet: s.snippet })),
  };
}

// ── The handler ───────────────────────────────────────────────────────────────

export async function handleEdit(
  request: Request,
  deps: EditDeps = DEFAULT_DEPS,
): Promise<Response> {
  // 1. Parse + validate.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid json", code: "bad-request" }, 400);
  }
  const parsed = EditRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid request body", code: "bad-request" }, 400);
  }
  const body = parsed.data;

  const mismatch = checkContractVersion(body.contractVersion);
  if (mismatch) return json({ error: "contract version mismatch", ...mismatch }, 409);

  // 2. AUTH -> bind tenancy SERVER-side (the WORKSPACE-OWNERSHIP guard). A worker
  //    call with a Bearer per-run JWT is authenticated by the TOKEN; an operator
  //    call (no bearer) resolves the workspace + validates client ownership.
  //    401 unauth / 404 foreign-client / (below) 403 tenancy-mismatch.
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

  // 3. WORKSPACE-OWNERSHIP (criterion 2): a request-supplied tenancy that does not
  //    match the bound context is rejected (403) — never used to widen tenancy.
  if (!assertTenancyMatch({ workspaceId: body.workspaceId, clientId: body.clientId }, ctx)) {
    return json(
      { error: "request tenancy does not match the bound context", code: "tenancy-mismatch" },
      403,
    );
  }

  // 4. RATE-LIMIT per tenant (429). Keyed on the BOUND tenancy, after the
  //    ownership check (so an unauthenticated/foreign caller is rejected first and
  //    cannot consume the victim tenant's budget).
  const tenantKey = `${ctx.workspaceId}:${ctx.clientId}`;
  if (!deps.rateLimiter.take(tenantKey)) {
    return json({ error: "edit rate limit exceeded", code: "rate-limited" }, 429);
  }

  // 5. Load the persisted piece (scoped by the bound client). is_ymyl/verdict from HERE.
  const piece = await deps.data.loadPiece(body.pieceId, ctx.clientId);
  if (!piece) {
    return json({ error: "not found", code: "not-found" }, 404);
  }

  // 6. STALE-EDIT guard (409). The client's baseVersionHash must equal the SHA-256
  //    of the CURRENT persisted version's body. A stale edit is rejected BEFORE any
  //    model call or write — a no-lost-update guard.
  const stale = await checkBaseVersionHash(
    deps.data,
    body.pieceId,
    ctx.clientId,
    body.baseVersionHash,
  );
  if (!stale.ok) {
    return json(
      {
        error:
          stale.reason === "stale"
            ? "base version is stale — re-base on the current version and retry"
            : "piece has no version to edit",
        code: stale.reason === "stale" ? "stale-edit" : "no-version",
        currentHash: stale.currentHash,
      },
      409,
    );
  }
  const currentBody = stale.current.body;
  const baseVersion = stale.current.version;

  // 7. BOUNDED EDIT. Resolve the region to an exact span (host-computed), call the
  //    model for a bounded diff, and splice ONLY that span. A bound break is 422.
  const region: EditRegion = body.region;
  const brief = gateBriefFromPiece(piece);

  let diff: BoundedDiff;
  let regionText: ResolvedSpan["text"];
  try {
    // Resolve the span first so we can hand the model EXACTLY the region text (and
    // so a bad region is rejected before any model spend).
    regionText = resolveRegion(currentBody, region).text;
  } catch (err) {
    if (err instanceof EditBoundExceededError) {
      return json({ error: err.message, code: "edit-bound-exceeded", reason: err.reason }, 422);
    }
    throw err;
  }

  try {
    diff = await deps.editModel({
      regionText,
      instruction: body.instruction,
      sources: brief.sources,
    });
  } catch (err) {
    console.error("[api/edit] model call failed", {
      workspaceId: ctx.workspaceId,
      clientId: ctx.clientId,
      pieceId: body.pieceId,
      message: err instanceof Error ? err.message : "unknown",
    });
    return json({ error: "edit model failed", code: "edit-model-failed" }, 502);
  }

  let editedBody: string;
  let summary: string;
  try {
    const applied = applyBoundedEdit(currentBody, region, diff);
    editedBody = applied.body;
    summary = applied.summary;
  } catch (err) {
    if (err instanceof EditBoundExceededError) {
      // The edit exceeded its bound (oversized replacement / region drift). Reject
      // — a bounded edit is not a free rewrite. NOTHING applied.
      return json({ error: err.message, code: "edit-bound-exceeded", reason: err.reason }, 422);
    }
    throw err;
  }

  // 8. FULL GATE RE-RUN on the EDITED body — the SAME @sagemark/core gate the audit
  //    route drives (faithfulness + Stage-A/Stage-B). We DRIVE it, never fork it. A
  //    faithfulness-breaking edit is CAUGHT here: its verdict regresses, and THAT
  //    regressed verdict is what we persist (the edit cannot bank a stale PUBLISH).
  let voiceSpec: GateVoiceSpec = {};
  const approved = await deps.data.getApprovedVoiceSpec(ctx.clientId);
  if (approved) {
    voiceSpec = { bannedTerms: approved.spec.bannedLexicon ?? [] };
  }
  const draft: GateDraft = {
    title: piece.title,
    body: editedBody, // the EDITED body — the gate re-runs on what changed
    slug: piece.slug,
    faqData: piece.faqData,
    author: piece.authorId ? { id: piece.authorId } : null,
  };
  const audit = await deps.runGate(draft, brief, voiceSpec);

  // 9. APPEND-ONLY new version at baseVersion + 1, carrying the re-gated verdict +
  //    dimensions. NEVER mutates a prior version. This is the ONLY write.
  let written: { id: string; version: number };
  try {
    written = await appendEditedVersion(deps.data, {
      pieceId: body.pieceId,
      clientId: ctx.clientId,
      baseVersion,
      body: editedBody,
      verdict: (audit.verdict as Verdict) ?? null,
      dimensions: audit.stageAClean ? audit.dimensions : null,
    });
  } catch (err) {
    console.error("[api/edit] version write failed", {
      workspaceId: ctx.workspaceId,
      clientId: ctx.clientId,
      pieceId: body.pieceId,
      message: err instanceof Error ? err.message : "unknown",
    });
    return json({ error: "edited version could not be saved", code: "persist-failed" }, 500);
  }

  console.log(
    `[api/edit] ok workspaceId=${ctx.workspaceId} clientId=${ctx.clientId} pieceId=${body.pieceId} ` +
      `version=${written.version} verdict=${audit.verdict} score=${audit.score ?? "null"} stageAClean=${audit.stageAClean}`,
  );

  // NO PUBLISH BYPASS: we return the new DRAFT version + the re-gate verdict. We do
  // NOT transition status / publish; canPublish stays the separate fail-closed path.
  return json(
    {
      contractVersion: CONTENT_CONTRACT_VERSION,
      pieceId: body.pieceId,
      version: written.version,
      verdict: audit.verdict,
      score: audit.score,
      stageAClean: audit.stageAClean,
      failureCodes: audit.failureCodes,
      summary,
      // The new body hash — the client re-bases its NEXT edit on this.
      newHash: hashBody(editedBody),
    },
    200,
  );
}

export async function POST(request: Request): Promise<Response> {
  return handleEdit(request);
}
