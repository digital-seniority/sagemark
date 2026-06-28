/**
 * Host-side LIVE ProjectDataAccess adapter (studio UX overhaul, Slice 5b).
 *
 * The live read+write adapter for the Projects seam (context.ts). Mirrors
 * `../conversation/live-conversation-data-access.ts`: same creds reader, same
 * dynamic import, same EXPLICIT-app-filter discipline (service role bypasses RLS,
 * so EVERY query carries `.eq("workspace_id", …)` + `.eq("client_id", …)` from the
 * BOUND args), same fail-closed mapping.
 *
 * `listProjectPieces` derives a project's articles via the `conversations.piece_id`
 * link (a conversation in the project that produced a piece) — so no extra write to
 * `content_pieces.project_id` is needed for the cross-article context to work.
 *
 * Clean ASCII / UTF-8. No `console.*`. `@supabase/supabase-js` imported dynamically.
 */

import "server-only";

import {
  type ProjectDataAccess,
  type ProjectRow,
  type ProjectPieceFact,
  type CreateProjectInput,
} from "./context";
import { readReadAdapterCreds } from "../content/live-data-access";

// ── Minimal service-role PostgREST surface this adapter uses ───────────────────

interface PgRes<T> {
  data: T;
  error: unknown;
}
interface SelectQuery extends PromiseLike<PgRes<Record<string, unknown>[]>> {
  eq(col: string, val: string): SelectQuery;
  in(col: string, vals: string[]): SelectQuery;
  not(col: string, op: string, val: null): SelectQuery;
  order(col: string, opts?: { ascending?: boolean }): SelectQuery;
  maybeSingle(): Promise<PgRes<Record<string, unknown> | null>>;
}
interface WriteQuery extends PromiseLike<PgRes<Record<string, unknown>[]>> {
  eq(col: string, val: string): WriteQuery;
  select(cols: string): WriteQuery;
  single(): Promise<PgRes<Record<string, unknown> | null>>;
}
interface ProjectSupabase {
  from(table: string): {
    select(cols: string): SelectQuery;
    insert(row: Record<string, unknown>): WriteQuery;
    update(row: Record<string, unknown>): WriteQuery;
  };
}

const PROJECT_COLS =
  "id, workspace_id, client_id, name, description, brief, summary, strategy, strategy_status, strategy_approved_at, created_at, updated_at";

