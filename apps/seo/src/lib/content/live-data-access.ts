/**
 * Host-side LIVE ContentDataAccess READ adapter (DR-026, lane schema-tenancy).
 *
 * THE GAP THIS CLOSES. The content-kernel routes talk to the DB ONLY through the
 * `ContentDataAccess` / `PublicContentDataAccess` seams (context.ts). In
 * production those seams run on the fail-closed `NOT_WIRED_*` stubs (every method
 * throws) — there is NO live read impl except the in-memory test fixtures and the
 * C.021.2 `image-resolver.ts` (which wired ONLY the asset resolver). This module
 * is the live READ adapter for the rest of the seam: the SELECT-only methods that
 * load pieces, versions, voice specs, releases, authorizations, gate projections,
 * comment threads, approval events, and the public published-content reads.
 *
 * SCOPE (this PR — DR-026, READ ONLY). Implements the seam's READ methods only.
 * It carries NO write methods (insert/update/transition/nameVersion/setActive/
 * signoff/release writes are a separate write-adapter PR) and is NOT wired into
 * any route — it is built + injectable behind `makeLiveContentReadAccess()` and
 * `makeLivePublicContentReadAccess()`, activated later by a separate
 * human-reviewed wiring PR. Mirrors the image-resolver wiring discipline exactly.
 *
 * SECURITY — SERVICE ROLE BYPASSES RLS (load-bearing). The client is the Supabase
 * SERVICE ROLE (host-side, `server-only`), so RLS is NOT the tenancy boundary
 * here. EVERY query carries an EXPLICIT `.eq("workspace_id", …)` filter; every
 * client-scoped query ALSO carries `.eq("client_id", …)` from the BOUND client
 * arg (never request input). The workspace is resolved from the caller's
 * `clientId` through the `content_clients` tenancy bridge (scoped to that one
 * client id). A cross-tenant id simply produces no row (cross-workspace
 * isolation), never a leak.
 *
 * FAIL-CLOSED (never fail-open). A row that cannot be mapped to its return type
 * (a required column is missing / NULL / unparseable) is treated as NOT-FOUND
 * (single reads → null) or OMITTED (list reads), never returned as a partial /
 * fabricated object. Public reads return ONLY `status='published'` rows.
 *
 * NOTE — `gate_results` is a SEAM PROJECTION, not a table (DR-039). `getGateResult`
 * projects the persisted scorecard fields off the `content_pieces` row
 * (verdict + eval_score + dimensions); there is no `gate_results` table to read.
 *
 * Clean ASCII / UTF-8. No `console.*`. `@supabase/supabase-js` is imported
 * dynamically so importing this module is network-free + cred-free.
 */

import "server-only";

import type {
  ContentDataAccess,
  PublicContentDataAccess,
  ApprovedVoiceSpec,
  VoiceSpecV1,
  ContentPieceRow,
  PersistedBriefSnapshot,
  PersistedPieceVersion,
  PersistedAuthorization,
  PersistedRelease,
  PersistedGateResult,
  PersistedCommentThread,
  PersistedApprovalEvent,
  PublishedPiece,
  PublicClient,
  DraftInsert,
  PieceVersionInsert,
  ClientSignoffInsert,
  CredentialedReleaseInsert,
} from "./context";
import { DataAccessNotWiredError } from "./context";
import type { Verdict, GeoFaqItem } from "@sagemark/core";

// ── Service-role creds (shared shape with the image-resolver) ─────────────────

/**
 * The host service-role creds the live read adapter needs. Same env contract as
 * `image-resolver.readResolverCreds`. Returns null when either is absent, so the
 * factory leaves the seam on its fail-closed `NOT_WIRED_*` default.
 */
export function readReadAdapterCreds(): { url: string; serviceRoleKey: string } | null {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE ??
    "";
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}

// ── The minimal service-role PostgREST surface this adapter reads ──────────────

/**
 * A terminal PostgREST builder: it is awaitable (resolves to `{ data, error }`)
 * and supports the chained read modifiers this adapter uses. Modelled minimally
 * (only the methods used) so the fake client in the test can implement the same
 * shape. `maybeSingle()` returns at most one row (or null); awaiting the builder
 * directly returns the row array.
 */
interface ReaderQuery extends PromiseLike<ReaderResult<Record<string, unknown>[]>> {
  eq(col: string, val: string | number): ReaderQuery;
  in(col: string, vals: string[]): ReaderQuery;
  order(col: string, opts?: { ascending?: boolean }): ReaderQuery;
  limit(n: number): ReaderQuery;
  maybeSingle(): Promise<ReaderResult<Record<string, unknown> | null>>;
}

interface ReaderResult<T> {
  data: T;
  error: unknown;
}

/** The minimal service-role Supabase surface this adapter uses (read-only). */
export interface ReaderSupabase {
  from(table: string): { select(cols: string): ReaderQuery };
}

// ── Small fail-closed coercion helpers (never fabricate) ──────────────────────

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** A REQUIRED string column — null when absent/wrong-typed (→ row omitted). */
function reqString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asBool(v: unknown): boolean {
  return v === true;
}

function asFiniteNumberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asIntOrNull(v: unknown): number | null {
  const n = asFiniteNumberOrNull(v);
  return n === null ? null : Math.trunc(n);
}

/** The schema's content_verdict enum values; anything else → null (fail-closed). */
const VERDICTS = new Set<Verdict>(["PUBLISH", "REVIEW", "REVISE", "REJECT"]);
function asVerdict(v: unknown): Verdict | null {
  return typeof v === "string" && VERDICTS.has(v as Verdict) ? (v as Verdict) : null;
}

/** Pass through an already-parsed jsonb array, else null (fail-closed). */
function asFaqData(v: unknown): GeoFaqItem[] | null {
  return Array.isArray(v) ? (v as GeoFaqItem[]) : null;
}

/** Pass through an already-parsed brief-snapshot jsonb object, else null. */
function asBriefSnapshot(v: unknown): PersistedBriefSnapshot | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const b = v as Record<string, unknown>;
  if (typeof b.keyword !== "string" || !Array.isArray(b.sources)) return null;
  return v as PersistedBriefSnapshot;
}

/** Map a {name?, credentials?} credential jsonb blob; null when not an object. */
function asCredential(v: unknown): { name?: string; credentials?: string } | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const b = v as Record<string, unknown>;
  const out: { name?: string; credentials?: string } = {};
  if (typeof b.name === "string") out.name = b.name;
  if (typeof b.credentials === "string") out.credentials = b.credentials;
  return out;
}

