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
