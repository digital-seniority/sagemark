/**
 * RLS + tenancy contract tests for the SEO Creator content store (PR 004).
 *
 * Runner: Node's built-in test runner (no vitest config in apps/seo), invoked
 * with native TypeScript type-stripping (Node >= 22.6):
 *
 *     node --test apps/seo/test/tenancy/rls-contract.test.ts
 *
 * TIERS
 * -----
 *  - TIER 1 (ALWAYS RUNS, no DB): static assertions over the committed
 *    migration SQL. These prove the *shape* of the guarantees — RLS enabled on
 *    every table (including content_clients, the tenancy map — audit-001/0033),
 *    the anon policy is published-only and exists on NO other
 *    table, (client_id, slug) uniqueness, the cluster_role/funnel_stage CHECKs,
 *    the release/signoff split (client_signoffs has release_type pinned to
 *    'client_signoff' and NO credential/authorization_id columns;
 *    credentialed_releases carries a non-null credential + authorization_id FK
 *    + UNIQUE(piece_id, version)), and the byline_authorizations FK target with
 *    its scope CHECK + nullable expires_at/revoked_at.
 *
 *  - TIER 2 (RUNS when a Postgres is reachable): applies 0030+0031+0032+0033 to a
 *    live database and asserts the BEHAVIORAL criteria:
 *      * anon SELECT on content_pieces returns only status='published';
 *      * anon SELECT on content_clients (the tenancy map)/voice_specs/
 *        content_piece_versions/review_comments/byline_authorizations/
 *        client_signoffs/credentialed_releases returns zero rows;
 *      * an operator query scoped to workspace A returns zero rows for a piece
 *        owned by workspace B (cross-tenant);
 *      * cluster_role/funnel_stage CHECKs reject invalid enums;
 *      * a client_signoff cannot carry reviewer credentials (no such column);
 *      * a credentialed_release referencing a nonexistent authorization is
 *        rejected by the FK; ON DELETE RESTRICT blocks deleting a referenced
 *        authorization.
 *
 *    The Tier-2 path runs SQL through a `psql` runner. Two engines are
 *    supported, auto-detected in this order:
 *      (a) DATABASE_URL set         -> psql "$DATABASE_URL" (Supabase branch / CI)
 *      (b) RLS_TEST_PG_CONTAINER set -> docker exec <container> psql -U postgres
 *    If neither is available the Tier-2 tests are SKIPPED (never falsely
 *    passed) with a NEEDS-INPUT note naming the exact env to set.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const DRIZZLE_DIR = join(
  here,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "schema-flywheel",
  "drizzle",
);
const M0030 = readFileSync(join(DRIZZLE_DIR, "0030_content_pieces.sql"), "utf8");
const M0031 = readFileSync(
  join(DRIZZLE_DIR, "0031_cluster_funnel_columns.sql"),
  "utf8",
);
const M0032 = readFileSync(join(DRIZZLE_DIR, "0032_release_records.sql"), "utf8");
const M0033 = readFileSync(
  join(DRIZZLE_DIR, "0033_content_clients_rls.sql"),
  "utf8",
);
// 0035 — ImageGen Stage-2 persistence: generated_images + image_generations
// (RLS enabled, fail-closed, NO anon policy) + the dedup unique index.
const M0035 = readFileSync(
  join(DRIZZLE_DIR, "0035_generated_images.sql"),
  "utf8",
);
// 0037 — slug asset-linkage for generated images (C.021.2 / DR-035): the `slug`
// column + (workspace_id, slug) resolver index the publish/homepage image
// resolvers join on. Additive, idempotent, public-schema-only.
const M0037 = readFileSync(
  join(DRIZZLE_DIR, "0037_generated_image_slug.sql"),
  "utf8",
);
// 0034 — worker_sessions (host-side run state, RLS fail-closed, NO anon policy).
// Read here because conversation_turns.run_id FKs to worker_sessions.run_id, so
// Tier-2 must apply it before 0040.
const M0034 = readFileSync(
  join(DRIZZLE_DIR, "0034_worker_sessions.sql"),
  "utf8",
);
// 0040 — chat-first front-door run-session model: conversations +
// conversation_turns (both RLS enabled, fail-closed, NO anon policy).
const M0040 = readFileSync(join(DRIZZLE_DIR, "0040_conversations.sql"), "utf8");
// 0041 — operator identity + workspace membership: operators + workspaces +
// workspace_members (all three RLS enabled, fail-closed, NO anon policy — the
// tenancy root, the 0033 content_clients posture).
const M0041 = readFileSync(
  join(DRIZZLE_DIR, "0041_operators_workspaces.sql"),
  "utf8",
);
const ALL = [M0030, M0031, M0032, M0033, M0035, M0037, M0040, M0041].join("\n");
const flat = (s: string) => s.replace(/\s+/g, " ");
const FLAT = flat(ALL);

// Strip `--` line comments so prose like "NO credential" or "FK -> byline"
// never satisfies a structural substring/order assertion meant to inspect the
// actual DDL. (No `/* */` block comments are used in these migrations.)
const stripComments = (s: string) => s.replace(/--[^\n]*/g, "");
const M0032_CODE = stripComments(M0032);
const ALL_CODE = stripComments(ALL);

// ===========================================================================
// TIER 1 — static structural assertions (no DB). Always run.
// ===========================================================================

test("[T1] migration files are valid UTF-8 (no BOM, no replacement char)", () => {
  for (const f of [
    "0030_content_pieces.sql",
    "0031_cluster_funnel_columns.sql",
    "0032_release_records.sql",
    "0033_content_clients_rls.sql",
    "0035_generated_images.sql",
    "0037_generated_image_slug.sql",
  ]) {
    const bytes = readFileSync(join(DRIZZLE_DIR, f));
    assert.ok(
      !bytes.toString("utf8").includes("�"),
      `${f} contains an invalid UTF-8 byte`,
    );
    assert.notEqual(bytes[0], 0xef, `${f} must not start with a UTF-8 BOM`);
  }
});

test("[T1] RLS is ENABLED on every content + release table (fail-closed)", () => {
  for (const t of [
    // content_clients is the tenant ROOT (the workspace<->client tenancy map);
    // RLS enabled here, fail-closed with NO anon policy (audit-001, 0033).
    "content_clients",
    "content_pieces",
    "content_piece_versions",
    "voice_specs",
    "review_comments",
    "byline_authorizations",
    "client_signoffs",
    "credentialed_releases",
    // ImageGen Stage-2 (0035): both fail-closed, no anon policy.
    "generated_images",
    "image_generations",
    // Chat-first front door (0040): conversations + their turns, fail-closed.
    "conversations",
    "conversation_turns",
    // Operator/workspace tenancy root (0041): all three fail-closed (the 0033
    // content_clients posture — anon must never reach the tenancy map).
    "operators",
    "workspaces",
    "workspace_members",
  ]) {
    assert.match(
      FLAT,
      new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`, "i"),
      `RLS must be enabled on ${t}`,
    );
  }
});

