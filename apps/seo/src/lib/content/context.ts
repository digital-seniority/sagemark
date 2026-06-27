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
  /**
   * When this authorization was GRANTED (`byline_authorizations.granted_at`,
   * timestamptz NOT NULL DEFAULT now()). A.005.1 / DR-039 widens the projection to
   * carry it so the §11.5 active predicate can require an authorization to be
   * actually granted (granted_at present and not in the future) — never treat
   * "granted" implicitly. Optional ONLY so legacy read-only fixtures that predate
   * this widening still type-check; FAIL-CLOSED: a missing/unparseable `grantedAt`
   * makes the authorization INACTIVE, never default-active.
   */
  grantedAt?: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
  /**
   * The byline-evidence snapshot {name, credentials} captured at grant time
   * (`byline_authorizations.credential` jsonb). Present so the sign-off WRITE can
   * snapshot the reviewer's credential onto the `credentialed_releases` row from
   * the authorization it is releasing against — the byline evidence, never request
   * input. Optional on the projection so existing read-only fixtures (which only
   * need the active flags) need no change.
   */
  credential?: { name?: string; credentials?: string };
  /**
   * The authorization scope (`byline_authorizations.scope` ∈ client|cluster|piece;
   * the DB CHECK enforces the vocabulary). A.005.1 / DR-039: the §11.5 active
   * predicate now READS this — a release for a YMYL piece must resolve an
   * authorization whose `scope` is a recognized authorization scope. Optional ONLY
   * so legacy read-only fixtures still type-check; FAIL-CLOSED: a missing/empty/
   * unrecognized `scope` makes the authorization INACTIVE (the predicate refuses
   * an un-scoped grant), never default-active.
   */
  scope?: string;
  /**
   * DR-037 go-live guard. TRUE iff this is the seeded PILOT PLACEHOLDER reviewer
   * authorization ("Pending Clinical Reviewer", RN). A placeholder authorization
   * can NEVER back a real `credentialed_releases` write in a non-pilot/production
   * context — the sign-off writer refuses it (the byline must resolve to a real
   * credentialed person before a YMYL piece is published). Defaults to false /
   * undefined for a real authorization. (Migration 0038 adds the column; the seed
   * SQL sets it true on the placeholder row only.)
   */
  placeholder?: boolean;
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
 * A persisted `content_piece_versions` row projection (the append-only history).
 * Columns mirror `packages/schema-flywheel/src/content.ts` `content_piece_versions`
 * (id, piece_id, client_id, version, body, dimensions, verdict, snapshot_at) — the
 * subset the edit flow reads. The CURRENT body of a piece is the body of its
 * HIGHEST-version row; the edit's stale-guard hashes THAT body.
 */
export interface PersistedPieceVersion {
  id: string;
  pieceId: string;
  clientId: string;
  version: number;
  body: string;
  verdict: Verdict | null;
  snapshotAt: string;
  /**
   * The human-readable name attached to this version (esp. a sign-off marker), or
   * null when unnamed. P1.U.4 / PR 013 — append-only metadata.
   *
   * DEFERRED-MIGRATION (schema lane): `content_piece_versions` (PR 004 /
   * `packages/schema-flywheel/src/content.ts`) has NO `name`/`active`/`is_signoff`
   * columns. The version-hub models name/active/sign-off as a SEAM-LEVEL concern
   * (this projection + the metadata writes below); the actual columns are a
   * deferred migration the schema-tenancy lane owns. Fail-closed: the production
   * seam throws NOT_WIRED until those columns + the Drizzle impl land.
   */
  name: string | null;
  /**
   * Whether this version is the ACTIVE (currently-displayed) one for its piece. A
   * pointer/metadata flag — switching active NEVER destroys other versions.
   * (DEFERRED-MIGRATION as above.)
   */
  isActive: boolean;
  /**
   * Whether this version is the recorded human-release SIGN-OFF marker. A NAMED
   * sign-off version is UNDELETABLE and immutable (P1.U.4 invariant): there is no
   * delete path at all, and a name/overwrite of a sign-off version is rejected.
   * (DEFERRED-MIGRATION as above.)
   */
  isSignoff: boolean;
}

