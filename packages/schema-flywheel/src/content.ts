/**
 * SEO Creator content store — Drizzle table definitions (PR 004, lane
 * schema-tenancy). Ported from flywheel-main `origin/preview`
 * `packages/schema-flywheel/src/index.ts` (the `content_clients` /
 * `content_pieces` / `content_piece_versions` / `voice_specs` tables), with
 * three additions required by the SEO Creator RFC § PR 004:
 *
 *   1. `cluster_role` + `funnel_stage` promoted to first-class CHECK-constrained
 *      columns on `content_pieces` (D7). Migration: drizzle/0031.
 *   2. `review_comments` — the per-version reviewer annotation table referenced
 *      by the RLS contract (anon must see zero rows). It does not exist on
 *      flywheel-main origin/preview; authored here. Migration: drizzle/0030.
 *   3. The byline-authorization + release/signoff split as THREE distinct
 *      tables — `byline_authorizations` (the §11.5 consent record + FK target),
 *      `client_signoffs` (advisory), and `credentialed_releases` (the only
 *      record canPublish() accepts). Migration: drizzle/0032.
 *
 * The authoritative target for the NEW release-split tables (0032) is the RFC
 * inline SQL. The content tables (0030) are faithful ports of origin/preview.
 *
 * RLS lives in the migration SQL, not here (Drizzle does not model policies).
 * Fail-closed: anon may read ONLY `content_pieces` rows with status='published';
 * every other table has RLS enabled with no anon policy at all — including
 * `content_clients`, the tenant root / workspace<->client tenancy map, whose RLS
 * is enabled by migration drizzle/0033 (audit-001).
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  numeric,
  boolean,
  uuid,
  pgEnum,
  index,
  jsonb,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Enums (ported from origin/preview).
// ---------------------------------------------------------------------------

export const contentStatusEnum = pgEnum("content_status", [
  "draft",
  "review",
  "approved",
  "published",
  "archived",
]);

export const contentVerdictEnum = pgEnum("content_verdict", [
  "PUBLISH",
  "REVIEW",
  "REVISE",
  "REJECT",
]);

// cluster_role / funnel_stage are modelled as CHECK-constrained `text` columns
// (NOT pgEnum) to mirror the RFC inline 0031 SQL exactly — the migration uses a
// `CHECK (... IN (...))`, not a Postgres enum type. Keeping the Drizzle column a
// plain `text` with a `check()` means `drizzle:generate` reproduces the same
// constraint and produces no drift against the hand-written 0031 migration.
export const CLUSTER_ROLES = [
  "pillar",
  "cornerstone",
  "spoke",
  "faq",
  "checklist",
] as const;
export const FUNNEL_STAGES = [
  "awareness",
  "consideration",
  "decision",
  "retention",
] as const;
export type ClusterRole = (typeof CLUSTER_ROLES)[number];
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

// ---------------------------------------------------------------------------
// Content tenant root (separate from any accounting `clients` — OQ-1).
// `workspace_id` is the layer-3 workspace_id -> client_id tenancy bridge.
// ---------------------------------------------------------------------------

// RLS: enabled, fail-closed with NO anon policy (migration drizzle/0033,
// audit-001). This is the tenancy MAP — anon must reach ZERO rows.
export const contentClients = pgTable(
  "content_clients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    blogSlug: text("blog_slug").notNull().unique(),
    // Owning workspace — the layer-3 workspace_id->client_id tenancy bridge.
    workspaceId: uuid("workspace_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("content_clients_workspace_idx").on(t.workspaceId)],
);

// One row per content piece. Slug is unique *per client*.
export const contentPieces = pgTable(
  "content_pieces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => contentClients.id, { onDelete: "restrict" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    body: text("body").default("").notNull(),
    excerpt: text("excerpt"),
    metaDescription: text("meta_description"),
    status: contentStatusEnum("status").default("draft").notNull(),
    version: integer("version").default(1).notNull(),
    isYmyl: boolean("is_ymyl").default(false).notNull(),
    // Soft reference into the voice-spec `authors[]` registry, not a hard FK.
    authorId: uuid("author_id"),
    evalScore: integer("eval_score"),
    verdict: contentVerdictEnum("verdict"),
    // D7 — cluster_role + funnel_stage promoted to first-class columns.
    clusterRole: text("cluster_role"),
    funnelStage: text("funnel_stage"),
    dimensions: jsonb("dimensions"),
    faqData: jsonb("faq_data"),
    briefSnapshot: jsonb("brief_snapshot"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("content_pieces_client_slug_unique").on(t.clientId, t.slug),
    index("content_pieces_client_status_idx").on(t.clientId, t.status),
    index("content_pieces_client_published_at_idx").on(
      t.clientId,
      t.publishedAt,
    ),
    index("content_pieces_cluster_idx").on(
      t.clientId,
      t.clusterRole,
      t.funnelStage,
    ),
    check(
      "content_pieces_cluster_role_check",
      sql`${t.clusterRole} IN ('pillar','cornerstone','spoke','faq','checklist')`,
    ),
    check(
      "content_pieces_funnel_stage_check",
      sql`${t.funnelStage} IN ('awareness','consideration','decision','retention')`,
    ),
  ],
);

// Immutable snapshot written before every forward FSM move. `client_id` is
// denormalized so a future tenant-read policy needs no join.
export const contentPieceVersions = pgTable(
  "content_piece_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pieceId: uuid("piece_id")
      .notNull()
      .references(() => contentPieces.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull(),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    dimensions: jsonb("dimensions"),
    verdict: contentVerdictEnum("verdict"),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("content_piece_versions_piece_version_unique").on(
      t.pieceId,
      t.version,
    ),
    index("content_piece_versions_client_idx").on(t.clientId),
  ],
);

// Canonical brand voice. A row with `approved_at IS NULL` is a draft spec; the
// pipeline hard-stops unless an approved spec exists.
export const voiceSpecs = pgTable(
  "voice_specs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => contentClients.id, { onDelete: "restrict" }),
    spec: jsonb("spec").notNull(),
    bootstrappedFrom: text("bootstrapped_from"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("voice_specs_client_version_unique").on(t.clientId, t.version),
    index("voice_specs_approved_idx")
      .on(t.clientId)
      .where(sql`${t.approvedAt} IS NOT NULL`),
  ],
);

// Per-version reviewer annotation. Not present on flywheel-main origin/preview;
// authored here because the RLS contract requires anon to read zero rows.
// `client_id` is denormalized (same pattern as content_piece_versions) so a
// future tenant-read policy needs no join.
export const reviewComments = pgTable(
  "review_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pieceId: uuid("piece_id")
      .notNull()
      .references(() => contentPieces.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull(),
    version: integer("version").notNull(),
    authorId: uuid("author_id").notNull(),
    body: text("body").notNull(),
    resolved: boolean("resolved").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("review_comments_piece_idx").on(t.pieceId, t.version),
    index("review_comments_client_idx").on(t.clientId),
  ],
);

// ---------------------------------------------------------------------------
// Byline authorization + release/signoff split (RFC § PR 004, migration 0032).
// THREE distinct tables — the split is load-bearing for PR 009's canPublish().
// ---------------------------------------------------------------------------

export const BYLINE_SCOPES = ["client", "cluster", "piece"] as const;
export const RELEASE_SCOPES = ["piece", "section"] as const;
export type BylineScope = (typeof BYLINE_SCOPES)[number];
export type ReleaseScope = (typeof RELEASE_SCOPES)[number];

// The §11.5 consent/authorization record backing every published byline.
// Created BEFORE credentialed_releases so the authorization_id FK target
// exists. A byline is attachable only while an ACTIVE authorization exists
// (granted_at set, revoked_at IS NULL, expires_at NULL or in the future).
export const bylineAuthorizations = pgTable(
  "byline_authorizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => contentClients.id, { onDelete: "restrict" }),
    // → voice_specs.authors[] entry (soft reference).
    authorId: uuid("author_id").notNull(),
    // Snapshot {name, credentials} captured at grant time.
    credential: jsonb("credential").notNull(),
    scope: text("scope").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Nullable: no expiry.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    // Nullable: revocation is a new state, never a delete.
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    // The operator who recorded the authorization.
    authorizedBy: uuid("authorized_by").notNull(),
    // DR-037 go-live guard (migration 0038). TRUE only on the seeded PILOT
    // placeholder reviewer ("Pending Clinical Reviewer", RN). A real
    // authorization is `false`. signoff.ts REFUSES a credentialed-release write
    // backed by a placeholder authorization in a non-pilot/production context.
    placeholder: boolean("placeholder").default(false).notNull(),
  },
  (t) => [
    index("byline_authorizations_client_idx").on(t.clientId),
    index("byline_authorizations_author_idx").on(t.authorId),
    // active-authorization lookup (granted ∧ ¬revoked ∧ ¬expired)
    index("byline_authorizations_active_idx").on(
      t.clientId,
      t.authorId,
      t.revokedAt,
      t.expiresAt,
    ),
    check("byline_authorizations_scope_check", sql`${t.scope} IN ('client','cluster','piece')`),
  ],
);

// ADVISORY client/agency-contact approval — can NEVER release or supply a
// byline. Deliberately NO credential, NO authorization_id: a client_signoff
// cannot satisfy canPublish() nor populate a byline. `release_type` is pinned.
export const clientSignoffs = pgTable(
  "client_signoffs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => contentClients.id, { onDelete: "restrict" }),
    pieceId: uuid("piece_id")
      .notNull()
      .references(() => contentPieces.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    // Structurally fixed — a client_signoff can ONLY ever be a client_signoff.
    releaseType: text("release_type").default("client_signoff").notNull(),
    // The client/agency contact.
    actorId: uuid("actor_id").notNull(),
    releaseScope: text("release_scope").notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("client_signoffs_piece_idx").on(t.pieceId, t.version),
    index("client_signoffs_client_idx").on(t.clientId),
    check(
      "client_signoffs_release_type_check",
      sql`${t.releaseType} = 'client_signoff'`,
    ),
    check(
      "client_signoffs_release_scope_check",
      sql`${t.releaseScope} IN ('piece','section')`,
    ),
  ],
);

// The ONLY record that satisfies canPublish()'s human-release precondition
// (D6 credentialed reviewer). Carries a non-null credential snapshot + a
// non-null FK → byline_authorizations (the §11.5 consent record). UNIQUE per
// (piece, version): one credentialed release per version.
export const credentialedReleases = pgTable(
  "credentialed_releases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => contentClients.id, { onDelete: "restrict" }),
    pieceId: uuid("piece_id")
      .notNull()
      .references(() => contentPieces.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    releaseType: text("release_type").default("credentialed_release").notNull(),
    // The credentialed reviewer (D6).
    actorId: uuid("actor_id").notNull(),
    // Snapshot {name, credentials} at release (byline evidence).
    credential: jsonb("credential").notNull(),
    // FK → §11.5 byline-authorization record. Non-null, ON DELETE RESTRICT.
    authorizationId: uuid("authorization_id")
      .notNull()
      .references(() => bylineAuthorizations.id, { onDelete: "restrict" }),
    releaseScope: text("release_scope").notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("credentialed_releases_piece_version_unique").on(
      t.pieceId,
      t.version,
    ),
    index("credentialed_releases_client_idx").on(t.clientId),
    index("credentialed_releases_auth_idx").on(t.authorizationId),
    check(
      "credentialed_releases_release_type_check",
      sql`${t.releaseType} = 'credentialed_release'`,
    ),
    check(
      "credentialed_releases_release_scope_check",
      sql`${t.releaseScope} IN ('piece','section')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Worker session persistence (PR 006 / P0.W.2, migration 0034).
//
// Host-side durable state for the autonomous Agent-SDK worker. The worker runs
// in an ephemeral Sandbox microVM with no Supabase creds + a wiped working dir,
// so run state lives HERE (written by the host service role) and is reloaded to
// reconstruct a run after teardown. Holds STATE ONLY — never a secret. RLS is
// enabled fail-closed with NO anon policy (the 0032/0033 pattern); service-role
// is the only access path.
// ---------------------------------------------------------------------------

export const WORKER_SESSION_STATUSES = ["running", "completed", "error"] as const;
export type WorkerSessionStatus = (typeof WORKER_SESSION_STATUSES)[number];

export const workerSessions = pgTable(
  "worker_sessions",
  {
    // Natural key — the run id the bridge / reload uses.
    runId: text("run_id").primaryKey(),
    // Tenancy binding (acceptance #3), denormalized for re-verification on reload.
    workspaceId: uuid("workspace_id").notNull(),
    clientId: uuid("client_id").notNull(),
    // The Agent-SDK session id (resume key); null until the loop emits it.
    agentSessionId: text("agent_session_id"),
    // running | completed | error (error is terminal, acceptance #4).
    status: text("status").default("running").notNull(),
    // Opaque loop/agent state blob.
    state: jsonb("state").default(sql`'{}'::jsonb`).notNull(),
    // The VM lease this run holds; nulled on release (acceptance #4/#5).
    leaseId: text("lease_id"),
    // The terminal-error event payload, set when status = 'error' (acceptance #4).
    terminalError: jsonb("terminal_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("worker_sessions_tenant_idx").on(t.workspaceId, t.clientId),
    index("worker_sessions_status_idx").on(t.status),
    index("worker_sessions_lease_idx")
      .on(t.leaseId)
      .where(sql`${t.leaseId} IS NOT NULL`),
    check(
      "worker_sessions_status_check",
      sql`${t.status} IN ('running','completed','error')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// ImageGen Stage-2 persistence (@sagemark/imagegen, migration 0035).
//
// `generatedImages` — durable generated-image asset rows. Dedup by the UNIQUE
// (workspace_id, content_hash) index (findAssetByHash exploits it). Every row
// carries the AI-generated license blob (Never-list #8). `imageGenerations` —
// the per-inference audit log, written EVEN ON DEDUP so every spend is
// accounted. Both are RLS-enabled fail-closed with NO anon policy (the
// 0032/0033 pattern): generated images are private until referenced inside a
// published content_piece. Service-role (operator / imagegen) is the only
// access path.
// ---------------------------------------------------------------------------

export const generatedImages = pgTable(
  "generated_images",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    // Nullable: not supplied to the Stage-1 insertAsset contract (it arrives at
    // insertGenerationRecord time and is recorded in image_generations).
    clientId: uuid("client_id"),
    // sha256 hex of the stored bytes (the dedup key).
    contentHash: text("content_hash").notNull(),
    bucket: text("bucket").notNull(),
    storageKey: text("storage_key").notNull(),
    bytes: integer("bytes").notNull(),
    // Derived from the storage-key extension at insert.
    contentType: text("content_type").notNull(),
    // Pinned gateway model id (derived from the model:<id> tag) + nullable version.
    model: text("model").notNull(),
    modelVersion: text("model_version"),
    // sha256 of the compiled prompt. Nullable: not supplied to insertAsset.
    promptHash: text("prompt_hash"),
    // The page slug / brief id this image was generated for (migration 0037,
    // C.021.2/DR-035). Joins back to the `[photo:slug]` body token the publish
    // gate + homepage resolve. Nullable: pre-0037 rows / rejected generations
    // carry no slug → that token resolves to NO row → fail-closed orphan-block.
    slug: text("slug"),
    // Generation seed, if the provider returned one. Modeled as bigint
    // (driver returns it as a string) — seeds can exceed 2^31.
    seed: bigint("seed", { mode: "bigint" }),
    // AI-generated license/provenance blob (Never-list #8).
    license: jsonb("license").notNull(),
    // SynthID/C2PA/revised-prompt lineage flags captured at write time.
    provenance: jsonb("provenance"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // Dedup: one stored asset per (workspace, content-hash).
    uniqueIndex("generated_images_ws_hash_unique").on(
      t.workspaceId,
      t.contentHash,
    ),
    index("generated_images_client_idx").on(t.clientId),
    // The image-resolver lookup key (migration 0037): workspace-scoped + slug-
    // matched. Serves `WHERE workspace_id = $1 AND slug = ANY($2)`.
    index("generated_images_workspace_slug_idx").on(t.workspaceId, t.slug),
  ],
);

export const imageGenerations = pgTable(
  "image_generations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    clientId: uuid("client_id").notNull(),
    // Written even on dedup (→ the existing asset). Nullable for rejected/failed.
    assetId: uuid("asset_id").references(() => generatedImages.id, {
      onDelete: "set null",
    }),
    model: text("model").notNull(),
    // Provider-reported cost (nullable).
    costReported: numeric("cost_reported"),
    // succeeded | rejected | failed.
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("image_generations_ws_idx").on(t.workspaceId),
    index("image_generations_asset_idx").on(t.assetId),
  ],
);

// ---------------------------------------------------------------------------
// Tokenized client-review surface (PR 018 / P1.C.1, migration 0036).
//
// `reviewTokens` — the opaque-token boundary. One row per issued review link; a
// SHA-256 hash of the opaque token (NEVER the token itself) resolves to EXACTLY
// ONE (workspace_id, client_id, piece_id, version) tuple. The token is a
// FAIL-CLOSED ROW-SCOPED boundary, never a render-time flag: a token for client
// A can never resolve client B's piece or another version (the unique
// token_hash → one tuple is the structural guarantee). `commentThreads` — the
// element-anchored pins (normalized 0..1 anchor + elementHint) + the section
// verbs (section-approve | request-changes), scoped by workspace_id/client_id.
// Both RLS-enabled fail-closed with NO anon policy (the 0032/0033/0035 pattern,
// DR-023): tokens resolve + comments write through the service-role seam only;
// anon reaches ZERO rows.
//
// The `version` column on commentThreads records the version a pin/verb was left
// on (the AC's `version_left_on`, reconciled to the canonical `version` column —
// see drizzle/0036_comment_threads.sql header).
// ---------------------------------------------------------------------------

export const COMMENT_THREAD_KINDS = [
  "pin",
  "section-approve",
  "request-changes",
] as const;
export const COMMENT_THREAD_STATUSES = ["open", "resolved"] as const;
export type CommentThreadKind = (typeof COMMENT_THREAD_KINDS)[number];
export type CommentThreadStatus = (typeof COMMENT_THREAD_STATUSES)[number];

export const reviewTokens = pgTable(
  "review_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // SHA-256 hex of the opaque token (the lookup key). The opaque token is
    // NEVER stored — a DB leak does not hand out a working review link.
    tokenHash: text("token_hash").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => contentClients.id, { onDelete: "cascade" }),
    pieceId: uuid("piece_id")
      .notNull()
      .references(() => contentPieces.id, { onDelete: "cascade" }),
    // The single version this token grants read of (cross-version → no match).
    version: integer("version").notNull(),
    // Optional expiry; null = never expires.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    // Revocation is a new state, never a delete.
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // One tuple per token hash — the structural one-tuple guarantee.
    uniqueIndex("review_tokens_token_hash_unique").on(t.tokenHash),
    index("review_tokens_tuple_idx").on(
      t.workspaceId,
      t.clientId,
      t.pieceId,
      t.version,
    ),
  ],
);

export const commentThreads = pgTable(
  "comment_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => contentClients.id, { onDelete: "cascade" }),
    pieceId: uuid("piece_id")
      .notNull()
      .references(() => contentPieces.id, { onDelete: "cascade" }),
    // The version this comment was left on (version_left_on, reconciled).
    version: integer("version").notNull(),
    // pin | section-approve | request-changes.
    kind: text("kind").notNull(),
    // Normalized pin anchor { x:0..1, y:0..1, elementHint?, ... }; null for a
    // non-anchored section verb. Coords validated finite+[0,1] before insert.
    anchor: jsonb("anchor"),
    body: text("body").default("").notNull(),
    // The reviewer (client contact); opaque id, no FK to auth yet.
    author: text("author").notNull(),
    status: text("status").default("open").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // RFC §133 index.
    index("comment_threads_piece_version_status_idx").on(
      t.pieceId,
      t.version,
      t.status,
    ),
    index("comment_threads_tenant_idx").on(t.workspaceId, t.clientId),
    check(
      "comment_threads_kind_check",
      sql`${t.kind} IN ('pin','section-approve','request-changes')`,
    ),
    check(
      "comment_threads_status_check",
      sql`${t.status} IN ('open','resolved')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// SEO AI-Gateway cost ledger (D4) + share-of-model KPI (PR 020 / P1.C.3,
// migration 0039).
//
// `seoCostLedger` — the per-(run_id, stage) AI-Gateway cost ledger. A row is
// RESERVED pre-flight (`reservedUsd`) via a lock-row CONDITIONAL UPDATE
// (apps/seo/src/lib/ledger/reserve-conditional.ts — NOT sum-then-check), then
// reconciled with the Gateway-reported `actualUsd` + `latencyMs` + `model` once
// the call returns. A run's measured per-piece cost = SUM(actualUsd) over its
// rows, against the ≤$2 editorial target (RUN_COST_CAP_USD).
//
// `shareOfModel` — the north-star AI-answer-engine citation-tracking table. One
// row per (client_id, engine, query) citation check; `cited`/`position` roll up
// to a per-hub citation rate. Engines: ChatGPT · Claude · Gemini (DR-038).
// `sourceChannel` is free-text carrying the HYBRID 3-channel model (DR-038
// addendum): 'direct-citation' (a REAL cited source) | 'direct-proxy' (a
// model-API answer = a MENTION proxy, NEVER summed as a citation) | 'vendor'
// (GEO-tracker, deferred). The .default("direct") below is a legacy sentinel;
// the live store writes the hybrid labels.
//
// Both RLS-enabled fail-closed with NO anon policy (the 0032/0033/0035/0036
// pattern, DR-023): cost + share-of-model are billing / competitive-intelligence
// data, NEVER public. Read/written ONLY through the service-role seam (every
// query carries an explicit workspace_id + client_id filter; service role
// bypasses RLS, so the app filter is the tenancy boundary).
// ---------------------------------------------------------------------------

export const seoCostLedger = pgTable(
  "seo_cost_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => contentClients.id, { onDelete: "restrict" }),
    // A deleted piece must not orphan-delete its billing record.
    pieceId: uuid("piece_id").references(() => contentPieces.id, {
      onDelete: "set null",
    }),
    runId: uuid("run_id").notNull(),
    stage: text("stage").notNull(),
    // Reserved pre-flight via a lock-row conditional UPDATE (NOT sum-then-check).
    reservedUsd: numeric("reserved_usd", { precision: 10, scale: 4 })
      .default("0")
      .notNull(),
    // Gateway-reported actuals (null until the call returns + is reconciled).
    actualUsd: numeric("actual_usd", { precision: 10, scale: 4 }),
    model: text("model"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // Per-run rollup (the reconciliation reads/sums by run_id).
    index("seo_cost_ledger_run_idx").on(t.runId),
    // Per-client cost over time.
    index("seo_cost_ledger_client_idx").on(t.clientId, t.createdAt),
  ],
);

// `seoCostRunBudget` — the per-run accumulator: the single lock-row the
// conditional-UPDATE reservation targets (one row per run_id). `reservedUsd` is
// atomically incremented under the DB row lock by RESERVE_CONDITIONAL_SQL with
// the `reserved_usd + cost <= cap_usd` guard, so a concurrent over-cap
// reservation is rejected by the predicate (no sum-then-check race). `capUsd` is
// the run's editorial cost cap (<= $2), set when the budget row is created.
export const seoCostRunBudget = pgTable(
  "seo_cost_run_budget",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => contentClients.id, { onDelete: "restrict" }),
    // ONE budget row per run (the conditional UPDATE locks this single row).
    runId: uuid("run_id").notNull().unique(),
    // Atomically incremented under the row lock; the conditional guard reads it.
    reservedUsd: numeric("reserved_usd", { precision: 10, scale: 4 })
      .default("0")
      .notNull(),
    // The run's cost cap (<= $2 editorial target); the conditional guard's ceiling.
    capUsd: numeric("cap_usd", { precision: 10, scale: 4 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("seo_cost_run_budget_tenant_idx").on(t.workspaceId, t.clientId)],
);

export const shareOfModel = pgTable(
  "share_of_model",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => contentClients.id, { onDelete: "restrict" }),
    pieceId: uuid("piece_id").references(() => contentPieces.id, {
      onDelete: "set null",
    }),
    // Free text: ChatGPT · Claude · Gemini (DR-038).
    engine: text("engine").notNull(),
    query: text("query").notNull(),
    cited: boolean("cited").notNull(),
    position: integer("position"),
    rawResponse: text("raw_response"),
    parserConf: numeric("parser_conf", { precision: 4, scale: 3 }),
    auditSampled: boolean("audit_sampled").default(false).notNull(),
    // Hybrid 3-channel label (DR-038 addendum): direct-citation | direct-proxy
    // (mention, NOT a citation) | vendor. .default("direct") = legacy sentinel;
    // the live store writes the hybrid labels.
    sourceChannel: text("source_channel").default("direct").notNull(),
    locale: text("locale"),
    deviceProfile: text("device_profile"),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("share_of_model_client_idx").on(t.clientId, t.capturedAt)],
);

// ---------------------------------------------------------------------------
// Relations.
// ---------------------------------------------------------------------------

export const contentClientsRelations = relations(
  contentClients,
  ({ many }) => ({
    pieces: many(contentPieces),
    voiceSpecs: many(voiceSpecs),
    bylineAuthorizations: many(bylineAuthorizations),
  }),
);

export const contentPiecesRelations = relations(
  contentPieces,
  ({ one, many }) => ({
    client: one(contentClients, {
      fields: [contentPieces.clientId],
      references: [contentClients.id],
    }),
    versions: many(contentPieceVersions),
    reviewComments: many(reviewComments),
    clientSignoffs: many(clientSignoffs),
    credentialedReleases: many(credentialedReleases),
  }),
);

export const contentPieceVersionsRelations = relations(
  contentPieceVersions,
  ({ one }) => ({
    piece: one(contentPieces, {
      fields: [contentPieceVersions.pieceId],
      references: [contentPieces.id],
    }),
  }),
);

export const voiceSpecsRelations = relations(voiceSpecs, ({ one }) => ({
  client: one(contentClients, {
    fields: [voiceSpecs.clientId],
    references: [contentClients.id],
  }),
}));

export const reviewCommentsRelations = relations(reviewComments, ({ one }) => ({
  piece: one(contentPieces, {
    fields: [reviewComments.pieceId],
    references: [contentPieces.id],
  }),
}));

export const bylineAuthorizationsRelations = relations(
  bylineAuthorizations,
  ({ one, many }) => ({
    client: one(contentClients, {
      fields: [bylineAuthorizations.clientId],
      references: [contentClients.id],
    }),
    releases: many(credentialedReleases),
  }),
);

export const clientSignoffsRelations = relations(clientSignoffs, ({ one }) => ({
  client: one(contentClients, {
    fields: [clientSignoffs.clientId],
    references: [contentClients.id],
  }),
  piece: one(contentPieces, {
    fields: [clientSignoffs.pieceId],
    references: [contentPieces.id],
  }),
}));

export const credentialedReleasesRelations = relations(
  credentialedReleases,
  ({ one }) => ({
    client: one(contentClients, {
      fields: [credentialedReleases.clientId],
      references: [contentClients.id],
    }),
    piece: one(contentPieces, {
      fields: [credentialedReleases.pieceId],
      references: [contentPieces.id],
    }),
    authorization: one(bylineAuthorizations, {
      fields: [credentialedReleases.authorizationId],
      references: [bylineAuthorizations.id],
    }),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types.
// ---------------------------------------------------------------------------

export type ContentClient = typeof contentClients.$inferSelect;
export type NewContentClient = typeof contentClients.$inferInsert;
export type ContentPiece = typeof contentPieces.$inferSelect;
export type NewContentPiece = typeof contentPieces.$inferInsert;
export type ContentPieceVersion = typeof contentPieceVersions.$inferSelect;
export type NewContentPieceVersion = typeof contentPieceVersions.$inferInsert;
export type VoiceSpec = typeof voiceSpecs.$inferSelect;
export type NewVoiceSpec = typeof voiceSpecs.$inferInsert;
export type ReviewComment = typeof reviewComments.$inferSelect;
export type NewReviewComment = typeof reviewComments.$inferInsert;
export type BylineAuthorization = typeof bylineAuthorizations.$inferSelect;
export type NewBylineAuthorization = typeof bylineAuthorizations.$inferInsert;
export type ClientSignoff = typeof clientSignoffs.$inferSelect;
export type NewClientSignoff = typeof clientSignoffs.$inferInsert;
export type CredentialedRelease = typeof credentialedReleases.$inferSelect;
export type NewCredentialedRelease = typeof credentialedReleases.$inferInsert;
export type ContentStatus = (typeof contentStatusEnum.enumValues)[number];
export type ContentVerdict = (typeof contentVerdictEnum.enumValues)[number];
export type WorkerSession = typeof workerSessions.$inferSelect;
export type NewWorkerSession = typeof workerSessions.$inferInsert;
export type GeneratedImage = typeof generatedImages.$inferSelect;
export type NewGeneratedImage = typeof generatedImages.$inferInsert;
export type ImageGeneration = typeof imageGenerations.$inferSelect;
export type NewImageGeneration = typeof imageGenerations.$inferInsert;
export type ReviewToken = typeof reviewTokens.$inferSelect;
export type NewReviewToken = typeof reviewTokens.$inferInsert;
export type CommentThread = typeof commentThreads.$inferSelect;
export type NewCommentThread = typeof commentThreads.$inferInsert;
export type SeoCostLedgerRow = typeof seoCostLedger.$inferSelect;
export type NewSeoCostLedgerRow = typeof seoCostLedger.$inferInsert;
export type SeoCostRunBudgetRow = typeof seoCostRunBudget.$inferSelect;
export type NewSeoCostRunBudgetRow = typeof seoCostRunBudget.$inferInsert;
export type ShareOfModelRow = typeof shareOfModel.$inferSelect;
export type NewShareOfModelRow = typeof shareOfModel.$inferInsert;
