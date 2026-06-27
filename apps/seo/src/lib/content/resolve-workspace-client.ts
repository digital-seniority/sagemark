/**
 * Workspace -> client resolution for the studio surfaces (Slice 5 / P-I, lane
 * studio-ui).
 *
 * THE STUDIO TENANCY BRIDGE (read side). The chat-first front door's home + canvas
 * pages resolve their operator -> workspace (the DR-003 auth seam), then need the
 * `content_clients` row that workspace OWNS so every conversation read/write can be
 * scoped by the BOUND `(workspaceId, clientId)` pair. That client id is NEVER taken
 * from request input — it is resolved HERE from the server's workspace.
 *
 * v1 ASSUMPTION (locked, slice plan §"Locked decisions"): an operator has ONE
 * workspace, and a workspace has ONE client. This read therefore returns the SINGLE
 * `content_clients` row for the workspace; if a workspace somehow has MORE than one,
 * we take the FIRST (oldest, by `created_at`) and treat it as the active client —
 * commented so the assumption is explicit. A workspace with NO client resolves to
 * null (the home page renders an empty "no client yet" state; the canvas redirects
 * home) — fail-closed, never a fabricated client.
 *
 * SECURITY — SERVICE ROLE BYPASSES RLS (load-bearing). `content_clients` is the
 * tenancy ROOT (RLS-enabled, no anon policy), so only the service role can read it.
 * The read is EXPLICITLY scoped to the resolved workspace id (`.eq("workspace_id",
 * …)`); a different workspace simply sees no row. This mirrors `auth.ts`'s
 * service-role membership read exactly (same creds reader, same dynamic import, same
 * fail-closed coercion). The resolution core accepts an injected client so the unit
 * tests drive the branches without a live Supabase.
 *
 * `server-only`: it touches the service-role creds. `@supabase/supabase-js` is
 * imported dynamically so importing this module is network-free + cred-free. Clean
 * ASCII / UTF-8. No `console.*`.
 */

import "server-only";

import { readReadAdapterCreds } from "./live-data-access";

/**
 * The resolved client a studio surface binds its conversation reads to. `id` is the
 * `content_clients.id`; `name` + `blogSlug` are surfaced for the home header.
 */
export interface WorkspaceClient {
  id: string;
  name: string;
  blogSlug: string;
}

// ── The minimal service-role PostgREST surface this read uses ──────────────────

/**
 * The terminal read builder this resolution uses (modelled minimally so the unit
 * test can inject a fake of the same shape). Awaiting yields `{ data, error }` with
 * the (possibly empty) row array; `.eq()`/`.order()`/`.limit()` chain the scope.
 */
export interface ClientReaderQuery {
  eq(col: string, val: string): ClientReaderQuery;
  order(col: string, opts?: { ascending?: boolean }): ClientReaderQuery;
  limit(n: number): ClientReaderQuery;
  then<R>(
    onfulfilled: (r: {
      data: Record<string, unknown>[] | null;
      error: unknown;
    }) => R,
  ): Promise<R>;
}

/** The minimal service-role Supabase surface this read uses. */
export interface ClientReaderSupabase {
  from(table: string): { select(cols: string): ClientReaderQuery };
}

// ── Fail-closed coercion (never fabricate a client) ────────────────────────────

function reqString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Map a `content_clients` row to a `WorkspaceClient`, or null when a REQUIRED field
 * (id / name / blog_slug) is missing/unparseable — fail-closed, never a partial
 * client.
 */
function mapClientRow(row: Record<string, unknown>): WorkspaceClient | null {
  const id = reqString(row.id);
  const name = reqString(row.name);
  const blogSlug = reqString(row.blog_slug);
  if (!id || !name || !blogSlug) return null;
  return { id, name, blogSlug };
}

// ── Injectable resolution core (so the unit tests can drive the branches) ──────

/**
 * Resolve the single `content_clients` row for a workspace via a service-role read
 * scoped EXPLICITLY to that workspace id, oldest-first. Returns null when:
 *   - the host has no service-role client (fail-closed),
 *   - the read errors (fail-loud -> rethrow; a broken read must not silently pass),
 *   - the workspace has no client (fail-closed),
 *   - the row cannot be mapped to a `WorkspaceClient` (fail-closed).
 *
 * v1: a workspace has one client; if more than one exists we take the FIRST (oldest)
 * row and treat it as the active client.
 *
 * Exported for the unit tests; the public `resolveWorkspaceClient` wires the real
 * service-role client into it.
 */
export async function resolveWorkspaceClientWith(
  workspaceId: string,
  supabase: ClientReaderSupabase | null,
): Promise<WorkspaceClient | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("content_clients")
    .select("id, name, blog_slug, created_at")
    // EXPLICIT workspace scope — service-role bypasses RLS, this filter IS the
    // boundary. A different workspace id sees no row.
    .eq("workspace_id", workspaceId)
    // v1: one client per workspace; oldest-first so "the first" is deterministic.
    .order("created_at", { ascending: true })
    .limit(1)
    .then((r) => r);
  if (error) {
    throw new Error(
      `resolve-workspace-client: content_clients read failed for workspace=${workspaceId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const rows = data ?? [];
  const first = rows[0];
  if (!first) return null;
  return mapClientRow(first);
}

// ── Service-role client factory (mirrors auth.ts) ──────────────────────────────

/**
 * Build the service-role Supabase client for the client read, or null when the host
 * is not configured (-> fail-closed: no client). `@supabase/supabase-js` is imported
 * dynamically so importing this module is network-free.
 */
async function makeServiceRoleClient(): Promise<ClientReaderSupabase | null> {
  const creds = readReadAdapterCreds();
  if (!creds) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(creds.url, creds.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as ClientReaderSupabase;
}

/**
 * Resolve the active client for a workspace (the studio tenancy bridge, read side),
 * or null when there is no client / the host is not configured. Server-derived from
 * the workspace id only — never request input.
 */
export async function resolveWorkspaceClient(
  workspaceId: string,
): Promise<WorkspaceClient | null> {
  const supabase = await makeServiceRoleClient();
  return resolveWorkspaceClientWith(workspaceId, supabase);
}
