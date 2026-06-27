/**
 * Server-side auth guard for `apps/seo` — the REAL Supabase email magic-link
 * implementation (DR-003 swap-in).
 *
 * THE TENANCY BOUNDARY. Every studio surface ((studio)/page, (studio)/canvas) and
 * the run route resolve their operator/workspace through THIS module before
 * rendering or mutating; multi-tenant queries derive `workspace_id` from here
 * (RFC §3.4 layer 2), NEVER from request input. This file is therefore
 * production-critical and human-reviewed.
 *
 * WHAT CHANGED FROM THE PLACEHOLDER. The PR-001 seam returned `null`/pass-through
 * (no auth backend wired). This fills the SAME signatures with real Supabase Auth:
 *   - `getCurrentOperator()` — reads the cookie-bound session via the anon client
 *     and `supabase.auth.getUser()` (the AUTHENTICATED read that re-validates
 *     against Supabase Auth — NOT the decode-only `getSession`).
 *   - `getCurrentWorkspace()` — resolves the operator, then performs a SERVICE-ROLE
 *     read of `workspace_members ⋈ workspaces` for that operator id and returns the
 *     single workspace (v1: one workspace per operator).
 *   - `requireOperator()` — now REDIRECTS to `/sign-in` when there is no operator.
 *     THIS IS THE GATE FLIP: the placeholder was a pass-through; enabling real
 *     enforcement is this one-file change, exactly as the seam promised.
 *
 * FAIL-CLOSED + TENANT-SAFE. Tenancy is SERVER-DERIVED from the authenticated
 * operator only — never trusted from request input. Every branch that cannot
 * positively establish (operator => membership => workspace) returns `null`
 * (`getCurrentWorkspace`) or redirects (`requireOperator`). A missing session, a
 * missing membership, a host with no creds, or an unmappable row all resolve to
 * "no workspace", which `bindRequestContext` turns into a 401 — never a leak.
 *
 * SERVICE ROLE BYPASSES RLS (load-bearing). The membership read uses the
 * SUPABASE_SERVICE_ROLE_KEY client (operators/workspaces/workspace_members are the
 * tenancy ROOT — RLS-enabled with NO anon policy, so only the service role can read
 * them). The query is EXPLICITLY scoped to the authenticated operator's id; a
 * different operator id simply yields no row.
 *
 * Clean ASCII / UTF-8. `@supabase/supabase-js` is imported dynamically by the
 * service-role factory so importing this module is network-free + cred-free. The
 * resolution helpers accept injected dependencies so the unit tests exercise the
 * fail-closed branches without a live Supabase.
 */

import "server-only";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/auth/supabase-server";

/** The authenticated operator. Mirrors the agents-app `User` shape (subset). */
export interface Operator {
  id: string;
  email: string | null;
}

/**
 * The single authoritative workspace for the current operator. All multi-tenant
 * queries MUST derive `workspace_id` from this (RFC §3.4 layer 2). Shape mirrors
 * the `workspaces` table (id / owner_type / owner_id / name).
 */
export interface Workspace {
  id: string;
  ownerType: "user" | "team";
  ownerId: string | null;
  name: string;
}

// -- Service-role creds (the membership read bypasses RLS) ---------------------

/**
 * The host service-role creds the workspace resolution needs. Same env contract as
 * `live-data-access.readReadAdapterCreds`. Returns null when either is absent, so
 * `getCurrentWorkspace` fails closed (no workspace) on a misconfigured host.
 */
function readServiceRoleCreds(): { url: string; serviceRoleKey: string } | null {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE ??
    "";
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}

/**
 * The minimal service-role PostgREST surface the membership resolution uses
 * (read-only). Modelled minimally so the unit test can inject a fake of the same
 * shape. `maybeSingle()` returns at most one row (or null).
 */
export interface MemberReaderQuery {
  eq(col: string, val: string): MemberReaderQuery;
  limit(n: number): MemberReaderQuery;
  maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: unknown }>;
}

/** The minimal service-role Supabase surface the membership resolution uses. */
export interface MemberReaderSupabase {
  from(table: string): { select(cols: string): MemberReaderQuery };
}

/**
 * Build the service-role Supabase client for the membership read, or null when the
 * host is not configured (-> fail-closed: no workspace). `@supabase/supabase-js` is
 * imported dynamically so importing this module is network-free.
 */
