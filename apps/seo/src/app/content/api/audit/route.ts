/**
 * POST /content/api/audit — READ-ONLY gate evaluation (runScorers + runGate).
 * Contract: `content-engine/1.0` (PR 005, lane engine-port).
 *
 * THE READ-ONLY ENFORCEMENT BOUNDARY (criterion 1). This route runs the
 * non-compensatory SEO gate (Stage-A ordered vetoes -> Stage-B 8-dim composite)
 * over a PERSISTED piece and returns the verdict + Stage-A/Stage-B detail. It
 * MUST NOT mutate `status` or write anything. The proof is STRUCTURAL: the route
 * is wired with a `ReadOnlyDataAccess` view that does not even expose
 * `insertDraftPiece` / `transitionPieceStatus`, so there is no write method to
 * call. The read-only test injects a full spy and asserts the write counters
 * stay at zero.
 *
 * THE YMYL TRUST FILTER (criterion 6). `is_ymyl` is read from the PERSISTED row
 * (never re-derived). For a YMYL piece, ONLY class-(a) medical/statistical
 * authority sources are passed to the gate's faithfulness check
 * (`sourcesForYmylGrounding`), so a numeric/medical claim grounded only in a
 * class-(b) client-fact source or a class-(c) low-authority snippet is UNSOURCED
 * -> `VETO_UNSOURCED_STAT` fires (the string appearing in fetched text or the
 * client's attributionSources[] does NOT clear it).
 *
 * The handler is exported as `handleAudit(request, deps)`; tests inject the
 * read-only data view, the workspace resolver, and the gate runner (so the
 * criterion-1/6 invariants are testable with NO DB and NO LLM key).
 *
 * PII rule: log only ids + verdict + score.
 */

import "server-only";
import { NextResponse } from "next/server";

import { getCurrentWorkspace } from "@/lib/auth";
import type { Workspace } from "@/lib/auth";
import {
  runSeoGate,
  type AuditResult,
  type GateBrief,
  type GateDraft,
  type GateVoiceSpec,
} from "@sagemark/core";
import {
  AuditRequestSchema,
  CONTENT_CONTRACT_VERSION,
  checkContractVersion,
} from "@/lib/content/contract";
import {
  authenticateBridgeRequest,
  assertTenancyMatch,
  type ReadOnlyDataAccess,
  type ContentPieceRow,
} from "@/lib/content/context";
import { resolveReadOnlyDataAccess } from "@/lib/content/resolve-data-access";
import { sourcesForYmylGrounding } from "@/lib/content/serp-fetch";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The gate runner. Defaults to `@sagemark/core`'s `runSeoGate`; injected in tests
 * with a deterministic faithfulness stub so criterion 1/6 are DB-free + key-free.
 */
export type GateRunner = (
  draft: GateDraft,
  brief: GateBrief,
  voiceSpec: GateVoiceSpec,
) => Promise<AuditResult>;

export interface AuditDeps {
  /** READ-ONLY view — structurally cannot mutate (criterion 1). */
  data: ReadOnlyDataAccess;
  resolveWorkspace: () => Promise<Workspace | null>;
  runGate: GateRunner;
  /** Bridge-JWT signing secret override (default: host env). Test-injectable. */
  jwtSecret?: string;
  /** Bridge-JWT clock override (epoch ms) for deterministic expiry tests. */
  bridgeNowMs?: () => number;
}