test("[T1] the ONLY anon policy is published-only on content_pieces", () => {
  assert.match(
    FLAT,
    /CREATE POLICY content_pieces_public_read ON public\.content_pieces FOR SELECT TO anon USING \(status = 'published'\)/i,
  );
  // No anon policy may exist on any other table.
  for (const t of [
    "content_clients",
    "voice_specs",
    "content_piece_versions",
    "review_comments",
    "byline_authorizations",
    "client_signoffs",
    "credentialed_releases",
    // ImageGen Stage-2 (0035): private until referenced in published content.
    "generated_images",
    "image_generations",
    // Chat-first front door (0040) + tenancy root (0041): NO anon policy.
    "conversations",
    "conversation_turns",
    "operators",
    "workspaces",
    "workspace_members",
  ]) {
    assert.ok(
      !new RegExp(`CREATE\\s+POLICY[^;]*ON\\s+public\\.${t}\\b`, "i").test(ALL),
      `${t} must have NO policy (anon must not reach it)`,
    );
  }
  // Every `TO anon` policy across the migration set must be the published-only
  // read on content_pieces — there is no other anon grant. (0030 creates it and
  // 0031 re-asserts it via DROP-then-CREATE, so >1 occurrence is expected; what
  // matters is that EACH occurrence is the same published-only policy and no
  // anon policy targets any other table or relaxes the predicate.)
  const anonPolicies = [
    ...ALL_CODE.matchAll(/CREATE\s+POLICY\s+(\w+)\s+ON\s+public\.(\w+)[^;]*TO\s+anon[^;]*USING\s*\(([^)]*)\)/gi),
  ];
  assert.ok(anonPolicies.length >= 1, "the anon read policy must exist");
  for (const p of anonPolicies) {
    assert.equal(p[1], "content_pieces_public_read", `unexpected anon policy ${p[1]}`);
    assert.equal(p[2], "content_pieces", `anon policy on wrong table ${p[2]}`);
    assert.match(p[3], /status = 'published'/i, "anon policy must be published-only");
  }
});

test("[T1] (client_id, slug) uniqueness on content_pieces", () => {
  assert.match(
    FLAT,
    /CONSTRAINT content_pieces_client_slug_unique UNIQUE \(client_id, slug\)/i,
  );
});

test("[T1] generated_images dedup UNIQUE index on (workspace_id, content_hash)", () => {
  // The dedup backstop the Supabase store's findAssetByHash exploits (0035).
  assert.match(
    FLAT,
    /CREATE UNIQUE INDEX IF NOT EXISTS generated_images_ws_hash_unique\s+ON public\.generated_images \(workspace_id, content_hash\)/i,
  );
  // image_generations.asset_id FK → generated_images (audit row references the
  // kept asset even on dedup).
  assert.match(
    FLAT,
    /asset_id\s+uuid REFERENCES public\.generated_images\(id\)/i,
  );
  // The PRIVATE `seo-generated-images` storage bucket is provisioned OUT-OF-BAND
  // (storage admin), NOT in this migration — the migration role can't write the
  // `storage` schema. So the migration must contain NO `storage.` DDL/DML; bucket
  // coverage is verified out-of-band, not asserted here.
  assert.ok(
    !/\bstorage\./i.test(stripComments(M0035)),
    "0035 must not contain any storage.* SQL (bucket is created out-of-band)",
  );
});

test("[T1] 0037 adds generated_images.slug + (workspace_id, slug) index, additive + idempotent + public-only", () => {
  const code = stripComments(M0037);
  const flatCode = flat(code);
  // The slug column the image-resolver joins `[photo:slug]` tokens on.
  assert.match(
    flatCode,
    /ALTER TABLE public\.generated_images\s+ADD COLUMN IF NOT EXISTS slug text/i,
    "0037 must ADD COLUMN IF NOT EXISTS slug text on generated_images",
  );
  // The resolver lookup index: (workspace_id, slug).
  assert.match(
    flatCode,
    /CREATE INDEX IF NOT EXISTS generated_images_workspace_slug_idx\s+ON public\.generated_images \(workspace_id, slug\)/i,
    "0037 must create the (workspace_id, slug) resolver index",
  );
  // IDEMPOTENT: every DDL statement guarded with IF NOT EXISTS.
  assert.ok(
    /ADD COLUMN IF NOT EXISTS/i.test(code) &&
      /CREATE INDEX IF NOT EXISTS/i.test(code),
    "0037 statements must be idempotent (IF NOT EXISTS)",
  );
  // ADDITIVE-ONLY: no destructive verbs in the live SQL (down lives in comments).
  assert.ok(
    !/\bDROP\b/i.test(code),
    "0037 live SQL must not DROP anything (the down is comment-only)",
  );
  assert.ok(
    !/\bALTER COLUMN\b|\bDROP COLUMN\b|\bRENAME\b/i.test(code),
    "0037 must not alter/drop/rename any existing column",
  );
});