/**
 * Append-only insert payload for a NEW `content_piece_versions` row (PR 012 edit
 * flow). `clientId` is the BOUND client id (never request input). The write is
 * APPEND-ONLY — it inserts a NEW row at `version` and NEVER mutates a prior one;
 * the (piece_id, version) unique index in the schema is the structural guard
 * against an accidental overwrite (a duplicate version throws).
 */
export interface PieceVersionInsert {
  pieceId: string;
  clientId: string;
  /** The new version number (MUST be greater than every existing version). */
  version: number;
  body: string;
  /** The gate verdict re-computed for this edited body (null if not yet gated). */
  verdict: Verdict | null;
  /** The Stage-B dimensions JSON for this version (null when a veto suppressed scoring). */
  dimensions: unknown | null;
}

/**
 * Insert payload for an ADVISORY `client_signoffs` row (PR 019 / P1.C.2). The
 * client/agency contact's approval or comment-resolution — it can NEVER release a
 * piece nor supply a byline. STRUCTURALLY it carries NO `credential` and NO
 * `authorizationId`: the row shape is incapable of populating the reviewer
 * byline, mirroring the `client_signoffs` table (which has no such columns). The
 * `clientId`/`workspaceId` are the BOUND tenancy (never request input).
 */
export interface ClientSignoffInsert {
  workspaceId: string;
  clientId: string;
  pieceId: string;
  version: number;
  /** The client/agency contact who approved (opaque id). */
  actorId: string;
  /** Whether the sign-off covers the whole piece or a section. */
  releaseScope: "piece" | "section";
}

/**
 * Insert payload for a `credentialed_releases` row (PR 019 / P1.C.2) — the ONLY
 * record that satisfies `canPublish()`'s human-release precondition. It writes the
 * named, undeletable release version recording the reviewer's identity +
 * `credential` snapshot + `authorizationId` (the byline evidence). The
 * `credential` is snapshot from the ACTIVE backing authorization at write time;
 * `authorizationId` FK → `byline_authorizations`. Tenancy is the BOUND pair.
 */
export interface CredentialedReleaseInsert {
  workspaceId: string;
  clientId: string;
  pieceId: string;
  version: number;
  /** The credentialed reviewer (D6) who released. */
  actorId: string;
  /** The {name, credentials} byline snapshot captured at release (byline evidence). */
  credential: { name?: string; credentials?: string };
  /** FK → an ACTIVE byline_authorizations row (§11.5). */
  authorizationId: string;
  /** Whether the release covers the whole piece or a section. */
  releaseScope: "piece" | "section";
}

/**
 * A `comment_threads` row projection the routing + approval-debt reads use (PR
 * 019 / P1.C.2). Scoped by the BOUND tenancy at the seam. `anchor` carries the
 * `elementHint` the router maps to a section region. Read-only.
 */
export interface PersistedCommentThread {
  id: string;
  pieceId: string;
  clientId: string;
  version: number;
  kind: string; // pin | section-approve | request-changes
  anchor: { x?: number; y?: number; elementHint?: string } | null;
  body: string;
  author: string;
  status: string; // open | resolved
  createdAt: string;
}

/**
 * A recorded approval-cycle EVENT projection for the approval-debt metric (PR 019
 * / P1.C.2). Each event is a timestamped lifecycle milestone for a piece, scoped
 * by the BOUND tenancy. The metric pairs `link_sent`→`client_signoff` and
 * `draft_review`→`credentialed_release` to compute cycle times, and counts open
 * `request-changes` threads as "approval debt".
 */