const DEFAULT_DEPS: AuditDeps = {
  // The production default is supplied by the route's caller (the real Drizzle
  // read view). With no live backend wired, NOT_WIRED_DATA_ACCESS surfaces a
  // loud error rather than a silent empty read — but audit needs read methods, so
  // the production wiring injects them. Tests always inject their own.
  data: {
    clientBelongsToWorkspace: () => {
      throw new Error("audit data access not wired (DR-006) — inject a read view");
    },
    getApprovedVoiceSpec: () => {
      throw new Error("audit data access not wired (DR-006) — inject a read view");
    },
    loadPiece: () => {
      throw new Error("audit data access not wired (DR-006) — inject a read view");
    },
  },
  resolveWorkspace: getCurrentWorkspace,
  runGate: runSeoGate,
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

/** Build the gate brief from the persisted piece — is_ymyl from the row, sources YMYL-filtered. */
function gateBriefFromPiece(piece: ContentPieceRow): GateBrief {
  const snapshotSources = piece.briefSnapshot?.sources ?? [];
  // criterion 6: for YMYL, only class-(a) medical authorities can ground a claim.
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

export async function handleAudit(
  request: Request,
  deps: AuditDeps = DEFAULT_DEPS,
): Promise<Response> {
  // 1. Parse + validate.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid json", code: "bad-request" }, 400);
  }
  const parsed = AuditRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid request body", code: "bad-request" }, 400);
  }
  const body = parsed.data;

  const mismatch = checkContractVersion(body.contractVersion);
  if (mismatch) return json({ error: "contract version mismatch", ...mismatch }, 409);

  // 2. Authenticate + bind tenancy SERVER-side (criterion 7). A worker call
  //    carrying a Bearer per-run JWT is authenticated by the TOKEN (DR-018); an
  //    operator-console call (no bearer) uses the unchanged session path.
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

  // 3. REJECT a request-supplied tenancy mismatch (403).
  if (!assertTenancyMatch({ workspaceId: body.workspaceId, clientId: body.clientId }, ctx)) {
    return json(
      { error: "request tenancy does not match the bound context", code: "tenancy-mismatch" },
      403,
    );
  }

  // 4. Load the persisted piece (scoped by client). is_ymyl read from HERE.
  const piece = await deps.data.loadPiece(body.pieceId, ctx.clientId);
  if (!piece) {
    return json({ error: "not found", code: "not-found" }, 404);
  }

  // 5. Resolve the voice spec (banned lexicon) best-effort — a missing approved
  //    spec is non-fatal to AUDIT (the gate degrades; fail-closed applies to
  //    PUBLISH, not to producing a blocking scorecard).
  let voiceSpec: GateVoiceSpec = {};
  const approved = await deps.data.getApprovedVoiceSpec(ctx.clientId);
  if (approved) {
    voiceSpec = { bannedTerms: approved.spec.bannedLexicon ?? [] };
  }

  // 6. Run the gate (READ-ONLY). Never throws — a scorer failure is a fail-closed
  //    VETO_EVAL_FAILED. NOTHING is persisted: no status mutation, no scorecard
  //    write. The verdict is returned to the caller, which decides what to do.
  const draft: GateDraft = {
    title: piece.title,
    body: piece.body,
    slug: piece.slug,
    faqData: piece.faqData,
    author: piece.authorId ? { id: piece.authorId } : null,
  };
  const brief = gateBriefFromPiece(piece);
  const audit = await deps.runGate(draft, brief, voiceSpec);

  console.log(
    `[content/audit] ok workspaceId=${ctx.workspaceId} clientId=${ctx.clientId} pieceId=${body.pieceId} verdict=${audit.verdict} score=${audit.score ?? "null"} stageAClean=${audit.stageAClean}`,
  );

  return json(
    {
      contractVersion: CONTENT_CONTRACT_VERSION,
      verdict: audit.verdict,
      score: audit.score,
      dimensions: audit.dimensions,
      failureCodes: audit.failureCodes,
      stageAClean: audit.stageAClean,
      // The piece's persisted status is REPORTED, never changed by audit.
      status: piece.status,
    },
    200,
  );
}

export async function POST(request: Request): Promise<Response> {
  // ACTIVATION (DR-026): resolve the live READ-ONLY view BEHIND the service-role
  // creds gate. With no creds set this returns the fail-closed default (which
  // throws "inject a read view") — UNCHANGED behavior. The view is structurally
  // read-only (a Pick<> of three read methods) so audit can never mutate.
  const data = await resolveReadOnlyDataAccess();
  return handleAudit(request, { ...DEFAULT_DEPS, data });
}
