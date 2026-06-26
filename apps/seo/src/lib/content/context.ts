/**
 * Request tenancy context + the mockable data-access seam (PR 005, lane
 * engine-port).
 *
 * THE TENANCY CHOKEPOINT. Every `/content/api/*` call is keyed to exactly one
 * `(workspaceId, clientId)` (criterion 7), and that binding is derived HERE —
 * never trusted from request input. The flow:
 *
 *   1. `bindRequestContext` resolves the operator's workspace from the auth seam
 *      (`apps/seo/src/lib/auth.ts`, DR-003) — the SERVER's notion of "who", not
 *      anything the caller sent.
 *   2. It validates that `clientId` belongs to THAT workspace (the layer-3
 *      workspace_id -> client_id tenancy bridge). A forged/foreign client id
 *      resolves to NOT_OWNED (the route returns 404 — no existence leak).
 *   3. Any route that ALSO receives a request-supplied `workspace_id`/`client_id`
 *      (draft) calls `assertTenancyMatch` to reject a mismatch with a 403
 *      (criterion 2) — request tenancy is checked against the bound context,
 *      never used to widen it.
 *
 * MOCKABLE DATA ACCESS. sagemark has no live Supabase wired (DR-006). The routes
 * talk to the DB ONLY through the `ContentDataAccess` seam, so:
 *   - tests inject a fixture/spy implementation (assert "no DB write" in the
 *     audit read-only test; inject tenancy + voice-spec + piece fixtures);
 *   - the production default is a fail-closed stub that throws a clear
 *     "data access not wired" error rather than silently succeeding.
 *
 * The seam exposes a `writes` counter the audit-read-only test asserts stays at
 * zero — the structural proof that audit cannot mutate.
 *
 * Clean ASCII / UTF-8. No `server-only` marker (imported by plain-Node tests).
 */

import type { Workspace } from "@/lib/auth";
import { getCurrentWorkspace } from "@/lib/auth";
import type { AuthorityClass } from "./contract";
import { verifyBridgeToken, type BridgeTokenRejection } from "@/lib/auth/bridge-token";

// ── Voice-spec shape (the `voice_specs.spec` JSONB v1 field set) ──────────────

/** A named byline + credentials for E-E-A-T (voice_specs.spec.authors[]). */
export interface VoiceSpecAuthor {
  id: string;
  name: string;
  credentials: string;
}

/**
 * The structured v1 voice spec stored in `voice_specs.spec` (JSONB). Mirrors
 * flywheel-main's `VoiceSpecV1`. Only the fields the kernel routes read are
 * modelled here; unknown keys are tolerated.
 */
export interface VoiceSpecV1 {
  tone?: string[];
  register?: string;
  audience?: string;
  bannedLexicon?: string[];
  authors?: VoiceSpecAuthor[];
  pillarLinks?: string[];
  internalLinks?: string[];
  /**
   * The client's preferred authoritative sources. CLASS-(b) client-fact
   * authority: grounds client-specific facts only — NEVER a medical claim.
   * (criterion 5/6.)
   */
  attributionSources?: string[];
  samplePassages?: string[];
}

/** A resolved approved voice-spec row (the hard-stop gate's success shape). */
export interface ApprovedVoiceSpec {
  id: string;
  clientId: string;
  spec: VoiceSpecV1;
  /** Non-null — `requireApprovedVoiceSpec` only returns APPROVED rows. */
  approvedAt: string;
}

// ── Persisted content-piece (the audit/publish read shape) ────────────────────

import type { Verdict, GeoFaqItem } from "@sagemark/core";
// The persisted-row status uses the schema-flywheel `content_status` enum as its
// authority, so the seam's status union can never drift from the DB enum (PR 004).
import type { ContentStatus } from "@sagemark/schema-flywheel";

/**
 * The persisted `content_pieces` row the audit/publish routes read. is_ymyl,
 * verdict, status are read from HERE (never re-derived) so a brief-skipping
 * draft cannot dodge the YMYL path.
 */
export interface ContentPieceRow {
  id: string;
  clientId: string;
  slug: string;
  title: string;
  body: string;
  status: ContentStatus;
  version: number;
  isYmyl: boolean;
  authorId: string | null;
  verdict: Verdict | null;
  /** Whether a usable scorecard was persisted (the eval actually ran). */
  evalScore: number | null;
  faqData: GeoFaqItem[] | null;
  briefSnapshot: PersistedBriefSnapshot | null;
}