function stringifyErr(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** The Stage-A hard veto code that marks a sourcing block (mirrors core). */
const VETO_UNSOURCED_STAT = "VETO_UNSOURCED_STAT";

/**
 * Project `sourcingBlocked` off the persisted `dimensions` scorecard blob
 * (DR-039: gate_results is a seam projection of the content_pieces row, not a
 * table). True iff the persisted scorecard recorded the `VETO_UNSOURCED_STAT`
 * hard veto. Absent / unparseable dimensions → false (the metric treats absent
 * as not-blocked — a safe, non-fabricating default the consumer reads as
 * "no recorded sourcing block").
 */
function sourcingBlockedFromDimensions(dimensions: unknown): boolean {
  if (!dimensions || typeof dimensions !== "object") return false;
  const codes = (dimensions as Record<string, unknown>).failureCodes;
  if (!Array.isArray(codes)) return false;
  return codes.includes(VETO_UNSOURCED_STAT);
}

// ── Row → return-type mappers (all fail-closed) ───────────────────────────────

/**
 * Map a `content_pieces` row to `ContentPieceRow`. Returns null when a REQUIRED
 * field (id / slug / title / status) is missing/unparseable — fail-closed
 * not-found, never a partial. `body` defaults to "" (the schema default).
 */
function mapPiece(row: Record<string, unknown>): ContentPieceRow | null {
  const id = reqString(row.id);
  const clientId = reqString(row.client_id);
  const slug = reqString(row.slug);
  const title = reqString(row.title);
  const status = reqString(row.status);
  if (!id || !clientId || !slug || !title || !status) return null;
  return {
    id,
    clientId,
    slug,
    title,
    body: asString(row.body) ?? "",
    status: status as ContentPieceRow["status"],
    version: asIntOrNull(row.version) ?? 1,
    isYmyl: asBool(row.is_ymyl),
    authorId: asStringOrNull(row.author_id),
    verdict: asVerdict(row.verdict),
    evalScore: asIntOrNull(row.eval_score),
    faqData: asFaqData(row.faq_data),
    briefSnapshot: asBriefSnapshot(row.brief_snapshot),
  };
}

/**
 * Map a `content_piece_versions` row to `PersistedPieceVersion`. Returns null
 * when a REQUIRED field (id / piece_id / client_id / version / body) is absent.
 * The `name`/`isActive`/`isSignoff` columns are a DEFERRED MIGRATION the schema
 * lane owns (see context.ts) — they do not exist on the table yet, so this
 * projects them to the fail-closed defaults (null / false / false). A live write
 * adapter that adds those columns will widen this mapper.
 */
function mapVersion(row: Record<string, unknown>): PersistedPieceVersion | null {
  const id = reqString(row.id);
  const pieceId = reqString(row.piece_id);
  const clientId = reqString(row.client_id);
  const version = asIntOrNull(row.version);
  const body = asString(row.body);
  const snapshotAt = reqString(row.snapshot_at);
  if (!id || !pieceId || !clientId || version === null || body === null || !snapshotAt) {
    return null;
  }
  return {
    id,
    pieceId,
    clientId,
    version,
    body,
    verdict: asVerdict(row.verdict),
    snapshotAt,
    // Deferred-migration columns: default unnamed / inactive / not-a-signoff.
    name: asStringOrNull(row.name),
    isActive: asBool(row.is_active),
    isSignoff: asBool(row.is_signoff),
  };
}

/**
 * Map a `byline_authorizations` row to `PersistedAuthorization` (A.005.1 /
 * DR-039 widened projection). Carries `grantedAt` + `scope` + `revokedAt` +
 * `expiresAt` + `credential` + `placeholder` — the §11.5 active predicate
 * fail-closes when these are absent (`isAuthorizationActive`), so a row that
 * cannot supply its `id` is treated as not-found. The nullable timestamp columns
 * pass through as null when absent (the predicate then reads them as
 * unset/unparseable → inactive), never fabricated.
 */
function mapAuthorization(row: Record<string, unknown>): PersistedAuthorization | null {
  const id = reqString(row.id);
  if (!id) return null;
  return {
    id,
    grantedAt: asStringOrNull(row.granted_at),
    revokedAt: asStringOrNull(row.revoked_at),
    expiresAt: asStringOrNull(row.expires_at),
    credential: asCredential(row.credential),
    scope: asStringOrNull(row.scope) ?? undefined,
    placeholder: asBool(row.placeholder),
  };
}

/**
 * Map a `content_pieces` row to the PUBLIC `PublishedPiece` projection. Only ever
 * called on rows already filtered to `status='published'`. Returns null when a
 * REQUIRED field (client_id / slug / title) is absent — fail-closed (the route
 * 404s). `clusterRole`/`funnelStage` (D7, migration 0031) pass through as null
 * when uncategorized.
 */
function mapPublished(row: Record<string, unknown>): PublishedPiece | null {
  const clientId = reqString(row.client_id);
  const slug = reqString(row.slug);
  const title = reqString(row.title);
  if (!clientId || !slug || !title) return null;
  return {
    clientId,
    slug,
    title,
    body: asString(row.body) ?? "",
    excerpt: asStringOrNull(row.excerpt),
    metaDescription: asStringOrNull(row.meta_description),
    faqData: asFaqData(row.faq_data),
    publishedAt: asStringOrNull(row.published_at),
    updatedAt: asStringOrNull(row.updated_at),
    clusterRole: asStringOrNull(row.cluster_role),
    funnelStage: asStringOrNull(row.funnel_stage),
  };
}

/**
 * Map a `comment_threads` row to `PersistedCommentThread`. Returns null when a
 * REQUIRED field (id / piece_id / client_id / version / kind / author / status /
 * created_at) is absent. The `anchor` jsonb passes through as a typed object or
 * null.
 */
function mapCommentThread(row: Record<string, unknown>): PersistedCommentThread | null {
  const id = reqString(row.id);
  const pieceId = reqString(row.piece_id);
  const clientId = reqString(row.client_id);
  const version = asIntOrNull(row.version);
  const kind = reqString(row.kind);
  const author = reqString(row.author);
  const status = reqString(row.status);
  const createdAt = reqString(row.created_at);
  if (
    !id || !pieceId || !clientId || version === null || !kind ||
    !author || !status || !createdAt
  ) {
    return null;
  }
  let anchor: PersistedCommentThread["anchor"] = null;
  const a = row.anchor;
  if (a && typeof a === "object" && !Array.isArray(a)) {
    const o = a as Record<string, unknown>;
    anchor = {
      x: asFiniteNumberOrNull(o.x) ?? undefined,
      y: asFiniteNumberOrNull(o.y) ?? undefined,
      elementHint: asStringOrNull(o.elementHint) ?? undefined,
    };
  }
  return {
    id,
    pieceId,
    clientId,
    version,
    kind,
    anchor,
    body: asString(row.body) ?? "",
    author,
    status,
    createdAt,
  };
}

// ── The live READ adapter ─────────────────────────────────────────────────────

/**
 * Live, service-role-backed implementation of the READ surface of
 * `ContentDataAccess` + `PublicContentDataAccess`. Every method applies an
 * EXPLICIT tenancy filter (workspace_id, and client_id for client-scoped reads).
 * It implements NO write method (the typed factory exposes a `Pick<>` of the read
 * methods only, so a write call is impossible at the type level).
 */
export class LiveContentReadAccess {
  constructor(private readonly supabase: ReaderSupabase) {}

  /**
   * Resolve `clientId` → `workspaceId` via the `content_clients` tenancy bridge,
   * scoped to that single client id. Returns null when no such client row exists
   * (→ every downstream read resolves to nothing — fail-closed). Identical bridge
   * to image-resolver's `resolveWorkspaceId`.
   */
  private async resolveWorkspaceId(clientId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from("content_clients")
      .select("workspace_id")
      .eq("id", clientId)
      .maybeSingle();
    if (error) {
      throw new Error(
        `live-data-access: content_clients lookup failed for client=${clientId}: ${stringifyErr(error)}`,
      );
    }
    return data ? asStringOrNull(data.workspace_id) : null;
  }

  // ── ContentDataAccess read methods ──────────────────────────────────────────

  /**
   * True iff a `content_clients` row exists with this id AND this workspace. The
   * EXPLICIT (id, workspace_id) filter IS the tenancy bridge — a foreign client
   * id, or this client id under a different workspace, resolves to no row → false.
   */
  async clientBelongsToWorkspace(clientId: string, workspaceId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("content_clients")
      .select("id")
      .eq("id", clientId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) {
      throw new Error(
        `live-data-access: clientBelongsToWorkspace failed for client=${clientId}: ${stringifyErr(error)}`,
      );
    }
    return Boolean(data && reqString(data.id));
  }

  /**
   * Resolve the client's APPROVED voice spec, or null. Filtered by the bound
   * `client_id` AND `approved_at IS NOT NULL` (modelled as an explicit
   * not-null-ordering read — the highest version with a non-null approved_at).
   * Fail-closed: a spec with a null/absent `approved_at` is NOT returned (the
   * hard-stop gate refuses an unapproved spec).
   */
  async getApprovedVoiceSpec(clientId: string): Promise<ApprovedVoiceSpec | null> {
    const { data, error } = await this.supabase
      .from("voice_specs")
      .select("id, client_id, spec, approved_at, version")
      .eq("client_id", clientId)
      .order("version", { ascending: false });
    if (error) {
      throw new Error(
        `live-data-access: getApprovedVoiceSpec failed for client=${clientId}: ${stringifyErr(error)}`,
      );
    }
    const rows = data ?? [];
    for (const row of rows) {
      const approvedAt = asStringOrNull(row.approved_at);
      // Fail-closed: only an APPROVED spec (approved_at present) qualifies.
      if (!approvedAt) continue;
      const id = reqString(row.id);
      const rowClientId = reqString(row.client_id);
      const spec = row.spec;
      if (!id || !rowClientId || !spec || typeof spec !== "object") continue;
      return {
        id,
        clientId: rowClientId,
        spec: spec as VoiceSpecV1,
        approvedAt,
      };
    }
    return null;
  }

  /**
   * Load a persisted piece scoped by (pieceId, clientId), or null. The EXPLICIT
   * (id, client_id) filter scopes by the BOUND client — a cross-tenant piece id
   * resolves to no row → null. Fail-closed mapping (mapPiece) returns null for an
   * unmappable row.
   */
  async loadPiece(pieceId: string, clientId: string): Promise<ContentPieceRow | null> {
    const { data, error } = await this.supabase
      .from("content_pieces")
      .select(
        "id, client_id, slug, title, body, status, version, is_ymyl, author_id, verdict, eval_score, faq_data, brief_snapshot",
      )
      .eq("id", pieceId)
      .eq("client_id", clientId)
      .maybeSingle();
    if (error) {
      throw new Error(
        `live-data-access: loadPiece failed for piece=${pieceId}: ${stringifyErr(error)}`,
      );
    }
    return data ? mapPiece(data) : null;
  }

  /**
   * The HIGHEST-version `content_piece_versions` row for a piece+client, or null.
   * EXPLICIT (piece_id, client_id) filter; ordered version DESC, limit 1.
   */
  async loadLatestVersion(
    pieceId: string,
    clientId: string,
  ): Promise<PersistedPieceVersion | null> {
    const { data, error } = await this.supabase
      .from("content_piece_versions")
      .select("id, piece_id, client_id, version, body, verdict, snapshot_at")
      .eq("piece_id", pieceId)
      .eq("client_id", clientId)
      .order("version", { ascending: false })
      .limit(1);
    if (error) {
      throw new Error(
        `live-data-access: loadLatestVersion failed for piece=${pieceId}: ${stringifyErr(error)}`,
      );
    }
    const row = (data ?? [])[0];
    return row ? mapVersion(row) : null;
  }

  /**
   * List ALL `content_piece_versions` rows for a piece+client (append-only
   * history). EXPLICIT (piece_id, client_id) filter; ordered version ASC. A
   * cross-tenant piece resolves to []. Unmappable rows are OMITTED (fail-closed).
   */
  async listPieceVersions(
    pieceId: string,
    clientId: string,
  ): Promise<PersistedPieceVersion[]> {
    const { data, error } = await this.supabase
      .from("content_piece_versions")
      .select("id, piece_id, client_id, version, body, verdict, snapshot_at")
      .eq("piece_id", pieceId)
      .eq("client_id", clientId)
      .order("version", { ascending: true });
    if (error) {
      throw new Error(
        `live-data-access: listPieceVersions failed for piece=${pieceId}: ${stringifyErr(error)}`,
      );
    }
    return (data ?? [])
      .map(mapVersion)
      .filter((v): v is PersistedPieceVersion => v !== null);
  }

  /**
   * Resolve a byline authorization by id (the §11.5 active check), or null.
   * EXPLICIT (id, client_id) filter scopes by the BOUND client — a cross-tenant
   * authorization id resolves to no row → null. The projection carries the full
   * A.005.1 shape (granted_at + scope + revoked_at + expires_at + credential +
   * placeholder); a row that cannot supply its id maps to null (fail-closed).
   */
  async getAuthorization(
    authorizationId: string,
    clientId: string,
  ): Promise<PersistedAuthorization | null> {
    const { data, error } = await this.supabase
      .from("byline_authorizations")
      .select(
        "id, client_id, granted_at, revoked_at, expires_at, credential, scope, placeholder",
      )
      .eq("id", authorizationId)
      .eq("client_id", clientId)
      .maybeSingle();
    if (error) {
      throw new Error(
        `live-data-access: getAuthorization failed for auth=${authorizationId}: ${stringifyErr(error)}`,
      );
    }
    return data ? mapAuthorization(data) : null;
  }

  /**
   * The latest recorded human release for a piece+version, or null. A
   * `credentialed_releases` row takes precedence (it is the only release that can
   * satisfy `canPublish`); otherwise an advisory `client_signoffs` row is surfaced
   * as a `client_signoff` (the FSM rejects it NO_HUMAN_RELEASE). EXPLICIT
   * (client_id, piece_id, version) filter on BOTH tables — a cross-tenant piece
   * resolves to no row → null. The `client_id` is the BOUND client.
   */
  async getRelease(
    pieceId: string,
    clientId: string,
    version: number,
  ): Promise<PersistedRelease | null> {
    // Credentialed release first (the publishable record).
    const cred = await this.supabase
      .from("credentialed_releases")
      .select("actor_id, credential, authorization_id")
      .eq("client_id", clientId)
      .eq("piece_id", pieceId)
      .eq("version", version)
      .maybeSingle();
    if (cred.error) {
      throw new Error(
        `live-data-access: getRelease(credentialed) failed for piece=${pieceId}: ${stringifyErr(cred.error)}`,
      );
    }
    if (cred.data) {
      const actorId = reqString(cred.data.actor_id);
      const authorizationId = reqString(cred.data.authorization_id);
      // Fail-closed: a credentialed release missing its actor or authorization FK
      // cannot be honored — treat as no release (publish blocks).
      if (actorId && authorizationId) {
        return {
          releaseType: "credentialed_release",
          actorId,
          credential: asCredential(cred.data.credential),
          authorizationId,
        };
      }
    }

    // Otherwise an advisory client_signoff (never publishable).
    const signoff = await this.supabase
      .from("client_signoffs")
      .select("actor_id")
      .eq("client_id", clientId)
      .eq("piece_id", pieceId)
      .eq("version", version)
      .maybeSingle();
    if (signoff.error) {
      throw new Error(
        `live-data-access: getRelease(signoff) failed for piece=${pieceId}: ${stringifyErr(signoff.error)}`,
      );
    }
    if (signoff.data) {
      const actorId = reqString(signoff.data.actor_id);
      if (actorId) {
        return { releaseType: "client_signoff", actorId };
      }
    }
    return null;
  }

  /**
   * The persisted gate-result projection for a piece+version, or null when no
   * gate has run (DR-039: a SEAM PROJECTION off the content_pieces row, NOT a
   * `gate_results` table). EXPLICIT (id, client_id) filter scopes by the BOUND
   * client. Projects: `evalRan` (a usable scorecard was persisted, i.e.
   * eval_score is a number), `stageBScore` (eval_score, null under a Stage-A
   * veto), `verdict` (the row verdict), `sourcingBlocked` (read off the persisted
   * dimensions scorecard, fail-closed false when absent). Returns null when the
   * piece itself does not resolve (cross-tenant / missing).
   *
   * `version` is accepted to satisfy the seam signature; the persisted scorecard
   * lives on the single current piece row (the row carries the latest gate). A
   * future per-version gate-results table (if DR-039 is revisited) would filter on
   * version here.
   */
  async getGateResult(
    pieceId: string,
    clientId: string,
    version: number,
  ): Promise<PersistedGateResult | null> {
    void version;
    const { data, error } = await this.supabase
      .from("content_pieces")
      .select("id, verdict, eval_score, dimensions")
      .eq("id", pieceId)
      .eq("client_id", clientId)
      .maybeSingle();
    if (error) {
      throw new Error(
        `live-data-access: getGateResult failed for piece=${pieceId}: ${stringifyErr(error)}`,
      );
    }
    if (!data || !reqString(data.id)) return null;
    const evalScore = asIntOrNull(data.eval_score);
    const verdict = asVerdict(data.verdict);
    // No gate has run iff there is neither a usable score nor a recorded verdict.
    if (evalScore === null && verdict === null) return null;
    return {
      // A usable scorecard was produced iff eval_score is a finite number (a
      // Stage-A veto suppresses scoring → eval_score null → evalRan false).
      evalRan: evalScore !== null,
      stageBScore: evalScore,
      verdict,
      sourcingBlocked: sourcingBlockedFromDimensions(data.dimensions),
    };
  }

  /**
   * Load a single `comment_threads` row scoped by (id, clientId), or null. The
   * EXPLICIT (id, client_id) filter scopes by the BOUND client — a cross-tenant
   * comment id resolves to no row → null. Fail-closed mapping.
   */
  async loadCommentThread(
    commentId: string,
    clientId: string,
  ): Promise<PersistedCommentThread | null> {
    const { data, error } = await this.supabase
      .from("comment_threads")
      .select("id, piece_id, client_id, version, kind, anchor, body, author, status, created_at")
      .eq("id", commentId)
      .eq("client_id", clientId)
      .maybeSingle();
    if (error) {
      throw new Error(
        `live-data-access: loadCommentThread failed for comment=${commentId}: ${stringifyErr(error)}`,
      );
    }
    return data ? mapCommentThread(data) : null;
  }

  /**
   * List ALL `comment_threads` rows for a piece+client. EXPLICIT (piece_id,
   * client_id) filter; ordered created_at ASC. A cross-tenant piece resolves to
   * []. Unmappable rows are OMITTED (fail-closed).
   */
  async listCommentThreads(
    pieceId: string,
    clientId: string,
  ): Promise<PersistedCommentThread[]> {
    const { data, error } = await this.supabase
      .from("comment_threads")
      .select("id, piece_id, client_id, version, kind, anchor, body, author, status, created_at")
      .eq("piece_id", pieceId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: true });
    if (error) {
      throw new Error(
        `live-data-access: listCommentThreads failed for piece=${pieceId}: ${stringifyErr(error)}`,
      );
    }
    return (data ?? [])
      .map(mapCommentThread)
      .filter((c): c is PersistedCommentThread => c !== null);
  }

  /**
   * List the recorded approval-cycle EVENTS for a piece+client (the approval-debt
   * cycle-time metric). Today these milestones are derived from the persisted
   * release tables (a `credentialed_releases` row → `credentialed_release`
   * milestone; a `client_signoffs` row → `client_signoff` milestone), each scoped
   * by the EXPLICIT (client_id, piece_id) tenancy filter on the BOUND client. A
   * cross-tenant piece resolves to []. (A dedicated approval-events table, if it
   * lands, would replace this derivation — the seam contract is unchanged.)
   */
  async listApprovalEvents(
    pieceId: string,
    clientId: string,
  ): Promise<PersistedApprovalEvent[]> {
    const events: PersistedApprovalEvent[] = [];

    const cred = await this.supabase
      .from("credentialed_releases")
      .select("piece_id, released_at")
      .eq("client_id", clientId)
      .eq("piece_id", pieceId)
      .order("released_at", { ascending: true });
    if (cred.error) {
      throw new Error(
        `live-data-access: listApprovalEvents(credentialed) failed for piece=${pieceId}: ${stringifyErr(cred.error)}`,
      );
    }
    for (const row of cred.data ?? []) {
      const at = reqString(row.released_at);
      if (at) events.push({ pieceId, kind: "credentialed_release", at });
    }

    const signoff = await this.supabase
      .from("client_signoffs")
      .select("piece_id, released_at")
      .eq("client_id", clientId)
      .eq("piece_id", pieceId)
      .order("released_at", { ascending: true });
    if (signoff.error) {
      throw new Error(
        `live-data-access: listApprovalEvents(signoff) failed for piece=${pieceId}: ${stringifyErr(signoff.error)}`,
      );
    }
    for (const row of signoff.data ?? []) {
      const at = reqString(row.released_at);
      if (at) events.push({ pieceId, kind: "client_signoff", at });
    }

    return events;
  }

  // ── PublicContentDataAccess read methods ────────────────────────────────────

  /**
   * Resolve a client by its public blog slug, or null. The public surface NEVER
   * receives a workspace/client UUID — it resolves the tenant from the human-
   * facing `blog_slug` (unique across all clients). Every subsequent public read
   * is scoped by the resolved `id`.
   */
  async resolveClientByBlogSlug(blogSlug: string): Promise<PublicClient | null> {
    const { data, error } = await this.supabase
      .from("content_clients")
      .select("id, blog_slug, name")
      .eq("blog_slug", blogSlug)
      .maybeSingle();
    if (error) {
      throw new Error(
        `live-data-access: resolveClientByBlogSlug failed for slug=${blogSlug}: ${stringifyErr(error)}`,
      );
    }
    if (!data) return null;
    const id = reqString(data.id);
    const slug = reqString(data.blog_slug);
    const name = reqString(data.name);
    if (!id || !slug || !name) return null;
    return { id, blogSlug: slug, name };
  }

  /**
   * Load a PUBLISHED piece by (clientId, slug), or null. EXPLICIT (client_id,
   * slug) filter PLUS the load-bearing `status = 'published'` filter — a draft /
   * review / approved / archived slug resolves to null (the fail-closed public-
   * read contract; the DB anon RLS policy is the second authoritative gate).
   */
  async loadPublishedPiece(clientId: string, slug: string): Promise<PublishedPiece | null> {
    const { data, error } = await this.supabase
      .from("content_pieces")
      .select(
        "client_id, slug, title, body, excerpt, meta_description, faq_data, published_at, updated_at, cluster_role, funnel_stage, status",
      )
      .eq("client_id", clientId)
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle();
    if (error) {
      throw new Error(
        `live-data-access: loadPublishedPiece failed for client=${clientId} slug=${slug}: ${stringifyErr(error)}`,
      );
    }
    return data ? mapPublished(data) : null;
  }

  /**
   * List the client's PUBLISHED pieces (the sitemap / resource-library homepage).
   * EXPLICIT `client_id` filter PLUS the `status = 'published'` filter; ordered
   * published_at DESC. Unmappable rows are OMITTED (fail-closed). Only published
   * rows ever surface.
   */
  async listPublishedPieces(clientId: string): Promise<PublishedPiece[]> {
    const { data, error } = await this.supabase
      .from("content_pieces")
      .select(
        "client_id, slug, title, body, excerpt, meta_description, faq_data, published_at, updated_at, cluster_role, funnel_stage, status",
      )
      .eq("client_id", clientId)
      .eq("status", "published")
      .order("published_at", { ascending: false });
    if (error) {
      throw new Error(
        `live-data-access: listPublishedPieces failed for client=${clientId}: ${stringifyErr(error)}`,
      );
    }
    return (data ?? [])
      .map(mapPublished)
      .filter((p): p is PublishedPiece => p !== null);
  }
}