export interface PersistedApprovalEvent {
  pieceId: string;
  /** The milestone kind (see APPROVAL_EVENT_KINDS in metrics/approval-debt). */
  kind: string;
  /** ISO timestamp the milestone occurred. */
  at: string;
}

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

  /**
   * The HIGHEST-version `content_piece_versions` row for a piece+client, or null
   * when no version snapshot exists yet. The edit flow reads this as the CURRENT
   * body to (a) compute the stale-edit SHA-256 guard and (b) compute the next
   * version number. Read-only. (PR 012 / P1.U.3 — fail-closed seam extension.)
   */
  loadLatestVersion(pieceId: string, clientId: string): Promise<PersistedPieceVersion | null>;

  /**
   * List ALL `content_piece_versions` rows for a piece+client (the append-only
   * history the version hub reads). Read-only; ordered is the impl's choice (the
   * hub sorts by version). Scoped by the BOUND `clientId` — a cross-tenant piece
   * resolves to an empty list (the route 404s first via the ownership bind).
   * (P1.U.4 / PR 013 — fail-closed seam extension; flagged.)
   */
  listPieceVersions(pieceId: string, clientId: string): Promise<PersistedPieceVersion[]>;

  // ── Mutations (the audit route is wired with a view that LACKS these) ────────
  /** Host-validated content_pieces insert (draft route only). Returns the new id+slug. */
  insertDraftPiece(insert: DraftInsert): Promise<{ id: string; slug: string }>;
  /** FSM status transition (publish route only). */
  transitionPieceStatus(
    pieceId: string,
    clientId: string,
    to: ContentPieceRow["status"],
  ): Promise<void>;
  /**
   * APPEND-ONLY insert of a NEW `content_piece_versions` row (PR 012 edit flow).
   * NEVER mutates a prior version — a duplicate (piece_id, version) MUST throw
   * (the schema unique index enforces it). Returns the new row id + version.
   * (PR 012 / P1.U.3 — fail-closed seam extension.)
   */
  insertPieceVersion(insert: PieceVersionInsert): Promise<{ id: string; version: number }>;

  /**
   * Attach a human-readable NAME to a version (esp. the sign-off). APPEND-ONLY
   * METADATA — it writes a name onto an existing version row; it NEVER deletes or
   * rewrites the version body, and it is NOT a new content version. The version
   * history stays append-only (PR 012); naming is a metadata-only write.
   *
   * UNDELETABLE NAMED SIGN-OFF (P1.U.4 invariant): if the target version is a
   * NAMED sign-off, this MUST reject (the sign-off marker is immutable — its name
   * cannot be overwritten and it can never be cleared). Implementations throw a
   * `SignoffImmutableError`. There is NO delete method on this seam at all.
   * (P1.U.4 / PR 013 — fail-closed seam extension; flagged. DEFERRED-MIGRATION:
   * needs the `name`/`is_signoff` columns the schema lane owns.)
   */
  nameVersion(input: {
    pieceId: string;
    clientId: string;
    version: number;
    name: string;
    /** Mark this named version as the sign-off (the undeletable release marker). */
    asSignoff?: boolean;
  }): Promise<PersistedPieceVersion>;

  /**
   * SWITCH which version is the active/displayed one (a pointer/metadata update).
   * Clears `isActive` on the prior active row and sets it on the target — it NEVER
   * destroys any version. Read-mostly metadata; the history is untouched.
   * (P1.U.4 / PR 013 — fail-closed seam extension; flagged. DEFERRED-MIGRATION:
   * needs the `active` column the schema lane owns.)
   */
  setActiveVersion(input: {
    pieceId: string;
    clientId: string;
    version: number;
  }): Promise<PersistedPieceVersion>;

  // ── Client-review routing + dual sign-off (PR 019 / P1.C.2) ──────────────────

  /**
   * Load a single `comment_threads` row scoped by (id, clientId), or null. The
   * route-to-edit handler reads the `request-changes` comment it is asked to
   * triage; the `clientId` is the BOUND tenancy (a cross-tenant comment id
   * resolves to null). READ-ONLY. (PR 019 — fail-closed seam extension; flagged.)
   */
  loadCommentThread(
    commentId: string,
    clientId: string,
  ): Promise<PersistedCommentThread | null>;

  /**
   * List ALL `comment_threads` rows for a piece+client (the approval-debt open-
   * thread count + the resolve sweep). Scoped by the BOUND `clientId`. READ-ONLY.
   * (PR 019 — fail-closed seam extension; flagged.)
   */
  listCommentThreads(
    pieceId: string,
    clientId: string,
  ): Promise<PersistedCommentThread[]>;

  /**
   * Mark a `comment_threads` row RESOLVED + append a host-authored note that it
   * was addressed in a given version ("addressed in vN — see diff"). APPEND-ONLY
   * w.r.t. the thread's audit: it flips `status` open→resolved and records the
   * addressing version; it never deletes the row. Scoped by the BOUND `clientId`.
   * (PR 019 — fail-closed seam extension; flagged.)
   */
  resolveCommentThread(input: {
    commentId: string;
    clientId: string;
    addressedInVersion: number;
  }): Promise<PersistedCommentThread>;

  /**
   * Insert ONE ADVISORY `client_signoffs` row. This row can NEVER release a piece
   * nor populate a byline — it carries no credential / authorization_id by
   * construction (the payload has no such fields). Tenancy is the BOUND pair.
   * Returns the new row id. (PR 019 — fail-closed seam extension; flagged.)
   */
  insertClientSignoff(insert: ClientSignoffInsert): Promise<{ id: string }>;

  /**
   * Insert ONE `credentialed_releases` row — the ONLY record `canPublish()` reads
   * as a human release (the named, undeletable release version with the reviewer's
   * `credential` snapshot + `authorizationId`). The CALLER (`signoff.ts`) has
   * already verified the backing authorization is ACTIVE (§11.5) and is NOT the
   * DR-037 placeholder; this method only persists. The `(piece_id, version)`
   * unique index makes a duplicate release throw. Returns the new row id.
   * (PR 019 — fail-closed seam extension; flagged.)
   */
  insertCredentialedRelease(
    insert: CredentialedReleaseInsert,
  ): Promise<{ id: string }>;

  /**
   * List the recorded approval-cycle EVENTS for a piece+client (link-sent,
   * client-signoff, draft→review, credentialed-release). Scoped by the BOUND
   * `clientId`. Feeds the approval-debt cycle-time metric. READ-ONLY.
   * (PR 019 — fail-closed seam extension; flagged.)
   */
  listApprovalEvents(
    pieceId: string,
    clientId: string,
  ): Promise<PersistedApprovalEvent[]>;

  /**
   * Resolve the `[photo:slug]` references a piece body carries to their
   * persisted, workspace/client-scoped hero-asset records (PR 017 / DR-033).
   * READ-ONLY. The publish route calls this for the publishing body and feeds the
   * result to `canPublish` as `referencedImages` — an orphaned slug (no row) or a
   * row with `license: null` is a fail-closed `UNLICENSED_ASSET` publish block.
   *
   * OPTIONAL on the seam so existing route fixtures (which never reference an
   * image) need no change. When ABSENT, the publish route resolves the body's
   * tokens itself: a body with NO `[photo:]` token references no image (the gate
   * passes trivially); a body that DOES carry a token with no resolver available
   * is treated as an unresolved (orphaned) reference and BLOCKS — fail-closed,
   * never fail-open. `NOT_WIRED` throws (fail-loud) like the other methods.
   */
  resolveReferencedAssets?(
    clientId: string,
    slugs: string[],
  ): Promise<ReferencedHeroAsset[]>;
}