/**
 * The brief snapshot persisted on a piece (what the audit gate re-reads). Holds
 * the GRADED sources so the audit can re-apply the authority-class trust layer
 * (criterion 6) without re-fetching.
 */
export interface PersistedBriefSnapshot {
  keyword: string;
  sources: Array<{
    url: string;
    domain: string;
    title: string;
    snippet: string;
    fetchedAt: string;
    authorityClass: AuthorityClass;
  }>;
  isYmyl: boolean;
}

/** A recorded human release the publish route reads (credentialed vs signoff). */
export interface PersistedRelease {
  releaseType: "credentialed_release" | "client_signoff";
  actorId: string;
  /** Present only on a credentialed release. */
  credential?: { name?: string; credentials?: string };
  /** FK → byline_authorizations; present only on a credentialed release. */
  authorizationId?: string;
}

/** A byline-authorization row (the §11.5 consent record). */
export interface PersistedAuthorization {
  id: string;
  revokedAt: string | null;
  expiresAt: string | null;
}

/**
 * A persisted `gate_results` row projection (RFC §, migration 0033). The publish
 * gate reads `evalRan` from HERE — the authoritative record of whether the eval
 * actually RAN and produced a usable scorecard — never inferring it from the
 * loose `verdict != null` heuristic (audit-002 A.011.7: a Stage-A veto sets a
 * verdict with no eval_score, which the heuristic would mis-read as evalRan=true).
 */
export interface PersistedGateResult {
  /** Whether the eval actually ran (a usable scorecard was produced). */
  evalRan: boolean;
  /** Stage-B composite, null when a Stage-A veto suppressed scoring. */
  stageBScore: number | null;
  /** The verdict band, or null when no gate has run. */
  verdict: Verdict | null;
  /** Whether sourcing was blocked (the D3 reversal metric). */
  sourcingBlocked: boolean;
}

// ── The data-access seam ──────────────────────────────────────────────────────

/**
 * Insert payload for a host-validated draft write. The route NEVER passes
 * caller-supplied tenancy here — `clientId` is the BOUND client id.
 */
export interface DraftInsert {
  clientId: string;
  slug: string;
  title: string;
  body: string;
  excerpt?: string;
  metaDescription?: string;
  isYmyl: boolean;
  authorId: string | null;
  faqData: GeoFaqItem[] | null;
  briefSnapshot: PersistedBriefSnapshot | null;
}

/**
 * The mockable data-access interface every kernel route uses. READ methods never
 * mutate; the single WRITE method (`insertDraftPiece`) and the single STATUS
 * mutation (`transitionPieceStatus`) are the ONLY mutation paths — and the audit
 * route is wired with NONE of them (it receives a read-only view).
 */
export interface ContentDataAccess {
  /** True iff a `content_clients` row exists with this id AND this workspace. */
  clientBelongsToWorkspace(clientId: string, workspaceId: string): Promise<boolean>;
  /** Resolve the client's APPROVED voice spec, or null (the hard stop). */
  getApprovedVoiceSpec(clientId: string): Promise<ApprovedVoiceSpec | null>;
  /** Load a persisted piece scoped by (pieceId, clientId), or null. */
  loadPiece(pieceId: string, clientId: string): Promise<ContentPieceRow | null>;
  /** The latest recorded release for a piece+version, or null. */
  getRelease(pieceId: string, clientId: string, version: number): Promise<PersistedRelease | null>;
  /** Resolve a byline authorization by id (for the §11.5 active check), or null. */
  getAuthorization(authorizationId: string, clientId: string): Promise<PersistedAuthorization | null>;
  /**
   * The persisted gate_results row for a piece+version, or null when no gate has
   * run. The publish route binds `evalRan` from this row (A.011.7) instead of
   * inferring it from verdict/eval_score.
   */
  getGateResult(
    pieceId: string,
    clientId: string,
    version: number,
  ): Promise<PersistedGateResult | null>;

  // ── Mutations (the audit route is wired with a view that LACKS these) ────────
  /** Host-validated content_pieces insert (draft route only). Returns the new id+slug. */
  insertDraftPiece(insert: DraftInsert): Promise<{ id: string; slug: string }>;
  /** FSM status transition (publish route only). */
  transitionPieceStatus(
    pieceId: string,
    clientId: string,
    to: ContentPieceRow["status"],
  ): Promise<void>;
}

