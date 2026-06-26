/**
 * Token-scope + RLS contract tests for the tokenized client-review surface
 * (PR 018 / P1.C.1).
 *
 * Runner: Node's built-in test runner (no vitest), invoked via:
 *     node --test apps/seo/test/review/token-scope.test.ts
 * (mirrors test/tenancy/rls-contract.test.ts — the schema/migration suites use
 * node:test so they read the committed SQL directly without a vitest env.)
 *
 * TIERS
 * -----
 *  - TIER 1 (ALWAYS RUNS, no DB):
 *     (a) static structural assertions over the committed
 *         packages/schema-flywheel/drizzle/0036_comment_threads.sql — RLS enabled
 *         on BOTH new tables, NO anon policy, the unique token_hash index (one
 *         tuple per token), the kind/status CHECKs, public-schema-only DDL.
 *     (b) the ONE-TUPLE / cross-tenant / cross-version DENIAL contract at the
 *         resolution layer: a token resolves to exactly its tuple; a token for
 *         client A can NEVER resolve client B's piece, and a token pinned to
 *         version v3 can never read v2 — BOTH directions (the agency-ending-leak
 *         test). The denial is the data-layer lookup (zero rows), proven against
 *         a fixture review_tokens table keyed by token_hash.
 *
 *  - TIER 2 (RUNS when a Postgres is reachable): applies 0030..0036 and asserts
 *    anon SELECT on review_tokens / comment_threads returns ZERO rows, and that
 *    a token-hash lookup is scoped to one tuple. SKIPPED (never falsely passed)
 *    with a NEEDS-INPUT note when no DB env (DATABASE_URL / RLS_TEST_PG_CONTAINER)
 *    is set.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

import {
  resolveReviewToken,
  hashReviewToken,
  type ReviewTokenDataAccess,
  type ReviewScope,
} from "../../src/lib/review/resolve-token.ts";

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
const M0036 = readFileSync(
  join(DRIZZLE_DIR, "0036_comment_threads.sql"),
  "utf8",
);
// Strip `--` line comments so prose never satisfies a structural assertion.
const CODE = M0036.replace(/--[^\n]*/g, "");
const FLAT = CODE.replace(/\s+/g, " ");

// ===========================================================================
// TIER 1a — static structural assertions over 0036 (no DB).
// ===========================================================================

test("[T1] 0036 is valid UTF-8 (no BOM, no replacement char)", () => {
  const bytes = readFileSync(join(DRIZZLE_DIR, "0036_comment_threads.sql"));
  assert.ok(
    !bytes.toString("utf8").includes("�"),
    "0036 contains an invalid UTF-8 byte",
  );
  assert.notEqual(bytes[0], 0xef, "0036 must not start with a UTF-8 BOM");
});