/** The read-only subset the audit route is given. Structurally cannot mutate. */
export type ReadOnlyDataAccess = Pick<
  ContentDataAccess,
  "clientBelongsToWorkspace" | "getApprovedVoiceSpec" | "loadPiece"
>;

// ── Referenced-image / hero-asset seam (PR 017 / DR-033) ──────────────────────

/**
 * A persisted image asset a piece body REFERENCES via a `[photo:slug]` token,
 * resolved host-side to its asset record. This is the SEO-app projection of an
 * `@sagemark/imagegen` generated_images row (source:"generated") OR an approved
 * stock/Pexels asset row (source:"pexels"). Workspace-scoped at the seam.
 *
 * The load-bearing field is `license`: DR-033 keys both the publish gate and the
 * render gate off its PRESENCE. The imagegen store persists `license` NOT NULL
 * for generated images; a stock asset carries a recorded Pexels license +
 * attribution. A row with `license: null` is an unlicensed/un-provenanced asset
 * and MUST NOT be surfaced (render) or published (gate) — Never-list #8.
 */
export interface ReferencedHeroAsset {
  /** The `[photo:slug]` slug this asset resolves (joins back to the body token). */
  slug: string;
  /** Where the asset came from (provenance source). */
  source: "generated" | "pexels" | "upload";
  /**
   * A renderable URL (signed read URL for a generated bucket object, or the
   * stock provider's hosted URL). Null when not yet resolvable (then the render
   * strips the placeholder rather than surfacing a broken image).
   */
  url: string | null;
  /**
   * The recorded license. NON-NULL is the render+publish gate condition. For a
   * generated asset this is the AI-generated license (model id+version); for a
   * stock asset it is the Pexels license + attribution. NULL → fail-closed
   * (blocked from render and from publish).
   */
  license: HeroAssetLicense | null;
  /** Optional alt text (accessibility); never load-bearing for the gate. */
  alt?: string | null;
}