/** The read-only subset the audit route is given. Structurally cannot mutate. */
export type ReadOnlyDataAccess = Pick<
  ContentDataAccess,
  "clientBelongsToWorkspace" | "getApprovedVoiceSpec" | "loadPiece"
>;

// ── Public render seam (PR 015, lane render-geo) ──────────────────────────────

/**
 * A client resolved from its public `blog_slug` (the `[client]` URL segment).
 * The public render route NEVER receives a workspace/client UUID from the URL —
 * it resolves the tenant from the human-facing slug, and every subsequent read
 * is scoped by the resolved `id`. (Multi-tenant: no cross-client serve.)
 */
export interface PublicClient {
  id: string;
  blogSlug: string;
  name: string;
}

/**
 * The PUBLIC projection of a published piece — only the fields the render route
 * needs, and ONLY ever populated for `status='published'` rows (the seam itself
 * filters; the DB RLS anon policy `content_pieces_public_read` is the second,
 * authoritative gate — DR-023). No draft body, no internal fields, leak.
 */
export interface PublishedPiece {
  clientId: string;
  slug: string;
  title: string;
  body: string;
  excerpt: string | null;
  metaDescription: string | null;
  faqData: GeoFaqItem[] | null;
  publishedAt: string | null;
  updatedAt: string | null;
}

/**
 * The fail-closed PUBLIC read seam. Every method is read-only and returns only
 * published rows; a non-published slug resolves to `null` (the route 404s — it
 * NEVER returns the content). Tests inject a fixture impl; production swaps the
 * Drizzle/Supabase impl that runs through the anon (published-only) path.
 */
export interface PublicContentDataAccess {
  /** Resolve a client by its public blog slug, or null if no such client. */
  resolveClientByBlogSlug(blogSlug: string): Promise<PublicClient | null>;
  /**
   * Load a PUBLISHED piece by (clientId, slug). Returns null for a missing slug
   * OR a slug whose piece is in any non-published status (draft/review/approved/
   * archived) — the fail-closed public-read contract (criterion 4).
   */
  loadPublishedPiece(clientId: string, slug: string): Promise<PublishedPiece | null>;
  /**
   * List the client's published+indexable pieces for the sitemap (criterion 5).
   * Only published rows; ordered is the impl's choice.
   */
  listPublishedPieces(clientId: string): Promise<PublishedPiece[]>;
}

/**
 * Production default for the public seam: fail-closed "not wired" — every method
 * throws rather than fabricating/leaking. Swapped for the Drizzle impl by the
 * schema-tenancy lane; injected with a fixture in tests.
 */
export const NOT_WIRED_PUBLIC_DATA_ACCESS: PublicContentDataAccess = {
  resolveClientByBlogSlug: () => {
    throw new DataAccessNotWiredError("resolveClientByBlogSlug");
  },
  loadPublishedPiece: () => {
    throw new DataAccessNotWiredError("loadPublishedPiece");
  },
  listPublishedPieces: () => {
    throw new DataAccessNotWiredError("listPublishedPiece");
  },
};

// ── Production default: fail-closed "not wired" stub (DR-006) ──────────────────

class DataAccessNotWiredError extends Error {
  readonly code = "DATA_ACCESS_NOT_WIRED" as const;
  constructor(op: string) {
    super(
      `content data access is not wired: '${op}' has no live Supabase backend in this build (DR-006). ` +
        `Inject a ContentDataAccess via the route's dependency seam, or wire the Drizzle/Supabase impl.`,
    );
    this.name = "DataAccessNotWiredError";
  }
}

/**
 * The production default. Every method throws `DataAccessNotWiredError` — a route
 * that reaches the DB without an injected impl fails LOUDLY (fail-closed), never
 * silently returns an empty/fabricated result. Swapped for the real Drizzle impl
 * by the schema-tenancy lane; injected with a fixture/spy in tests.
 */
export const NOT_WIRED_DATA_ACCESS: ContentDataAccess = {
  clientBelongsToWorkspace: () => {
    throw new DataAccessNotWiredError("clientBelongsToWorkspace");
  },
  getApprovedVoiceSpec: () => {
    throw new DataAccessNotWiredError("getApprovedVoiceSpec");
  },
  loadPiece: () => {
    throw new DataAccessNotWiredError("loadPiece");
  },
  getRelease: () => {
    throw new DataAccessNotWiredError("getRelease");
  },
  getAuthorization: () => {
    throw new DataAccessNotWiredError("getAuthorization");
  },
  getGateResult: () => {
    throw new DataAccessNotWiredError("getGateResult");
  },
  insertDraftPiece: () => {
    throw new DataAccessNotWiredError("insertDraftPiece");
  },
  transitionPieceStatus: () => {
    throw new DataAccessNotWiredError("transitionPieceStatus");
  },
};

