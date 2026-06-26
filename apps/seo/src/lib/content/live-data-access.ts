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
} from "./context";
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