test("[T1] 0037 writes ONLY the public schema + uses NO superuser construct (pooled-role-can-run)", () => {
  const code = stripComments(M0037);
  // Public-schema only: no other schema is written, and no storage.* DDL/DML.
  assert.ok(
    !/\bstorage\./i.test(code),
    "0037 must not touch the storage schema (pooled migration role lacks it)",
  );
  // Every qualified object reference is public.* (the only schema this writes).
  const schemaRefs = [...code.matchAll(/\b(\w+)\.generated_images\b/gi)];
  for (const m of schemaRefs) {
    assert.equal(
      m[1].toLowerCase(),
      "public",
      `0037 must reference only public.generated_images, saw ${m[1]}.generated_images`,
    );
  }
  // NO superuser-only / role / ownership / event-trigger constructs.
  for (const banned of [
    /CREATE\s+EVENT\s+TRIGGER/i,
    /\bSET\s+ROLE\b/i,
    /\bALTER\s+.*OWNER\s+TO\b/i,
    /\bGRANT\b/i,
    /\bCREATE\s+EXTENSION\b/i,
    /SECURITY\s+DEFINER/i,
  ]) {
    assert.ok(
      !banned.test(code),
      `0037 must not use a superuser-only construct: ${banned}`,
    );
  }
});

test("[T1] cluster_role / funnel_stage CHECK constraints exist (D7)", () => {
  assert.match(
    FLAT,
    /cluster_role IN \('pillar','cornerstone','spoke','faq','checklist'\)/i,
  );
  assert.match(
    FLAT,
    /funnel_stage IN \('awareness','consideration','decision','retention'\)/i,
  );
});

test("[T1] client_id FK-scopes content/voice/release tables to content_clients ON DELETE RESTRICT", () => {
  // Every tenant-scoped table FKs client_id -> content_clients ON DELETE RESTRICT.
  const restrictFks = [
    ...FLAT.matchAll(
      /client_id\s+uuid NOT NULL REFERENCES public\.content_clients\(id\) ON DELETE RESTRICT/gi,
    ),
  ];
  // content_pieces, voice_specs, byline_authorizations, client_signoffs,
  // credentialed_releases = 5 client_id FKs.
  assert.ok(
    restrictFks.length >= 5,
    `expected >=5 client_id ON DELETE RESTRICT FKs, found ${restrictFks.length}`,
  );
});

// --- Release/signoff split (criterion 5) -----------------------------------

test("[T1] client_signoffs is structurally incapable of carrying a credential", () => {
  // Isolate the client_signoffs CREATE TABLE body (comment-free, so prose like
  // "NO credential, NO authorization_id" can't satisfy the negative assertion).
  const m = ALL_CODE.match(
    /CREATE TABLE IF NOT EXISTS public\.client_signoffs \(([\s\S]*?)\n\);/i,
  );
  assert.ok(m, "client_signoffs table must exist");
  const body = m![1];
  assert.ok(
    !/\bcredential\b/i.test(body),
    "client_signoffs must NOT have a credential column",
  );
  assert.ok(
    !/\bauthorization_id\b/i.test(body),
    "client_signoffs must NOT have an authorization_id column",
  );
  // release_type is pinned to 'client_signoff'.
  assert.match(
    flat(body),
    /release_type\s+text NOT NULL DEFAULT 'client_signoff' CHECK \(release_type = 'client_signoff'\)/i,
  );
});

test("[T1] credentialed_releases carries credential + authorization_id FK + UNIQUE(piece_id,version)", () => {
  const m = ALL_CODE.match(
    /CREATE TABLE IF NOT EXISTS public\.credentialed_releases \(([\s\S]*?)\n\);/i,
  );
  assert.ok(m, "credentialed_releases table must exist");
  const body = flat(m![1]);
  assert.match(body, /credential\s+jsonb NOT NULL/i);
  assert.match(
    body,
    /authorization_id uuid NOT NULL REFERENCES public\.byline_authorizations\(id\) ON DELETE RESTRICT/i,
  );
  assert.match(
    body,
    /release_type\s+text NOT NULL DEFAULT 'credentialed_release' CHECK \(release_type = 'credentialed_release'\)/i,
  );
  assert.match(
    body,
    /CONSTRAINT credentialed_releases_piece_version_unique UNIQUE \(piece_id, version\)/i,
  );
  // The two release types are SEPARATE TABLES, not a shared kind flag.
  assert.match(ALL, /CREATE TABLE IF NOT EXISTS public\.client_signoffs/i);
  assert.match(ALL, /CREATE TABLE IF NOT EXISTS public\.credentialed_releases/i);
});

// --- byline_authorizations FK target (criterion 6) -------------------------

test("[T1] byline_authorizations is the FK target with scope CHECK + nullable expires_at/revoked_at", () => {
  const m = ALL_CODE.match(
    /CREATE TABLE IF NOT EXISTS public\.byline_authorizations \(([\s\S]*?)\n\);/i,
  );
  assert.ok(m, "byline_authorizations table must exist");
  const body = flat(m![1]);
  assert.match(body, /scope\s+text NOT NULL CHECK \(scope IN \('client','cluster','piece'\)\)/i);
  // expires_at / revoked_at are nullable (no NOT NULL).
  assert.match(body, /expires_at\s+timestamptz,/i);
  assert.match(body, /revoked_at\s+timestamptz,/i);
  assert.ok(
    !/expires_at\s+timestamptz NOT NULL/i.test(body),
    "expires_at must be nullable",
  );
  assert.ok(
    !/revoked_at\s+timestamptz NOT NULL/i.test(body),
    "revoked_at must be nullable",
  );
  // The byline_authorizations CREATE TABLE must precede the
  // credentialed_releases CREATE TABLE in 0032 (FK target must exist first).
  assert.ok(
    M0032_CODE.indexOf("CREATE TABLE IF NOT EXISTS public.byline_authorizations") <
      M0032_CODE.indexOf("CREATE TABLE IF NOT EXISTS public.credentialed_releases"),
    "byline_authorizations must be declared before credentialed_releases",
  );
});

// --- Chat-first front door (0040) + tenancy root (0041) structural shape ----