async function makeServiceRoleClient(): Promise<MemberReaderSupabase | null> {
  const creds = readServiceRoleCreds();
  if (!creds) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(creds.url, creds.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as MemberReaderSupabase;
}

// -- Fail-closed coercion (never fabricate a workspace) ------------------------

function reqString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** The schema's workspaces.owner_type values; anything else -> null (fail-closed). */
function asOwnerType(v: unknown): Workspace["ownerType"] | null {
  return v === "user" || v === "team" ? v : null;
}

/**
 * Map a joined `workspace_members <-> workspaces` row to a `Workspace`. Returns
 * null when a REQUIRED field (workspace id / name / a valid owner_type) is missing
 * or unparseable — fail-closed not-found, never a partial/fabricated workspace. The
 * embedded workspace is read off the `workspaces` join alias.
 */
function mapMembershipRow(row: Record<string, unknown>): Workspace | null {
  const ws = row.workspaces;
  if (!ws || typeof ws !== "object" || Array.isArray(ws)) return null;
  const w = ws as Record<string, unknown>;
  const id = reqString(w.id);
  const name = reqString(w.name);
  const ownerType = asOwnerType(w.owner_type);
  if (!id || !name || !ownerType) return null;
  return {
    id,
    ownerType,
    ownerId: asStringOrNull(w.owner_id),
    name,
  };
}

// -- Injectable resolution core (so the unit tests can drive the branches) -----

/**
 * Resolve the workspace for an already-resolved operator id via a service-role
 * read of `workspace_members <-> workspaces`, scoped EXPLICITLY to that operator
 * id. v1: an operator has at most one workspace — take the first. Returns null
 * when:
 *   - the host has no service-role client (fail-closed),
 *   - the read errors (fail-loud -> rethrow; a broken read must not silently pass),
 *   - no membership row exists (fail-closed),
 *   - the row cannot be mapped to a `Workspace` (fail-closed).
 *
 * Exported for the unit tests; the public `getCurrentWorkspace` wires the real
 * service-role client into it.
 */
export async function resolveWorkspaceForOperator(
  operatorId: string,
  supabase: MemberReaderSupabase | null,
): Promise<Workspace | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("workspace_members")
    // Embed the joined workspace columns under the `workspaces` alias.
    .select("operator_id, workspaces(id, owner_type, owner_id, name)")
    .eq("operator_id", operatorId)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(
      `auth: workspace membership read failed for operator=${operatorId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!data) return null;
  return mapMembershipRow(data);
}

// -- Public seam (signatures preserved verbatim) -------------------------------

/**
 * Return the currently signed-in operator, or `null` if unauthenticated.
 *
 * Reads the cookie-bound session via the anon server client and
 * `supabase.auth.getUser()` — the AUTHENTICATED read that re-validates the session
 * against Supabase Auth (NOT the decode-only `getSession`, which would trust a
 * possibly-stale/forged cookie). Returns null when the host is not configured, when
 * there is no session, or on any auth error — fail-closed.
 */
export async function getCurrentOperator(): Promise<Operator | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

/**
 * Resolve the workspace the current operator owns, or `null` if unauthenticated /
 * not a member of any workspace.
 *
 *   operator => (no operator -> null, fail-closed) => SERVICE-ROLE read of
 *   `workspace_members <-> workspaces` scoped to the operator id => the single
 *   workspace, or null when there is no membership (fail-closed).
 *
 * Tenancy is SERVER-DERIVED from the authenticated operator only — never from
 * request input. `bindRequestContext` turns a null here into a 401.
 */
export async function getCurrentWorkspace(): Promise<Workspace | null> {
  const operator = await getCurrentOperator();
  if (!operator) return null;
  const supabase = await makeServiceRoleClient();
  return resolveWorkspaceForOperator(operator.id, supabase);
}

/**
 * Page/route guard: ensure the request is from an authenticated operator and
 * return them.
 *
 * THE GATE FLIP (DR-003): the PR-001 placeholder was a pass-through that returned
 * `null` when unauthenticated. This now REDIRECTS to `/sign-in` (Next's `redirect`
 * throws, so control never returns to the caller) when there is no operator. Every
 * studio surface calls this single chokepoint, so the gate is enforced everywhere
 * at once. The non-null `Operator` return type is preserved: a caller that reaches
 * the line after `await requireOperator()` is guaranteed authenticated.
 */
export async function requireOperator(): Promise<Operator> {
  const operator = await getCurrentOperator();
  if (!operator) {
    redirect("/sign-in");
  }
  return operator;
}