export { DataAccessNotWiredError };

// ── Request tenancy context ───────────────────────────────────────────────────

/**
 * The bound tenancy context. `workspaceId` is the SERVER's resolution of the
 * operator's workspace; `clientId` is validated to belong to it. Every kernel
 * operation runs under exactly this pair (criterion 7).
 */
export interface RequestContext {
  workspaceId: string;
  clientId: string;
}

/** The discriminated result of binding a request context. */
export type BindResult =
  | { ok: true; context: RequestContext }
  | { ok: false; status: 401 | 404; code: "unauthorized" | "not-found" };

/**
 * Resolve + validate the tenancy binding for a request.
 *
 *   - 401 unauthorized   — no authenticated operator/workspace (auth seam).
 *   - 404 not-found      — `clientId` is not owned by the operator's workspace
 *                          (forged/foreign id; no existence leak).
 *   - ok                 — a `(workspaceId, clientId)` bound from the SERVER side.
 *
 * The `workspace` is read from the auth seam (never from request input). This is
 * the layer-2/3 tenancy bridge (RFC §3.4).
 */
export async function bindRequestContext(
  clientId: string,
  data: Pick<ContentDataAccess, "clientBelongsToWorkspace">,
  resolveWorkspace: () => Promise<Workspace | null> = getCurrentWorkspace,
): Promise<BindResult> {
  const workspace = await resolveWorkspace();
  if (!workspace) {
    return { ok: false, status: 401, code: "unauthorized" };
  }
  const owned = await data.clientBelongsToWorkspace(clientId, workspace.id);
  if (!owned) {
    return { ok: false, status: 404, code: "not-found" };
  }
  return { ok: true, context: { workspaceId: workspace.id, clientId } };
}

/**
 * Reject a request whose SUPPLIED tenancy does not match the BOUND context
 * (criterion 2). Returns true when they match; false → the route returns 403.
 * Request tenancy is checked against the binding, NEVER used to widen it.
 */
export function assertTenancyMatch(
  supplied: { workspaceId: string; clientId: string },
  bound: RequestContext,
): boolean {
  return (
    supplied.workspaceId === bound.workspaceId && supplied.clientId === bound.clientId
  );
}

// ── Worker bridge authentication (C.009.1 / DR-018) ───────────────────────────

/**
 * Extract the per-run bearer JWT from an `Authorization: Bearer <jwt>` header,
 * or null if absent/malformed. The worker's `host-tool-bridge.ts` sends EXACTLY
 * this shape on every kernel-route call; an operator-console call sends none.
 */
export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return null;
  const token = m[1]!.trim();
  return token.length > 0 ? token : null;
}

/**
 * The authenticated-request result. `via` records which credential path bound the
 * tenancy: `"bridge"` (a verified per-run worker JWT) or `"session"` (the operator
 * console's auth seam). Both converge to the SAME `context = { workspaceId,
 * clientId }` the kernel routes already use, plus (for the bridge path) the
 * `runId` the token authorized.
 */
export type AuthenticateResult =
  | { ok: true; via: "bridge"; context: RequestContext; runId: string }
  | { ok: true; via: "session"; context: RequestContext }
  | {
      ok: false;
      status: 401 | 403 | 404;
      code: "unauthorized" | "not-found" | BridgeTokenRejection | "client-token-mismatch";
    };

/** Map a `verifyBridgeToken` rejection reason to a stable HTTP status. */
function bridgeRejectionStatus(reason: BridgeTokenRejection): 401 | 403 {
  switch (reason) {
    // Bad credential shape / signature / expiry → 401 (you are not authenticated).
    case "malformed":
    case "bad-signature":
    case "expired":
      return 401;
    // Valid credential, but scoped to a DIFFERENT run/tenant → 403 (forbidden).
    case "wrong-run":
    case "wrong-tenant":
      return 403;
  }
}