test("[T1] conversations FK-scopes to content_clients (RESTRICT) + content_pieces (SET NULL, nullable piece_id) + status CHECK", () => {
  const m = ALL_CODE.match(
    /CREATE TABLE IF NOT EXISTS public\.conversations \(([\s\S]*?)\n\);/i,
  );
  assert.ok(m, "conversations table must exist");
  const body = flat(m![1]);
  // client_id is a hard FK ON DELETE RESTRICT (a client with threads can't vanish).
  assert.match(
    body,
    /client_id\s+uuid NOT NULL REFERENCES public\.content_clients\(id\) ON DELETE RESTRICT/i,
  );
  // piece_id is NULLABLE (no NOT NULL) and ON DELETE SET NULL (delete keeps thread).
  assert.match(
    body,
    /piece_id\s+uuid REFERENCES public\.content_pieces\(id\) ON DELETE SET NULL/i,
  );
  assert.ok(
    !/piece_id\s+uuid NOT NULL/i.test(body),
    "conversations.piece_id must be nullable",
  );
  assert.match(
    body,
    /status\s+text NOT NULL DEFAULT 'active'[\s\S]*CHECK \(status IN \('active','archived'\)\)/i,
  );
});

test("[T1] conversation_turns: cascade to conversations, run_id SET NULL FK -> worker_sessions, role CHECK, UNIQUE(conversation_id, seq)", () => {
  const m = ALL_CODE.match(
    /CREATE TABLE IF NOT EXISTS public\.conversation_turns \(([\s\S]*?)\n\);/i,
  );
  assert.ok(m, "conversation_turns table must exist");
  const body = flat(m![1]);
  assert.match(
    body,
    /conversation_id\s+uuid NOT NULL REFERENCES public\.conversations\(id\) ON DELETE CASCADE/i,
  );
  // run_id is text (matches worker_sessions.run_id text PK), nullable, SET NULL.
  assert.match(
    body,
    /run_id\s+text REFERENCES public\.worker_sessions\(run_id\) ON DELETE SET NULL/i,
  );
  assert.ok(
    !/run_id\s+text NOT NULL/i.test(body),
    "conversation_turns.run_id must be nullable",
  );
  assert.match(body, /role\s+text NOT NULL CHECK \(role IN \('user','agent'\)\)/i);
  assert.match(
    body,
    /CONSTRAINT conversation_turns_conversation_seq_unique UNIQUE \(conversation_id, seq\)/i,
  );
});

test("[T1] operators is a SOFT auth reference (uuid PK, NO cross-schema auth.* FK)", () => {
  const m = ALL_CODE.match(
    /CREATE TABLE IF NOT EXISTS public\.operators \(([\s\S]*?)\n\);/i,
  );
  assert.ok(m, "operators table must exist");
  const body = flat(m![1]);
  assert.match(body, /id\s+uuid PRIMARY KEY/i);
  // SOFT reference: the operators table must NOT hard-FK into the auth schema.
  assert.ok(
    !/\bauth\./i.test(body),
    "operators must NOT reference the auth schema (soft reference only)",
  );
});

test("[T1] workspaces.owner_type CHECK (user|team); workspace_members composite PK + cascade FKs to workspaces/operators", () => {
  const ws = ALL_CODE.match(
    /CREATE TABLE IF NOT EXISTS public\.workspaces \(([\s\S]*?)\n\);/i,
  );
  assert.ok(ws, "workspaces table must exist");
  assert.match(
    flat(ws![1]),
    /owner_type\s+text NOT NULL CHECK \(owner_type IN \('user','team'\)\)/i,
  );
  const wm = ALL_CODE.match(
    /CREATE TABLE IF NOT EXISTS public\.workspace_members \(([\s\S]*?)\n\);/i,
  );
  assert.ok(wm, "workspace_members table must exist");
  const body = flat(wm![1]);
  assert.match(
    body,
    /workspace_id\s+uuid NOT NULL REFERENCES public\.workspaces\(id\) ON DELETE CASCADE/i,
  );
  assert.match(
    body,
    /operator_id\s+uuid NOT NULL REFERENCES public\.operators\(id\) ON DELETE CASCADE/i,
  );
  assert.match(body, /PRIMARY KEY \(workspace_id, operator_id\)/i);
  // workspace_members must precede nothing here, but operators + workspaces (the
  // FK targets) must be declared before workspace_members in 0041.
  const M0041_CODE = stripComments(M0041);
  assert.ok(
    M0041_CODE.indexOf("CREATE TABLE IF NOT EXISTS public.operators") <
      M0041_CODE.indexOf("CREATE TABLE IF NOT EXISTS public.workspace_members") &&
      M0041_CODE.indexOf("CREATE TABLE IF NOT EXISTS public.workspaces") <
        M0041_CODE.indexOf("CREATE TABLE IF NOT EXISTS public.workspace_members"),
    "operators + workspaces must be declared before workspace_members",
  );
});

test("[T1] 0040 + 0041 are additive, idempotent, public-schema-only (pooled-role-can-run)", () => {
  for (const [name, code] of [
    ["0040", stripComments(M0040)],
    ["0041", stripComments(M0041)],
  ] as const) {
    // Idempotent table creates.
    assert.ok(
      /CREATE TABLE IF NOT EXISTS/i.test(code),
      `${name} tables must be IF NOT EXISTS`,
    );
    // ADDITIVE-ONLY: no destructive verbs in the live SQL (down is comment-only).
    assert.ok(!/\bDROP\b/i.test(code), `${name} live SQL must not DROP anything`);
    assert.ok(
      !/\bALTER COLUMN\b|\bDROP COLUMN\b|\bRENAME\b/i.test(code),
      `${name} must not alter/drop/rename any existing column`,
    );
    // The only ALTER TABLE permitted is ENABLE ROW LEVEL SECURITY.
    for (const alter of code.matchAll(/ALTER TABLE[^;]*;/gi)) {
      assert.match(
        flat(alter[0]),
        /ALTER TABLE public\.\w+ ENABLE ROW LEVEL SECURITY/i,
        `${name} ALTER TABLE must only ENABLE ROW LEVEL SECURITY: ${alter[0]}`,
      );
    }
    // Public-schema only; no auth.* or storage.* cross-schema writes.
    assert.ok(
      !/\bauth\.|\bstorage\./i.test(code),
      `${name} must touch only the public schema (no auth.*/storage.*)`,
    );
    // NO superuser-only / role / ownership / event-trigger constructs.
    for (const banned of [
      /CREATE\s+EVENT\s+TRIGGER/i,
      /\bSET\s+ROLE\b/i,
      /\bALTER\s+.*OWNER\s+TO\b/i,
      /\bGRANT\b/i,
      /\bCREATE\s+EXTENSION\b/i,
      /SECURITY\s+DEFINER/i,
    ]) {
      assert.ok(
        !banned.test(code),
        `${name} must not use a superuser-only construct: ${banned}`,
      );
    }
  }
});