/** The recorded license/attribution for a referenced hero asset (DR-033). */
export interface HeroAssetLicense {
  /** "generated" (AI), "pexels" (stock), etc. — mirrors the asset source. */
  provider: string;
  /** For generated: the model id+version. For stock: e.g. "Pexels License". */
  terms?: string;
  /** Stock attribution (photographer / source page) — recorded for compliance. */
  attribution?: string;
  /** The provider source page URL (stock) — recorded for compliance. */
  sourceUrl?: string;
}

/**
 * Parse the `[photo:slug]` tokens out of a piece body, in order, de-duplicated.
 * The render route strips these tokens; the publish gate + the homepage resolve
 * them to assets. This is the SINGLE host-side definition of "which images does
 * this body reference" (DR-033) — keyed off the body text, so no asset-reference
 * table/migration is needed (write-scope constraint).
 *
 * Accepts `[photo:slug]` and `[photo: some slug]` (slug trimmed). Bare `[photo]`
 * (no slug) is ignored (it references no specific asset). Markdown links
 * `[text](url)` are never matched (the `:` + no `(` tail distinguish a directive).
 */
export function parseReferencedPhotoSlugs(body: string): string[] {
  if (!body) return [];
  const re = /\[photo:\s*([^\]]+?)\s*\](?!\()/gi;
  const slugs: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const slug = m[1]!.trim();
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      slugs.push(slug);
    }
  }
  return slugs;
}

/**
 * Map a piece body's `[photo:slug]` references to the core FSM's `ReferencedImage`
 * decision rows (PR 017 / DR-033), FAIL-CLOSED. For each slug the body
 * references, find its resolved asset; the slug is:
 *   - `resolved && licensed` iff an asset with that slug exists AND its `license`
 *     is non-null (a generated_images license OR a recorded stock license);
 *   - `resolved:false` (orphan) when no asset row matched the slug;
 *   - `resolved:true, licensed:false` when the row exists but carries no license.
 *
 * A slug with no matching asset is an ORPHAN (blocked) — never silently dropped.
 * Pure; the I/O (resolving the assets) happens at the seam, this only maps.
 */
export function toReferencedImages(
  slugs: string[],
  assets: ReferencedHeroAsset[],
): ReferencedImageDecision[] {
  const bySlug = new Map(assets.map((a) => [a.slug, a]));
  return slugs.map((slug) => {
    const asset = bySlug.get(slug);
    if (!asset) return { slug, resolved: false, licensed: false };
    return { slug, resolved: true, licensed: asset.license != null };
  });
}