/** Injectable seam so route tests verify the bridge path without a live host env. */
export interface BridgeAuthOptions {
  /** HMAC signing secret override (default: host env, read inside verifyBridgeToken). */
  secret?: string;
  /** Clock override (epoch ms) for deterministic expiry tests. */
  nowMs?: number;
}

/**
 * Authenticate a kernel-route request and bind its tenancy (C.009.1 / DR-018).
 *
 * TWO CREDENTIAL PATHS, ONE BOUND CONTEXT:
 *
 *   - WORKER BRIDGE (an `Authorization: Bearer` token is present): the worker has
 *     NO operator session, so the TOKEN is the credential. We verify it
 *     (signature in constant time, then expiry, then scope) against ITS OWN
 *     decoded claims — the authoritative `(ws, cl, run)` comes from the verified
 *     token, NEVER from a request argument. We then REJECT (403) if the request
 *     body's `clientId` disagrees with the token's `cl`: a valid token must not be
 *     reused to act on a different client by passing a different body. A
 *     malformed/expired/bad-signature token is rejected 401; a cross-run /
 *     cross-tenant token is rejected 403. The worker can NEVER widen tenancy.
 *
 *   - OPERATOR SESSION (no Bearer token): the existing `bindRequestContext`
 *     path is used unchanged — resolve the operator's workspace from the auth
 *     seam, validate `clientId` ownership (401 unauth / 404 not-owned).
 *
 * Fail-closed: a worker-shaped request (Bearer present) whose token does not
 * verify NEVER falls through to the operator path or to an unauthenticated bind.
 */
export async function authenticateBridgeRequest(
  request: Request,
  requestedClientId: string,
  data: Pick<ContentDataAccess, "clientBelongsToWorkspace">,
  resolveWorkspace: () => Promise<Workspace | null> = getCurrentWorkspace,
  opts: BridgeAuthOptions = {},
): Promise<AuthenticateResult> {
  const bearer = extractBearerToken(request);

  // ── Operator-session path (no bearer) — unchanged behavior. ────────────────
  if (!bearer) {
    const bound = await bindRequestContext(requestedClientId, data, resolveWorkspace);
    if (!bound.ok) return bound;
    return { ok: true, via: "session", context: bound.context };
  }

  // ── Worker-bridge path (bearer present) — the token IS the credential. ──────
  // Decode the claims by verifying the token against its OWN claims: this runs
  // the constant-time signature check + the expiry check, while the ws/cl/run
  // self-match is trivially true (we are not widening — we are reading the
  // authoritative scope FROM the token). A second `verifyBridgeToken` would be
  // redundant, so we decode-then-verify in one call against the token's claims.
  const claims = decodeBridgeClaims(bearer);
  if (!claims) {
    return { ok: false, status: 401, code: "malformed" };
  }
  const verified = verifyBridgeToken(
    bearer,
    { workspaceId: claims.ws, clientId: claims.cl, runId: claims.run },
    { secret: opts.secret, nowMs: opts.nowMs },
  );
  if (!verified.ok) {
    return { ok: false, status: bridgeRejectionStatus(verified.reason), code: verified.reason };
  }

  // The body must not disagree with the token. A valid token for client A cannot
  // be reused to act on client B by passing a different body.clientId (403).
  if (requestedClientId && requestedClientId !== verified.claims.cl) {
    return { ok: false, status: 403, code: "client-token-mismatch" };
  }

  // Authoritative tenancy is the TOKEN's — never the body's.
  return {
    ok: true,
    via: "bridge",
    context: { workspaceId: verified.claims.ws, clientId: verified.claims.cl },
    runId: verified.claims.run,
  };
}

/**
 * Decode the claims out of a compact JWS WITHOUT trusting them (no signature
 * check here — `verifyBridgeToken` does the constant-time signature + expiry +
 * scope verification). Used only to read the token's self-asserted `(ws, cl,
 * run)` so we can hand them to `verifyBridgeToken` as the expected scope, making
 * the token its own authority. Returns null on a structurally-malformed token.
 */
function decodeBridgeClaims(
  token: string,
): { ws: string; cl: string; run: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8"),
    ) as { ws?: unknown; cl?: unknown; run?: unknown };
    if (
      typeof payload.ws === "string" &&
      typeof payload.cl === "string" &&
      typeof payload.run === "string"
    ) {
      return { ws: payload.ws, cl: payload.cl, run: payload.run };
    }
    return null;
  } catch {
    return null;
  }
}