function reqString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function stringifyErr(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Map a `projects` row → ProjectRow (fail-closed: a missing required field → null). */
function mapProject(row: Record<string, unknown>): ProjectRow | null {
  const id = reqString(row.id);
  const workspaceId = reqString(row.workspace_id);
  const clientId = reqString(row.client_id);
  const name = reqString(row.name);
  const createdAt = reqString(row.created_at);
  const updatedAt = reqString(row.updated_at);
  if (!id || !workspaceId || !clientId || !name || !createdAt || !updatedAt) return null;
  const rawStatus = asStringOrNull(row.strategy_status);
  const strategyStatus: "proposed" | "approved" | "archived" | null =
    rawStatus === "proposed" || rawStatus === "approved" || rawStatus === "archived"
      ? rawStatus
      : null;
  return {
    id,
    workspaceId,
    clientId,
    name,
    description: asStringOrNull(row.description),
    brief: asStringOrNull(row.brief) ?? "",
    summary: row.summary ?? null,
    strategy: row.strategy ?? null,
    strategyStatus,
    strategyApprovedAt: asStringOrNull(row.strategy_approved_at),
    createdAt,
    updatedAt,
  };
}

/** Map a `content_pieces` facts row → ProjectPieceFact. */
function mapPieceFact(row: Record<string, unknown>): ProjectPieceFact | null {
  const id = reqString(row.id);
  const title = reqString(row.title);
  const slug = reqString(row.slug);
  if (!id || !title || !slug) return null;
  const brief = row.brief_snapshot;
  const keyword =
    brief && typeof brief === "object" && !Array.isArray(brief)
      ? asStringOrNull((brief as Record<string, unknown>).keyword)
      : null;
  return {
    id,
    title,
    slug,
    clusterRole: asStringOrNull(row.cluster_role),
    funnelStage: asStringOrNull(row.funnel_stage),
    primaryKeyword: keyword,
    excerpt: asStringOrNull(row.meta_description) ?? asStringOrNull(row.excerpt),
  };
}

export class LiveProjectDataAccess implements ProjectDataAccess {
  constructor(private readonly supabase: ProjectSupabase) {}

  async createProject(input: CreateProjectInput): Promise<string> {
    const { data, error } = await this.supabase
      .from("projects")
      .insert({
        workspace_id: input.workspaceId, // BOUND tenancy — never request input.
        client_id: input.clientId, // BOUND tenancy — never request input.
        name: input.name,
        description: input.description ?? null,
        brief: input.brief ?? "",
      })
      .select("id")
      .single();
    if (error) throw new Error(`live-project: createProject failed: ${stringifyErr(error)}`);
    const id = data ? reqString(data.id) : null;
    if (!id) throw new Error("live-project: createProject returned no id");
    return id;
  }

  async listProjects(workspaceId: string, clientId: string): Promise<ProjectRow[]> {
    const { data, error } = await this.supabase
      .from("projects")
      .select(PROJECT_COLS)
      .eq("workspace_id", workspaceId)
      .eq("client_id", clientId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(`live-project: listProjects failed: ${stringifyErr(error)}`);
    return (data ?? []).map(mapProject).filter((r): r is ProjectRow => r !== null);
  }

  async getProject(id: string, workspaceId: string, clientId: string): Promise<ProjectRow | null> {
    const { data, error } = await this.supabase
      .from("projects")
      .select(PROJECT_COLS)
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .eq("client_id", clientId)
      .maybeSingle();
    if (error) throw new Error(`live-project: getProject failed: ${stringifyErr(error)}`);
    return data ? mapProject(data) : null;
  }

  async updateProjectBrief(
    id: string,
    brief: string,
    workspaceId: string,
    clientId: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from("projects")
      .update({ brief, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .eq("client_id", clientId);
    if (error) throw new Error(`live-project: updateProjectBrief failed: ${stringifyErr(error)}`);
  }

  async persistStrategy(
    id: string,
    strategy: unknown,
    workspaceId: string,
    clientId: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from("projects")
      .update({
        strategy: strategy as Record<string, unknown>,
        strategy_status: "proposed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .eq("client_id", clientId);
    if (error) throw new Error(`live-project: persistStrategy failed: ${stringifyErr(error)}`);
  }

  async approveStrategy(
    id: string,
    workspaceId: string,
    clientId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.supabase
      .from("projects")
      .update({
        strategy_status: "approved",
        strategy_approved_at: now,
        updated_at: now,
      })
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .eq("client_id", clientId);
    if (error) throw new Error(`live-project: approveStrategy failed: ${stringifyErr(error)}`);
  }

  async listProjectPieces(
    projectId: string,
    workspaceId: string,
    clientId: string,
  ): Promise<ProjectPieceFact[]> {
    // The project's articles = pieces linked to conversations in this project.
    const { data: convs, error: convErr } = await this.supabase
      .from("conversations")
      .select("piece_id")
      .eq("project_id", projectId)
      .eq("workspace_id", workspaceId)
      .eq("client_id", clientId)
      .not("piece_id", "is", null);
    if (convErr) throw new Error(`live-project: listProjectPieces (convs) failed: ${stringifyErr(convErr)}`);
    const ids = (convs ?? [])
      .map((c) => asStringOrNull(c.piece_id))
      .filter((s): s is string => s !== null);
    if (ids.length === 0) return [];

    const { data: pieces, error: pieceErr } = await this.supabase
      .from("content_pieces")
      .select("id, title, slug, cluster_role, funnel_stage, meta_description, excerpt, brief_snapshot, updated_at")
      .in("id", ids)
      .eq("client_id", clientId)
      .order("updated_at", { ascending: false });
    if (pieceErr) throw new Error(`live-project: listProjectPieces (pieces) failed: ${stringifyErr(pieceErr)}`);
    return (pieces ?? []).map(mapPieceFact).filter((r): r is ProjectPieceFact => r !== null);
  }
}

/**
 * Build a `LiveProjectDataAccess` from a service-role Supabase client — but ONLY if
 * the host creds are present. Returns null otherwise (caller keeps the fail-closed
 * NOT_WIRED default). Mirrors `makeLiveConversationDataAccess`.
 */
export async function makeLiveProjectDataAccess(): Promise<LiveProjectDataAccess | null> {
  const creds = readReadAdapterCreds();
  if (!creds) return null;
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(creds.url, creds.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as ProjectSupabase;
  return new LiveProjectDataAccess(supabase);
}