// ── Inert factories (built + injectable; NOT wired into any route) ─────────────

/** The READ subset of `ContentDataAccess` the live adapter implements. */
export type ContentReadAccess = Pick<
  ContentDataAccess,
  | "clientBelongsToWorkspace"
  | "getApprovedVoiceSpec"
  | "loadPiece"
  | "loadLatestVersion"
  | "listPieceVersions"
  | "getAuthorization"
  | "getRelease"
  | "getGateResult"
  | "loadCommentThread"
  | "listCommentThreads"
  | "listApprovalEvents"
>;

/** The READ subset of `PublicContentDataAccess` the live adapter implements. */
export type PublicContentReadAccess = Pick<
  PublicContentDataAccess,
  "resolveClientByBlogSlug" | "loadPublishedPiece" | "listPublishedPieces"
>;

/**
 * Build a `LiveContentReadAccess` from a service-role Supabase client — but ONLY
 * if the host creds are present. Returns null otherwise, so the caller leaves the
 * seam on its fail-closed `NOT_WIRED_*` default (unchanged behavior).
 *
 * `@supabase/supabase-js` is imported dynamically so importing this module is
 * network-free and needs no creds just to import. Mirrors
 * `image-resolver.makeLiveImageResolver` exactly.
 *
 * INERT: this is NOT called by any route in this PR. A separate human-reviewed
 * wiring PR will inject the returned read access into the kernel/public routes.
 */