// ===========================================================================
// TIER 2 — live Postgres behavioral assertions (anon, cross-tenant, FK, CHECK).
// Engine auto-detect: DATABASE_URL (Supabase branch / CI) OR a docker pg
// container named by RLS_TEST_PG_CONTAINER. Skipped (NOT passed) if neither.
// ===========================================================================

type PgRunner = (sqlText: string, opts?: { role?: "anon" }) => string;

// The anon role is applied IN-BAND via `SET ROLE anon;` prepended to the SQL in
// the SAME psql `-c` session — NOT a connection-startup `PGOPTIONS=-c role=anon`.
// The Supabase pooler (Supavisor) STRIPS startup options, so that approach left
// the session as the owner role (which bypasses RLS) and "anon" saw every row
// (the CI failure on Sagemark, 2026-06-26). `SET ROLE` survives the pooler; `-q`
// suppresses the `SET` command tag so only the SELECT's tuples reach the parser.
function withAnonRole(sqlText: string, opts?: { role?: "anon" }): string {
  return opts?.role === "anon" ? `SET ROLE anon;\n${sqlText}` : sqlText;
}
// Is a usable `psql` binary on PATH? A missing binary must degrade to "no
// runner" → SKIP, NEVER an ENOENT crash. (DATABASE_URL can be set in an env
// that has no psql — e.g. this Windows worktree — so the URL alone is not proof
// of a reachable engine.) Probed once with a cheap `psql --version`.
function psqlAvailable(): boolean {
  try {
    execFileSync("psql", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
function detectRunner(): { runner: PgRunner; engine: string } | null {
  const url = process.env.DATABASE_URL;
  if (url && psqlAvailable()) {
    const runner: PgRunner = (sqlText, opts) =>
      execFileSync("psql", [url, "-q", "-v", "ON_ERROR_STOP=1", "-At", "-c", withAnonRole(sqlText, opts)], {
        encoding: "utf8",
      });
    return { runner, engine: `psql DATABASE_URL` };
  }
  const container = process.env.RLS_TEST_PG_CONTAINER;
  if (container) {
    const runner: PgRunner = (sqlText, opts) =>
      execFileSync(
        "docker",
        ["exec", "-i", container, "psql", "-U", "postgres", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-c", withAnonRole(sqlText, opts)],
        { encoding: "utf8" },
      );
    return { runner, engine: `docker exec ${container} psql` };
  }
  return null;
}

const detected = detectRunner();
const TIER2_SKIP = detected
  ? false
  : "TIER-2 NEEDS-INPUT: set DATABASE_URL (a Supabase branch / pg) OR RLS_TEST_PG_CONTAINER (a running docker postgres) to run the live RLS + cross-tenant + FK assertions.";

// Two-tenant fixture ids (module scope so every Tier-2 test shares them).
const WS_A = randomUUID();
const WS_B = randomUUID();
const CLIENT_A = randomUUID();
const CLIENT_B = randomUUID();
const PIECE_A_PUB = randomUUID(); // published, workspace A
const PIECE_A_DRAFT = randomUUID(); // draft, workspace A
const PIECE_B_PUB = randomUUID(); // published, workspace B
const AUTH_A = randomUUID();
const GENIMG_A = randomUUID(); // a generated_images row, workspace A (0035)
const GENIMG_B = randomUUID(); // a workspace-B row sharing slug 'front-porch' (0037 cross-tenant proof)
const CONV_A = randomUUID(); // a conversation, workspace A (0040)
const RUN_A = `run-${randomUUID()}`; // a worker_sessions.run_id (text PK, 0034) the turn FKs to
const OPERATOR_A = randomUUID(); // an operators row (0041)
const WORKSPACE_ROW_A = randomUUID(); // a workspaces row (0041)

function run(sqlText: string, opts?: { role?: "anon" }): string {
  return detected!.runner(sqlText, opts).trim();
}

before(() => {
  if (TIER2_SKIP) return;
  // The migrations create a policy `TO anon`, so the `anon` role must exist
  // BEFORE they run. Supabase ships one; a bare postgres (the docker fallback)
  // needs it created first. On a real Supabase branch this is a harmless no-op.
  run(`DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
           CREATE ROLE anon NOLOGIN;
         END IF;
       END $$;
       GRANT USAGE ON SCHEMA public TO anon;`);
  // Apply the migrations in order.
  run(M0030);
  run(M0031);
  run(M0032);
  run(M0033);
  // 0035 touches ONLY the public schema (the `seo-generated-images` storage
  // bucket is provisioned out-of-band, NOT in the migration — see the 0035
  // header), so it applies cleanly under a restricted migration role on a real
  // Supabase branch and needs no storage-schema stub here.
  run(M0035);
  // 0037 — additive slug column + (workspace_id, slug) index on generated_images.
  // Public-schema only; the pooled migration role can run it (Tier-1 asserts this
  // structurally; here we prove it applies cleanly on a live engine).
  run(M0037);
  // 0034 — worker_sessions (host run-state). Applied before 0040 because
  // conversation_turns.run_id FKs to worker_sessions.run_id.
  run(M0034);
  // 0040 — conversations + conversation_turns (chat-first front door).
  run(M0040);
  // 0041 — operators + workspaces + workspace_members (tenancy root).
  run(M0041);
  // Grant anon SELECT on all tables so RLS — not a missing table grant — is the
  // thing under test. (Supabase grants anon SELECT on public by default; a bare
  // postgres does not. With RLS enabled + fail-closed policies, a table grant
  // without a matching policy still yields zero rows, which is the guarantee.)
  run(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;`);
  // Seed the two-tenant fixture (service-role / table owner bypasses RLS).
  run(`
    INSERT INTO content_clients (id, name, blog_slug, workspace_id) VALUES
      ('${CLIENT_A}', 'Client A', 'client-a-${CLIENT_A.slice(0, 8)}', '${WS_A}'),
      ('${CLIENT_B}', 'Client B', 'client-b-${CLIENT_B.slice(0, 8)}', '${WS_B}');
    INSERT INTO content_pieces (id, client_id, slug, title, status) VALUES
      ('${PIECE_A_PUB}',   '${CLIENT_A}', 'a-pub',   'A Published', 'published'),
      ('${PIECE_A_DRAFT}', '${CLIENT_A}', 'a-draft', 'A Draft',     'draft'),
      ('${PIECE_B_PUB}',   '${CLIENT_B}', 'b-pub',   'B Published', 'published');
    INSERT INTO voice_specs (client_id, spec) VALUES ('${CLIENT_A}', '{}'::jsonb);
    INSERT INTO content_piece_versions (piece_id, client_id, version, body)
      VALUES ('${PIECE_A_PUB}', '${CLIENT_A}', 1, 'v1');
    INSERT INTO review_comments (piece_id, client_id, version, author_id, body)
      VALUES ('${PIECE_A_PUB}', '${CLIENT_A}', 1, '${randomUUID()}', 'looks good');
    INSERT INTO byline_authorizations (id, workspace_id, client_id, author_id, credential, scope, authorized_by)
      VALUES ('${AUTH_A}', '${WS_A}', '${CLIENT_A}', '${randomUUID()}',
              '{"name":"Dr. A","credentials":"MD"}'::jsonb, 'client', '${randomUUID()}');
    INSERT INTO generated_images
        (id, workspace_id, client_id, content_hash, bucket, storage_key, bytes, content_type, model, prompt_hash, slug, license)
      VALUES ('${GENIMG_A}', '${WS_A}', '${CLIENT_A}', 'hash-a', 'seo-generated-images',
              '${WS_A}/generated/hash-a.png', 5, 'image/png', 'bfl/flux-2-flex', 'ph-a',
              'front-porch',
              '{"provider":"generated","model":"bfl/flux-2-flex@flux-2-flex"}'::jsonb),
             -- A WORKSPACE-B row that SHARES the same slug 'front-porch' — the
             -- (workspace_id, slug) resolver must NEVER cross-serve it to WS_A.
             ('${GENIMG_B}', '${WS_B}', '${CLIENT_B}', 'hash-b', 'seo-generated-images',
              '${WS_B}/generated/hash-b.png', 5, 'image/png', 'bfl/flux-2-flex', 'ph-b',
              'front-porch',
              '{"provider":"generated","model":"bfl/flux-2-flex@flux-2-flex"}'::jsonb);
    INSERT INTO image_generations
        (workspace_id, client_id, asset_id, model, cost_reported, status)
      VALUES ('${WS_A}', '${CLIENT_A}', '${GENIMG_A}', 'bfl/flux-2-flex', 0.04, 'succeeded');
    -- 0034/0040/0041 fixtures (workspace A). A worker_sessions row so the
    -- conversation_turns.run_id FK has a live target; a conversation + one agent
    -- turn; an operator + workspace + membership (the tenancy root).
    INSERT INTO worker_sessions (run_id, workspace_id, client_id)
      VALUES ('${RUN_A}', '${WS_A}', '${CLIENT_A}');
    INSERT INTO conversations (id, workspace_id, client_id, piece_id, title)
      VALUES ('${CONV_A}', '${WS_A}', '${CLIENT_A}', '${PIECE_A_PUB}', 'Thread A');
    INSERT INTO conversation_turns
        (conversation_id, workspace_id, client_id, seq, role, content, run_id, piece_version, verdict)
      VALUES ('${CONV_A}', '${WS_A}', '${CLIENT_A}', 1, 'agent', 'drafted', '${RUN_A}', 1, 'PUBLISH');
    INSERT INTO operators (id, email)
      VALUES ('${OPERATOR_A}', 'op-a@example.com');
    INSERT INTO workspaces (id, owner_type, owner_id, name)
      VALUES ('${WORKSPACE_ROW_A}', 'user', '${OPERATOR_A}', 'Workspace A');
    INSERT INTO workspace_members (workspace_id, operator_id, role)
      VALUES ('${WORKSPACE_ROW_A}', '${OPERATOR_A}', 'owner');
  `);
});

after(() => {
  if (TIER2_SKIP) return;
  // Best-effort teardown so a re-run against the same DB is clean.
  try {
    run(`
      DELETE FROM workspace_members     WHERE workspace_id = '${WORKSPACE_ROW_A}';
      DELETE FROM workspaces            WHERE id = '${WORKSPACE_ROW_A}';
      DELETE FROM operators             WHERE id = '${OPERATOR_A}';
      DELETE FROM conversation_turns    WHERE client_id IN ('${CLIENT_A}','${CLIENT_B}');
      DELETE FROM conversations         WHERE client_id IN ('${CLIENT_A}','${CLIENT_B}');
      DELETE FROM worker_sessions       WHERE run_id = '${RUN_A}';
      DELETE FROM image_generations     WHERE client_id IN ('${CLIENT_A}','${CLIENT_B}');
      DELETE FROM generated_images      WHERE client_id IN ('${CLIENT_A}','${CLIENT_B}');
      DELETE FROM credentialed_releases WHERE client_id IN ('${CLIENT_A}','${CLIENT_B}');
      DELETE FROM client_signoffs       WHERE client_id IN ('${CLIENT_A}','${CLIENT_B}');
      DELETE FROM byline_authorizations  WHERE client_id IN ('${CLIENT_A}','${CLIENT_B}');
      DELETE FROM review_comments        WHERE client_id IN ('${CLIENT_A}','${CLIENT_B}');
      DELETE FROM content_piece_versions WHERE client_id IN ('${CLIENT_A}','${CLIENT_B}');
      DELETE FROM voice_specs            WHERE client_id IN ('${CLIENT_A}','${CLIENT_B}');
      DELETE FROM content_pieces         WHERE client_id IN ('${CLIENT_A}','${CLIENT_B}');
      DELETE FROM content_clients        WHERE id        IN ('${CLIENT_A}','${CLIENT_B}');
    `);
  } catch {
    /* teardown is best-effort */
  }
});

test(
  "[T2] anon SELECT on content_pieces returns ONLY status='published' rows",
  { skip: TIER2_SKIP },
  () => {
    const rows = run(`SELECT status FROM content_pieces ORDER BY status;`, {
      role: "anon",
    });
    const statuses = rows.split("\n").filter(Boolean);
    assert.ok(statuses.length >= 2, "anon should see the two published rows");
    for (const s of statuses) {
      assert.equal(s, "published", `anon saw a non-published row: ${s}`);
    }
    // The draft must be invisible by id.
    const draft = run(
      `SELECT count(*) FROM content_pieces WHERE id = '${PIECE_A_DRAFT}';`,
      { role: "anon" },
    );
    assert.equal(draft, "0", "anon must not see the draft piece");
  },
);

test(
  "[T2] anon SELECT on every non-public table returns ZERO rows",
  { skip: TIER2_SKIP },
  () => {
    for (const t of [
      // content_clients is the tenancy MAP — anon must NEVER see a row
      // (audit-001). A regression that re-exposes the workspace<->client map
      // fails here.
      "content_clients",
      "voice_specs",
      "content_piece_versions",
      "review_comments",
      "byline_authorizations",
      "client_signoffs",
      "credentialed_releases",
      // ImageGen Stage-2 (0035): generated images are private until referenced
      // inside a published content_piece — anon must read ZERO rows from both.
      "generated_images",
      "image_generations",
      // Chat-first front door (0040): a conversation + its turns are private
      // operator/run state — anon must read ZERO rows from both.
      "conversations",
      "conversation_turns",
      // Operator/workspace tenancy root (0041): identity, ownership, membership
      // are exactly what anon must never see (the content_clients posture).
      "operators",
      "workspaces",
      "workspace_members",
    ]) {
      const c = run(`SELECT count(*) FROM ${t};`, { role: "anon" });
      assert.equal(c, "0", `anon must read ZERO rows from ${t}, got ${c}`);
    }
    // Sanity: the owner/service-role DOES see the seeded rows (proves the zero
    // above is RLS fail-closed, not an empty table). One row seeded in each.
    for (const t of [
      "conversations",
      "conversation_turns",
      "operators",
      "workspaces",
      "workspace_members",
    ]) {
      const c = run(`SELECT count(*) FROM ${t};`);
      assert.ok(
        Number(c) >= 1,
        `owner must see the seeded ${t} row (got ${c}) — proves anon-zero is RLS, not emptiness`,
      );
    }
  },
);

test(
  "[T2] generated_images dedup UNIQUE index blocks a duplicate (workspace_id, content_hash)",
  { skip: TIER2_SKIP },
  () => {
    // A second generated_images row with the same (workspace, content_hash) as
    // the seeded GENIMG_A must be rejected by the unique dedup index (0035).
    assert.throws(
      () =>
        run(
          `INSERT INTO generated_images
             (workspace_id, client_id, content_hash, bucket, storage_key, bytes, content_type, model, license)
           VALUES ('${WS_A}','${CLIENT_A}','hash-a','seo-generated-images',
                   '${WS_A}/generated/dup.png', 7, 'image/png', 'bfl/flux-2-flex',
                   '{"provider":"generated","model":"m"}'::jsonb);`,
        ),
      /unique|duplicate/i,
      "duplicate (workspace_id, content_hash) must be rejected by the dedup index",
    );
    // The audit row referencing GENIMG_A persisted (proves the seed + the
    // asset_id FK link are real, not an empty table).
    const audits = run(
      `SELECT count(*) FROM image_generations WHERE asset_id = '${GENIMG_A}';`,
    );
    assert.equal(audits, "1", "the seeded audit row must reference the asset");
  },
);

test(
  "[T2] the image-resolver query (workspace_id + slug) is tenancy-scoped: WS_A resolves its row, never WS_B's same-slug row (0037)",
  { skip: TIER2_SKIP },
  () => {
    // This is the EXACT shape the live LiveImageResolver runs:
    //   SELECT slug, storage_key, license FROM generated_images
    //    WHERE workspace_id = <resolved> AND slug = ANY(<slugs>)
    // Both WS_A and WS_B seeded a row with slug 'front-porch'. The workspace_id
    // filter (service-role bypasses RLS — the app filter is the boundary) must
    // return ONLY the caller's workspace row.
    const aRows = run(
      `SELECT storage_key FROM generated_images
        WHERE workspace_id = '${WS_A}' AND slug = 'front-porch';`,
    );
    assert.equal(
      aRows.trim(),
      `${WS_A}/generated/hash-a.png`,
      "WS_A must resolve exactly its own front-porch row",
    );
    // WS_A must NOT see WS_B's same-slug row — count is exactly 1.
    const aCount = run(
      `SELECT count(*) FROM generated_images
        WHERE workspace_id = '${WS_A}' AND slug = 'front-porch';`,
    );
    assert.equal(aCount, "1", "WS_A must see exactly one front-porch row (not WS_B's)");
    // WS_B resolves ITS row (proves the filter discriminates, not an empty table).
    const bRows = run(
      `SELECT storage_key FROM generated_images
        WHERE workspace_id = '${WS_B}' AND slug = 'front-porch';`,
    );
    assert.equal(
      bRows.trim(),
      `${WS_B}/generated/hash-b.png`,
      "WS_B must resolve its own front-porch row",
    );
    // An orphan slug resolves to ZERO rows (→ fail-closed orphan block).
    const orphan = run(
      `SELECT count(*) FROM generated_images
        WHERE workspace_id = '${WS_A}' AND slug = 'no-such-slug';`,
    );
    assert.equal(orphan, "0", "an unknown slug must resolve to zero rows (orphan block)");
  },
);

test(
  "[T2] operator query scoped to workspace A returns ZERO rows for a workspace-B piece (cross-tenant)",
  { skip: TIER2_SKIP },
  () => {
    // The operator pipeline keys every query by (workspace_id, client_id). A
    // workspace-A-scoped read of a workspace-B-owned piece must be empty.
    const leaked = run(
      `SELECT count(*) FROM content_pieces cp
         JOIN content_clients cc ON cc.id = cp.client_id
        WHERE cp.id = '${PIECE_B_PUB}' AND cc.workspace_id = '${WS_A}';`,
    );
    assert.equal(leaked, "0", "workspace A must not reach a workspace B piece");
    // The same piece IS visible under its true workspace (proves the filter is
    // the discriminator, not an empty DB).
    const own = run(
      `SELECT count(*) FROM content_pieces cp
         JOIN content_clients cc ON cc.id = cp.client_id
        WHERE cp.id = '${PIECE_B_PUB}' AND cc.workspace_id = '${WS_B}';`,
    );
    assert.equal(own, "1", "workspace B must reach its own piece");
  },
);

test(
  "[T2] cluster_role / funnel_stage CHECK rejects an invalid enum",
  { skip: TIER2_SKIP },
  () => {
    assert.throws(
      () =>
        run(
          `INSERT INTO content_pieces (client_id, slug, title, cluster_role)
             VALUES ('${CLIENT_A}', 'bad-cluster', 't', 'not-a-role');`,
        ),
      /cluster_role|check/i,
      "invalid cluster_role must be rejected",
    );
    assert.throws(
      () =>
        run(
          `INSERT INTO content_pieces (client_id, slug, title, funnel_stage)
             VALUES ('${CLIENT_A}', 'bad-funnel', 't', 'not-a-stage');`,
        ),
      /funnel_stage|check/i,
      "invalid funnel_stage must be rejected",
    );
  },
);

test(
  "[T2] a client_signoff cannot carry reviewer credentials (no such column)",
  { skip: TIER2_SKIP },
  () => {
    assert.throws(
      () =>
        run(
          `INSERT INTO client_signoffs (workspace_id, client_id, piece_id, version, actor_id, release_scope, credential)
             VALUES ('${WS_A}','${CLIENT_A}','${PIECE_A_PUB}',1,'${randomUUID()}','piece','{"x":1}'::jsonb);`,
        ),
      /credential|column/i,
      "client_signoffs has no credential column — insert must error",
    );
    // And release_type cannot be coerced into a credentialed release.
    assert.throws(
      () =>
        run(
          `INSERT INTO client_signoffs (workspace_id, client_id, piece_id, version, actor_id, release_scope, release_type)
             VALUES ('${WS_A}','${CLIENT_A}','${PIECE_A_PUB}',1,'${randomUUID()}','piece','credentialed_release');`,
        ),
      /release_type|check/i,
      "client_signoffs.release_type CHECK must reject 'credentialed_release'",
    );
  },
);

test(
  "[T2] credentialed_release with a nonexistent authorization is rejected by the FK",
  { skip: TIER2_SKIP },
  () => {
    assert.throws(
      () =>
        run(
          `INSERT INTO credentialed_releases (workspace_id, client_id, piece_id, version, actor_id, credential, authorization_id, release_scope)
             VALUES ('${WS_A}','${CLIENT_A}','${PIECE_A_PUB}',1,'${randomUUID()}','{"name":"Dr"}'::jsonb,'${randomUUID()}','piece');`,
        ),
      /foreign key|authorization|violates/i,
      "a credentialed_release pointing at a nonexistent authorization must be rejected",
    );
    // A release pointing at the REAL authorization succeeds.
    run(
      `INSERT INTO credentialed_releases (workspace_id, client_id, piece_id, version, actor_id, credential, authorization_id, release_scope)
         VALUES ('${WS_A}','${CLIENT_A}','${PIECE_A_PUB}',1,'${randomUUID()}','{"name":"Dr"}'::jsonb,'${AUTH_A}','piece');`,
    );
    const ok = run(
      `SELECT count(*) FROM credentialed_releases WHERE authorization_id = '${AUTH_A}';`,
    );
    assert.equal(ok, "1", "a release with a valid authorization must persist");
  },
);

test(
  "[T2] ON DELETE RESTRICT blocks deleting an authorization a release references",
  { skip: TIER2_SKIP },
  () => {
    // The release from the previous test references AUTH_A; deleting it must
    // be blocked by ON DELETE RESTRICT.
    assert.throws(
      () => run(`DELETE FROM byline_authorizations WHERE id = '${AUTH_A}';`),
      /foreign key|violates|restrict/i,
      "ON DELETE RESTRICT must block deleting a referenced authorization",
    );
  },
);

test(
  "[T2] UNIQUE(piece_id, version) blocks a second credentialed release per version",
  { skip: TIER2_SKIP },
  () => {
    assert.throws(
      () =>
        run(
          `INSERT INTO credentialed_releases (workspace_id, client_id, piece_id, version, actor_id, credential, authorization_id, release_scope)
             VALUES ('${WS_A}','${CLIENT_A}','${PIECE_A_PUB}',1,'${randomUUID()}','{"name":"Dr2"}'::jsonb,'${AUTH_A}','piece');`,
        ),
      /unique|duplicate/i,
      "a second credentialed release for (piece, version) must be rejected",
    );
  },
);