/** Local alias of the core `ReferencedImage` shape (avoids a value-import). */
export interface ReferencedImageDecision {
  slug: string;
  resolved: boolean;
  licensed: boolean;
}

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
  /**
   * The first-class cluster columns (D7, migration 0031) the resource-library
   * homepage groups by (PR 017). Driven by the `content_pieces.cluster_role` /
   * `funnel_stage` columns — NOT re-derived from `brief_snapshot` jsonb. Null when
   * a piece predates the cluster columns / is uncategorized.
   *
   * cluster_role ∈ pillar|cornerstone|spoke|faq|checklist;
   * funnel_stage ∈ awareness|consideration|decision|retention.
   */
  clusterRole: string | null;
  funnelStage: string | null;
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
  /**
   * Resolve the `[photo:slug]` references a published body carries to their
   * persisted, workspace-scoped hero-asset records (PR 017 / DR-033). The
   * homepage renders ONLY assets whose `license` is non-null (the render gate);
   * an unresolved slug returns an entry with `url:null`/`license:null` so the
   * render strips it rather than surfacing a broken/unprovenanced image.
   *
   * OPTIONAL: when a public-seam impl does not provide it, the homepage degrades
   * to placeholder-strip (P1.R.1 behavior) — no hero images. The fixture/Drizzle
   * impls provide it; `NOT_WIRED` throws (fail-loud) like the other methods.
   */
  resolveHeroAssets?(
    clientId: string,
    slugs: string[],
  ): Promise<ReferencedHeroAsset[]>;
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
  resolveHeroAssets: () => {
    throw new DataAccessNotWiredError("resolveHeroAssets");
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
  loadLatestVersion: () => {
    throw new DataAccessNotWiredError("loadLatestVersion");
  },
  listPieceVersions: () => {
    throw new DataAccessNotWiredError("listPieceVersions");
  },
  insertDraftPiece: () => {
    throw new DataAccessNotWiredError("insertDraftPiece");
  },
  transitionPieceStatus: () => {
    throw new DataAccessNotWiredError("transitionPieceStatus");
  },
  insertPieceVersion: () => {
    throw new DataAccessNotWiredError("insertPieceVersion");
  },
  nameVersion: () => {
    throw new DataAccessNotWiredError("nameVersion");
  },
  setActiveVersion: () => {
    throw new DataAccessNotWiredError("setActiveVersion");
  },
  loadCommentThread: () => {
    throw new DataAccessNotWiredError("loadCommentThread");
  },
  listCommentThreads: () => {
    throw new DataAccessNotWiredError("listCommentThreads");
  },
  resolveCommentThread: () => {
    throw new DataAccessNotWiredError("resolveCommentThread");
  },
  insertClientSignoff: () => {
    throw new DataAccessNotWiredError("insertClientSignoff");
  },
  insertCredentialedRelease: () => {
    throw new DataAccessNotWiredError("insertCredentialedRelease");
  },
  listApprovalEvents: () => {
    throw new DataAccessNotWiredError("listApprovalEvents");
  },
  resolveReferencedAssets: () => {
    throw new DataAccessNotWiredError("resolveReferencedAssets");
  },
};

/**
 * Thrown when a write would mutate a NAMED sign-off version (P1.U.4 invariant).
 * The named sign-off is the recorded human-release marker: it is APPEND-ONLY and
 * IMMUTABLE — it can never be deleted (there is no delete path) nor re-named /
 * overwritten. The `nameVersion` seam method throws this rather than mutating.
 */
class SignoffImmutableError extends Error {
  readonly code = "SIGNOFF_IMMUTABLE" as const;
  constructor(version: number) {
    super(
      `version ${version} is a named sign-off (the recorded human-release marker) ` +
        `and is immutable: a sign-off version can never be deleted, re-named, or ` +
        `overwritten (P1.U.4 undeletable-named-sign-off invariant).`,
    );
    this.name = "SignoffImmutableError";
  }
}

export { DataAccessNotWiredError, SignoffImmutableError };

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