export async function makeLiveContentReadAdapter(): Promise<LiveContentReadAccess | null> {
  const creds = readReadAdapterCreds();
  if (!creds) return null;
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(creds.url, creds.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as ReaderSupabase;
  return new LiveContentReadAccess(supabase);
}

/**
 * Build the live READ subset of `ContentDataAccess`, or null when the host is not
 * configured (→ leave the seam on `NOT_WIRED_DATA_ACCESS`). The returned object
 * is typed to the READ methods ONLY — it carries no write method, so a route can
 * never accidentally mutate through it.
 *
 * INERT: not wired into any route in this PR (factory only).
 */
export async function makeLiveContentReadAccess(): Promise<ContentReadAccess | null> {
  const adapter = await makeLiveContentReadAdapter();
  if (!adapter) return null;
  return {
    clientBelongsToWorkspace: (clientId, workspaceId) =>
      adapter.clientBelongsToWorkspace(clientId, workspaceId),
    getApprovedVoiceSpec: (clientId) => adapter.getApprovedVoiceSpec(clientId),
    loadPiece: (pieceId, clientId) => adapter.loadPiece(pieceId, clientId),
    loadLatestVersion: (pieceId, clientId) => adapter.loadLatestVersion(pieceId, clientId),
    listPieceVersions: (pieceId, clientId) => adapter.listPieceVersions(pieceId, clientId),
    getAuthorization: (authorizationId, clientId) =>
      adapter.getAuthorization(authorizationId, clientId),
    getRelease: (pieceId, clientId, version) => adapter.getRelease(pieceId, clientId, version),
    getGateResult: (pieceId, clientId, version) =>
      adapter.getGateResult(pieceId, clientId, version),
    loadCommentThread: (commentId, clientId) => adapter.loadCommentThread(commentId, clientId),
    listCommentThreads: (pieceId, clientId) => adapter.listCommentThreads(pieceId, clientId),
    listApprovalEvents: (pieceId, clientId) => adapter.listApprovalEvents(pieceId, clientId),
  };
}

/**
 * Build the live READ subset of `PublicContentDataAccess`, or null when the host
 * is not configured (→ leave the seam on `NOT_WIRED_PUBLIC_DATA_ACCESS`).
 *
 * Note: `resolveHeroAssets` is NOT provided here — it already lives in
 * `image-resolver.ts` (C.021.2 / `makeLiveResolveHeroAssets`). The wiring PR
 * composes the two: the published-content reads come from THIS adapter and the
 * hero-asset resolution from the image-resolver, both gated on the same
 * service-role creds. They are kept separate so image-resolver stays untouched.
 *
 * INERT: not wired into any route in this PR (factory only).
 */
export async function makeLivePublicContentReadAccess(): Promise<PublicContentReadAccess | null> {
  const adapter = await makeLiveContentReadAdapter();
  if (!adapter) return null;
  return {
    resolveClientByBlogSlug: (blogSlug) => adapter.resolveClientByBlogSlug(blogSlug),
    loadPublishedPiece: (clientId, slug) => adapter.loadPublishedPiece(clientId, slug),
    listPublishedPieces: (clientId) => adapter.listPublishedPieces(clientId),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// LIVE WRITE ADAPTER (DR-026, service-role, INERT)
// ══════════════════════════════════════════════════════════════════════════════
//
// THE GAP THIS CLOSES. The READ adapter above loads pieces/versions/releases; the
// content-kernel WRITE paths (draft insert, version snapshot, FSM transition,
// comment-thread resolve, dual sign-off) still run on `NOT_WIRED_DATA_ACCESS`
// (every writer throws). This is the live WRITE half of the same seam, the same
// module + service-role discipline as the READ adapter.
//
// SECURITY — SERVICE ROLE BYPASSES RLS (load-bearing, the highest-stakes code in
// the project — it persists YMYL releases + moves the FSM). RLS is NOT the tenancy
// boundary here. The APP FILTER is the boundary:
//   - every INSERT sets `workspace_id` + `client_id` from the BOUND args of the
//     host-built payload (never request input). The seam's insert payloads carry
//     the BOUND tenancy by construction (context.ts: "`clientId` is the BOUND
//     client id (never request input)").
//   - every UPDATE filters by the BOUND `client_id` (+ `id`/`piece_id`). A
//     cross-tenant id therefore updates ZERO rows — never another tenant's row.
//
// NO GATE / FSM BYPASS (GATE-BYPASS). This is a PERSISTENCE layer: it persists what
// the host logic ALREADY decided. It embeds NO publish shortcut.
//   - `transitionPieceStatus` persists the status the caller passes. The FSM gate
//     (`assertTransition` -> `canPublish`) is enforced UPSTREAM in `@sagemark/core`
//     and the publish route (apps/seo/src/app/content/api/publish/route.ts:214 —
//     `assertTransition(from, to, transitionCtx)` runs BEFORE the line-253
//     `transitionPieceStatus` call). The adapter does NOT re-gate, and exposes NO
//     publish path that skips the recorded `credentialed_releases` row: `published`
//     is reachable only by the caller passing `to='published'` AFTER its own gate.
//   - `insertCredentialedRelease` persists the record `signoff.ts` already built;
//     the §11.5 active-authorization check + the DR-037 placeholder refusal already
//     ran in `signoff.ts` (recordCredentialedRelease) — the adapter does NOT
//     re-gate and does NOT weaken it: it persists the credential snapshot +
//     authorization_id FAITHFULLY (no defaulting, no fabrication).
//
// IMMUTABILITY (DR-031, append-only). The adapter provides NO update/delete for a
// credentialed release or a named sign-off version:
//   - `credentialed_releases` is INSERT-only here (no update/delete method). The
//     schema's UNIQUE(piece_id, version) makes a SECOND release per version fail at
//     the DB — the duplicate INSERT returns an error and this throws (publish stays
//     on the first release).
//   - `nameVersion` / `setActiveVersion` mutate the DEFERRED-MIGRATION
//     `name`/`is_active`/`is_signoff` columns that do NOT exist on
//     `content_piece_versions` yet (no migration adds them — schema lane owns them).
//     Per the seam contract they stay FAIL-CLOSED (throw `DataAccessNotWiredError`)
//     until those columns + the Drizzle impl land. Because there is NO live write
//     path for a named sign-off version at all, the undeletable-named-sign-off
//     invariant (P1.U.4) holds trivially in this adapter.
//
// FAIL-LOUD on a write error (never fail-open / never silently succeed). A
// PostgREST error (constraint violation, RLS, network) throws a clear error — a
// caller NEVER reads a write that did not land.
//
// Clean ASCII / UTF-8. No `console.*`. `@supabase/supabase-js` is imported
// dynamically by the shared `makeLiveContentReadAdapter` creds path.

/**
 * A terminal PostgREST WRITE builder. Awaitable to `{ error }` for a
 * fire-and-forget write; `.select(cols)` narrows the returned columns and
 * `.single()` returns the one written/updated row. `.eq()` chains the tenancy
 * filters an UPDATE binds. Modelled minimally (only the methods used) so the fake
 * client in the test can implement the same shape.
 */
interface WriterMutation {
  /** Chain a tenancy/identity filter (UPDATE scope). */
  eq(col: string, val: string | number): WriterMutation;
  /** Narrow the returned columns (RETURNING ...). */
  select(cols: string): WriterMutation;
  /** Return exactly the one affected row (errors if not exactly one). */
  single(): Promise<ReaderResult<Record<string, unknown> | null>>;
  /** Return all affected rows (0..n). */
  then<R>(
    onfulfilled?: (v: ReaderResult<Record<string, unknown>[]>) => R,
  ): PromiseLike<R>;
}

/** The minimal service-role Supabase surface this WRITE adapter uses. */
export interface WriterSupabase {
  from(table: string): {
    insert(row: Record<string, unknown>): WriterMutation;
    update(patch: Record<string, unknown>): WriterMutation;
  };
}

/**
 * Live, service-role-backed implementation of the WRITE surface of
 * `ContentDataAccess`. Every INSERT carries the BOUND `workspace_id`/`client_id`
 * from the host-built payload; every UPDATE filters by the BOUND tenancy (a
 * cross-tenant id updates ZERO rows). It persists ONLY what the host logic already
 * decided — it embeds no gate/FSM bypass.
 */
export class LiveContentWriteAccess {
  constructor(private readonly supabase: WriterSupabase) {}

  /**
   * Insert a host-validated draft piece. The route NEVER passes caller tenancy —
   * `client_id` is the BOUND client id from `DraftInsert` (context.ts). Status
   * defaults to 'draft' (the DB column default); a draft can never be born
   * published. Returns the new (id, slug). Fail-loud on a constraint error (e.g.
   * the per-client unique-slug index).
   */
  async insertDraftPiece(insert: DraftInsert): Promise<{ id: string; slug: string }> {
    const { data, error } = await this.supabase
      .from("content_pieces")
      .insert({
        client_id: insert.clientId, // BOUND tenancy — never request input.
        slug: insert.slug,
        title: insert.title,
        body: insert.body,
        excerpt: insert.excerpt ?? null,
        meta_description: insert.metaDescription ?? null,
        is_ymyl: insert.isYmyl,
        author_id: insert.authorId,
        faq_data: insert.faqData,
        brief_snapshot: insert.briefSnapshot,
        // status / version intentionally OMITTED — the DB defaults ('draft', 1)
        // apply. A draft is never born in a published/approved state.
      })
      .select("id, slug")
      .single();
    if (error) {
      throw new Error(
        `live-data-access: insertDraftPiece failed for client=${insert.clientId}: ${stringifyErr(error)}`,
      );
    }
    const id = data ? reqString(data.id) : null;
    const slug = data ? reqString(data.slug) : null;
    if (!id || !slug) {
      throw new Error(
        `live-data-access: insertDraftPiece returned no id/slug for client=${insert.clientId}`,
      );
    }
    return { id, slug };
  }

  /**
   * APPEND-ONLY insert of a NEW `content_piece_versions` row (the edit flow). It
   * NEVER mutates a prior version; the schema's UNIQUE(piece_id, version) makes a
   * duplicate `version` for a piece fail at the DB (the INSERT errors → this
   * throws). `client_id` is the BOUND client id from the payload. Returns the new
   * (id, version).
   */
  async insertPieceVersion(
    insert: PieceVersionInsert,
  ): Promise<{ id: string; version: number }> {
    const { data, error } = await this.supabase
      .from("content_piece_versions")
      .insert({
        piece_id: insert.pieceId,
        client_id: insert.clientId, // BOUND tenancy — never request input.
        version: insert.version,
        body: insert.body,
        verdict: insert.verdict,
        dimensions: insert.dimensions,
      })
      .select("id, version")
      .single();
    if (error) {
      // A duplicate (piece_id, version) hits the unique index → fail-loud (the
      // append-only history is never silently overwritten).
      throw new Error(
        `live-data-access: insertPieceVersion failed for piece=${insert.pieceId} version=${insert.version}: ${stringifyErr(error)}`,
      );
    }
    const id = data ? reqString(data.id) : null;
    const version = data ? asIntOrNull(data.version) : null;
    if (!id || version === null) {
      throw new Error(
        `live-data-access: insertPieceVersion returned no id/version for piece=${insert.pieceId}`,
      );
    }
    return { id, version };
  }

  /**
   * Persist an FSM status transition (publish route only). PERSISTENCE ONLY — the
   * FSM/`canPublish` gate is enforced UPSTREAM (`assertTransition` in the publish
   * route runs BEFORE this call). The UPDATE filters by the BOUND (id, client_id);
   * a cross-tenant piece id matches ZERO rows (no mutation, no leak). Sets
   * `updated_at = now()`, and `published_at = now()` ONLY when transitioning to
   * 'published' (so a published piece always carries a publish timestamp — the
   * public read orders by it). This is NOT a publish shortcut: 'published' is only
   * ever reached because the caller already passed `to='published'` past its gate.
   */
  async transitionPieceStatus(
    pieceId: string,
    clientId: string,
    to: ContentPieceRow["status"],
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = { status: to, updated_at: nowIso };
    if (to === "published") {
      patch.published_at = nowIso;
    }
    const { error } = await this.supabase
      .from("content_pieces")
      .update(patch)
      .eq("id", pieceId)
      .eq("client_id", clientId); // BOUND tenancy — a cross-tenant id → 0 rows.
    if (error) {
      throw new Error(
        `live-data-access: transitionPieceStatus failed for piece=${pieceId} to=${to}: ${stringifyErr(error)}`,
      );
    }
  }

  /**
   * Insert ONE ADVISORY `client_signoffs` row. This row can NEVER release a piece
   * nor populate a byline — the payload (context.ts `ClientSignoffInsert`) carries
   * NO credential / authorization_id by construction, and the table's CHECK pins
   * `release_type = 'client_signoff'`. `workspace_id`/`client_id` are the BOUND
   * pair. Returns the new id.
   */
  async insertClientSignoff(insert: ClientSignoffInsert): Promise<{ id: string }> {
    const { data, error } = await this.supabase
      .from("client_signoffs")
      .insert({
        workspace_id: insert.workspaceId, // BOUND tenancy.
        client_id: insert.clientId, // BOUND tenancy.
        piece_id: insert.pieceId,
        version: insert.version,
        actor_id: insert.actorId,
        release_scope: insert.releaseScope,
        // release_type intentionally OMITTED — the DB default + CHECK pin it to
        // 'client_signoff' (an advisory row can NEVER masquerade as a release).
      })
      .select("id")
      .single();
    if (error) {
      throw new Error(
        `live-data-access: insertClientSignoff failed for piece=${insert.pieceId}: ${stringifyErr(error)}`,
      );
    }
    const id = data ? reqString(data.id) : null;
    if (!id) {
      throw new Error(
        `live-data-access: insertClientSignoff returned no id for piece=${insert.pieceId}`,
      );
    }
    return { id };
  }

  /**
   * Insert ONE `credentialed_releases` row — the ONLY record `canPublish()` reads
   * as a human release. PERSISTENCE ONLY: the §11.5 active-authorization check + the
   * DR-037 placeholder refusal already ran in `signoff.ts`
   * (`recordCredentialedRelease`); this adapter does NOT re-gate and does NOT
   * weaken it — it persists the `credential` snapshot + `authorization_id`
   * FAITHFULLY (no defaulting, no fabrication). The schema's
   * UNIQUE(piece_id, version) makes a SECOND release per version fail at the DB (the
   * INSERT errors → this throws). IMMUTABLE / append-only: there is NO update or
   * delete path for a credentialed release on this adapter. Tenancy is the BOUND
   * pair. Returns the new id.
   */
  async insertCredentialedRelease(
    insert: CredentialedReleaseInsert,
  ): Promise<{ id: string }> {
    const { data, error } = await this.supabase
      .from("credentialed_releases")
      .insert({
        workspace_id: insert.workspaceId, // BOUND tenancy.
        client_id: insert.clientId, // BOUND tenancy.
        piece_id: insert.pieceId,
        version: insert.version,
        actor_id: insert.actorId,
        // Persist the byline evidence FAITHFULLY (the snapshot signoff.ts took
        // from the active authorization — never request input, never defaulted).
        credential: insert.credential,
        authorization_id: insert.authorizationId,
        release_scope: insert.releaseScope,
        // release_type OMITTED — the DB default + CHECK pin 'credentialed_release'.
      })
      .select("id")
      .single();
    if (error) {
      // A duplicate (piece_id, version) hits the unique index → fail-loud (a second
      // release per version is rejected; publish stays on the recorded release).
      throw new Error(
        `live-data-access: insertCredentialedRelease failed for piece=${insert.pieceId} version=${insert.version}: ${stringifyErr(error)}`,
      );
    }
    const id = data ? reqString(data.id) : null;
    if (!id) {
      throw new Error(
        `live-data-access: insertCredentialedRelease returned no id for piece=${insert.pieceId}`,
      );
    }
    return { id };
  }

  /**
   * Mark a `comment_threads` row RESOLVED + append a host-authored note that it was
   * addressed in a given version. APPEND-ONLY w.r.t. the thread audit: it flips
   * `status` open->resolved and APPENDS the "addressed in vN" note onto `body`
   * (the table has no dedicated addressed-version column; the note is appended, the
   * thread is NEVER deleted). The UPDATE filters by the BOUND (id, client_id) — a
   * cross-tenant comment id matches ZERO rows → no mutation; we then fail-loud
   * (the caller asked to resolve a thread that is not theirs / does not exist).
   * Returns the mapped resolved thread.
   */
  async resolveCommentThread(input: {
    commentId: string;
    clientId: string;
    addressedInVersion: number;
  }): Promise<PersistedCommentThread> {
    // Read the current body first (scoped to the BOUND tenancy) so the note is an
    // APPEND, never a clobber. A cross-tenant / missing id resolves to no row.
    const current = await this.readCommentBody(input.commentId, input.clientId);
    const note = `[resolved: addressed in v${input.addressedInVersion}]`;
    const nextBody = current.body ? `${current.body}\n${note}` : note;

    const { data, error } = await this.supabase
      .from("comment_threads")
      .update({ status: "resolved", body: nextBody })
      .eq("id", input.commentId)
      .eq("client_id", input.clientId) // BOUND tenancy — cross-tenant → 0 rows.
      .select(
        "id, piece_id, client_id, version, kind, anchor, body, author, status, created_at",
      )
      .single();
    if (error) {
      throw new Error(
        `live-data-access: resolveCommentThread failed for comment=${input.commentId}: ${stringifyErr(error)}`,
      );
    }
    const mapped = data ? mapCommentThread(data) : null;
    if (!mapped) {
      throw new Error(
        `live-data-access: resolveCommentThread updated no row for comment=${input.commentId} (cross-tenant or missing)`,
      );
    }
    return mapped;
  }

  /**
   * Read the current `body` of a comment thread scoped by the BOUND (id, client_id)
   * so `resolveCommentThread` can APPEND its note (never clobber). The read
   * companion is injected by the factory (same service-role client). Returns an
   * empty body when the row does not resolve — the subsequent UPDATE then matches 0
   * rows and the caller fails loud.
   */
  private async readCommentBody(
    commentId: string,
    clientId: string,
  ): Promise<{ body: string }> {
    if (!this.reader) return { body: "" };
    const thread = await this.reader.loadCommentThread(commentId, clientId);
    return { body: thread?.body ?? "" };
  }

  /** Optional read companion (injected by the factory) for the resolve-note append. */
  private reader: Pick<LiveContentReadAccess, "loadCommentThread"> | null = null;
  /** @internal Wire the read companion (factory only). */
  attachReader(reader: Pick<LiveContentReadAccess, "loadCommentThread">): void {
    this.reader = reader;
  }

  /**
   * DEFERRED-MIGRATION (fail-closed). `nameVersion` writes the `name`/`is_signoff`
   * columns on `content_piece_versions` that DO NOT EXIST yet (no migration adds
   * them — the schema-tenancy lane owns them). Per the seam contract it stays
   * NOT_WIRED until those columns + the Drizzle impl land. Because there is NO live
   * write path for a named sign-off version, the undeletable-named-sign-off
   * invariant (P1.U.4) holds trivially here (no update/delete path exists at all).
   */
  async nameVersion(_input: {
    pieceId: string;
    clientId: string;
    version: number;
    name: string;
    asSignoff?: boolean;
  }): Promise<PersistedPieceVersion> {
    void _input;
    throw new DataAccessNotWiredError("nameVersion (deferred-migration columns)");
  }

  /**
   * DEFERRED-MIGRATION (fail-closed). `setActiveVersion` writes the `is_active`
   * column on `content_piece_versions` that DOES NOT EXIST yet. NOT_WIRED until the
   * schema lane lands the column + the Drizzle impl. (No live write path — no risk
   * of mutating an immutable named sign-off.)
   */
  async setActiveVersion(_input: {
    pieceId: string;
    clientId: string;
    version: number;
  }): Promise<PersistedPieceVersion> {
    void _input;
    throw new DataAccessNotWiredError("setActiveVersion (deferred-migration columns)");
  }
}

// ── Inert WRITE factory (built + injectable; NOT wired into any route) ──────────

/** The WRITE subset of `ContentDataAccess` the live adapter implements. */
export type ContentWriteAccess = Pick<
  ContentDataAccess,
  | "insertDraftPiece"
  | "insertPieceVersion"
  | "transitionPieceStatus"
  | "insertClientSignoff"
  | "insertCredentialedRelease"
  | "resolveCommentThread"
  | "nameVersion"
  | "setActiveVersion"
>;

/**
 * Build a `LiveContentWriteAccess` from a service-role Supabase client — but ONLY
 * if the host creds are present. Returns null otherwise, so the caller leaves the
 * seam on its fail-closed `NOT_WIRED_DATA_ACCESS` default (unchanged behavior).
 *
 * The SAME service-role client backs both the read and write surfaces; the write
 * adapter gets a read companion (for the resolve-note append) wired in.
 *
 * INERT: this is NOT called by any route in this PR. A separate human-reviewed
 * wiring PR will inject the returned write access into the kernel routes.
 */
export async function makeLiveContentWriteAdapter(): Promise<LiveContentWriteAccess | null> {
  const creds = readReadAdapterCreds();
  if (!creds) return null;
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(creds.url, creds.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const writer = new LiveContentWriteAccess(client as unknown as WriterSupabase);
  writer.attachReader(new LiveContentReadAccess(client as unknown as ReaderSupabase));
  return writer;
}

/**
 * Build the live WRITE subset of `ContentDataAccess`, or null when the host is not
 * configured (-> leave the seam on `NOT_WIRED_DATA_ACCESS`). The returned object is
 * typed to the WRITE methods only.
 *
 * INERT: not wired into any route in this PR (factory only).
 */
export async function makeLiveContentWriteAccess(): Promise<ContentWriteAccess | null> {
  const adapter = await makeLiveContentWriteAdapter();
  if (!adapter) return null;
  return {
    insertDraftPiece: (insert) => adapter.insertDraftPiece(insert),
    insertPieceVersion: (insert) => adapter.insertPieceVersion(insert),
    transitionPieceStatus: (pieceId, clientId, to) =>
      adapter.transitionPieceStatus(pieceId, clientId, to),
    insertClientSignoff: (insert) => adapter.insertClientSignoff(insert),
    insertCredentialedRelease: (insert) => adapter.insertCredentialedRelease(insert),
    resolveCommentThread: (input) => adapter.resolveCommentThread(input),
    nameVersion: (input) => adapter.nameVersion(input),
    setActiveVersion: (input) => adapter.setActiveVersion(input),
  };
}