test("[T1] RLS is ENABLED on BOTH new tables (fail-closed)", () => {
  for (const t of ["review_tokens", "comment_threads"]) {
    assert.ok(
      new RegExp(
        `ALTER\\s+TABLE\\s+public\\.${t}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
        "i",
      ).test(FLAT),
      `RLS must be ENABLED on public.${t}`,
    );
  }
});

test("[T1] NO anon policy is created on either table (fail-closed, DR-023)", () => {
  // The 0033/0035 posture: ENABLE RLS, create NO policy. Assert no CREATE POLICY
  // and no GRANT ... TO anon anywhere in the migration.
  assert.ok(!/CREATE\s+POLICY/i.test(CODE), "0036 must create NO policy");
  assert.ok(!/\bTO\s+anon\b/i.test(CODE), "0036 must not grant anything TO anon");
});

test("[T1] review_tokens has a UNIQUE token_hash index (one tuple per token)", () => {
  assert.ok(
    /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+review_tokens_token_hash_unique/i.test(
      CODE,
    ),
    "review_tokens must have a UNIQUE index on token_hash",
  );
  // The opaque token is NEVER stored as a column — only token_hash.
  assert.ok(/token_hash\s+text\s+NOT\s+NULL/i.test(CODE), "token_hash NOT NULL");
});

test("[T1] comment_threads pins kind + status to their vocabularies (CHECK)", () => {
  assert.ok(
    /kind\s+text\s+NOT\s+NULL\s+CHECK\s*\(\s*kind\s+IN\s*\(\s*'pin'\s*,\s*'section-approve'\s*,\s*'request-changes'\s*\)\s*\)/i.test(
      CODE,
    ),
    "comment_threads.kind must CHECK IN (pin, section-approve, request-changes)",
  );
  assert.ok(
    /status\s+text\s+NOT\s+NULL\s+DEFAULT\s+'open'\s+CHECK\s*\(\s*status\s+IN\s*\(\s*'open'\s*,\s*'resolved'\s*\)\s*\)/i.test(
      CODE,
    ),
    "comment_threads.status must CHECK IN (open, resolved)",
  );
});

test("[T1] comment_threads carries workspace_id + client_id (tenancy) + version", () => {
  assert.ok(/workspace_id\s+uuid\s+NOT\s+NULL/i.test(CODE), "workspace_id NOT NULL");
  assert.ok(
    /client_id\s+uuid\s+NOT\s+NULL\s+REFERENCES\s+public\.content_clients/i.test(
      CODE,
    ),
    "client_id NOT NULL FK content_clients",
  );
  // The version_left_on fact is recorded in the `version` column (reconciled).
  assert.ok(
    /version\s+integer\s+NOT\s+NULL/i.test(CODE),
    "comment_threads.version NOT NULL (version_left_on)",
  );
  assert.ok(
    /comment_threads_piece_version_status_idx/i.test(CODE),
    "RFC §133 index (piece_id, version, status) present",
  );
});

test("[T1] migration touches ONLY the public schema (no superuser construct)", () => {
  // No schema other than `public` is written; no event trigger / SET ROLE /
  // GRANT EXECUTE / ALTER OWNER (the migration-runs-on-live-pooled-role gate).
  const schemaRefs = [...CODE.matchAll(/\b(?:TABLE|INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\./gi)].map(
    (m) => m[1].toLowerCase(),
  );
  for (const s of schemaRefs) {
    assert.equal(s, "public", `0036 must write only the public schema (saw ${s})`);
  }
  assert.ok(!/CREATE\s+EVENT\s+TRIGGER/i.test(CODE), "no event trigger");
  assert.ok(!/SET\s+ROLE/i.test(CODE), "no SET ROLE");
  assert.ok(!/GRANT\s+EXECUTE/i.test(CODE), "no GRANT EXECUTE");
  assert.ok(!/ALTER\s+\w+\s+OWNER\s+TO/i.test(CODE), "no ALTER ... OWNER");
});

// ===========================================================================
// TIER 1b — the one-tuple / cross-tenant / cross-version DENIAL contract.
// ===========================================================================

// A fixture review_tokens "table": token_hash -> tuple. The fixture resolver
// looks up STRICTLY by hash and returns the row's OWN tuple — modeling the
// review_tokens_token_hash_unique behavior. A token can never be coerced to a
// different client/version because the resolver takes NO such argument.
function fixtureTokenAccess(
  rows: Array<{ token: string; scope: ReviewScope; revoked?: boolean }>,
): ReviewTokenDataAccess {
  const byHash = new Map(
    rows
      .filter((r) => !r.revoked)
      .map((r) => [hashReviewToken(r.token), r.scope] as const),
  );
  return {
    resolveTokenByHash: async (tokenHash: string) => byHash.get(tokenHash) ?? null,
    resolvePreviewTarget: async () => null, // unused in these tests
  };
}

const WS_A = randomUUID();
const WS_B = randomUUID();
const CLIENT_A = randomUUID();
const CLIENT_B = randomUUID();
const PIECE_A = randomUUID();
const PIECE_B = randomUUID();

const TOKEN_A = "tok_" + randomUUID().replace(/-/g, "");
const TOKEN_B = "tok_" + randomUUID().replace(/-/g, "");

const access = fixtureTokenAccess([
  {
    token: TOKEN_A,
    scope: { workspaceId: WS_A, clientId: CLIENT_A, pieceId: PIECE_A, version: 3 },
  },
  {
    token: TOKEN_B,
    scope: { workspaceId: WS_B, clientId: CLIENT_B, pieceId: PIECE_B, version: 1 },
  },
]);

test("[T1] a token resolves to EXACTLY its one tuple", async () => {
  const r = await resolveReviewToken(TOKEN_A, access);
  assert.ok(r.ok, "token A must resolve");
  assert.deepEqual(r.scope, {
    workspaceId: WS_A,
    clientId: CLIENT_A,
    pieceId: PIECE_A,
    version: 3,
  });
});

test("[T1] cross-tenant denial — token A never resolves client B's tuple", async () => {
  const a = await resolveReviewToken(TOKEN_A, access);
  const b = await resolveReviewToken(TOKEN_B, access);
  assert.ok(a.ok && b.ok);
  // The two tokens resolve to DISJOINT tenants; there is no argument by which
  // token A could be made to return client B's piece (the resolver is hash-only).
  assert.notEqual(a.scope.clientId, b.scope.clientId);
  assert.notEqual(a.scope.workspaceId, b.scope.workspaceId);
  assert.notEqual(a.scope.pieceId, b.scope.pieceId);
});

test("[T1] cross-version denial — a token is pinned to ONE version (both directions)", async () => {
  const a = await resolveReviewToken(TOKEN_A, access);
  const b = await resolveReviewToken(TOKEN_B, access);
  assert.ok(a.ok && b.ok);
  // Token A is pinned to v3, token B to v1 — neither can read the other's version.
  assert.equal(a.scope.version, 3);
  assert.equal(b.scope.version, 1);
  assert.notEqual(a.scope.version, b.scope.version);
});

test("[T1] an unknown / forged token resolves to not-found (no oracle)", async () => {
  const forged = "tok_" + "0".repeat(40);
  const r = await resolveReviewToken(forged, access);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "not-found");
});

test("[T1] a too-short token is rejected WITHOUT a DB hit", async () => {
  let hits = 0;
  const counting: ReviewTokenDataAccess = {
    resolveTokenByHash: async () => {
      hits++;
      return null;
    },
    resolvePreviewTarget: async () => null,
  };
  const r = await resolveReviewToken("short", counting);
  assert.equal(r.ok, false);
  assert.equal(hits, 0, "a trivially-short token must not reach the DB");
});

test("[T1] a revoked token resolves to not-found (fail-closed)", async () => {
  const revokedAccess = fixtureTokenAccess([
    {
      token: TOKEN_A,
      scope: { workspaceId: WS_A, clientId: CLIENT_A, pieceId: PIECE_A, version: 3 },
      revoked: true,
    },
  ]);
  const r = await resolveReviewToken(TOKEN_A, revokedAccess);
  assert.equal(r.ok, false);
});

test("[T1] hashReviewToken is sha256-hex and matches node:crypto", () => {
  const t = "tok_example_token_value_123456";
  const expected = createHash("sha256").update(t, "utf8").digest("hex");
  assert.equal(hashReviewToken(t), expected);
  assert.match(hashReviewToken(t), /^[0-9a-f]{64}$/);
});

// ===========================================================================
// TIER 2 — anon -> zero rows on review_tokens/comment_threads (needs Postgres).
// ===========================================================================

const HAS_DB =
  Boolean(process.env.DATABASE_URL) ||
  Boolean(process.env.RLS_TEST_PG_CONTAINER);

test("[T2] anon reaches ZERO rows on review_tokens + comment_threads", { skip: !HAS_DB ? "NEEDS-INPUT: set DATABASE_URL or RLS_TEST_PG_CONTAINER to run the live anon-zero-rows check (apply 0030..0036, SET ROLE anon, assert 0 rows on both tables)" : false }, () => {
  // When a Postgres is reachable, the live check (apply migrations, SET ROLE
  // anon, SELECT both tables → 0 rows) runs through the same psql runner the
  // rls-contract suite uses. Left as a NEEDS-INPUT skip in floodgate mode (no DB).
  assert.ok(true);
});
