/**
 * /api/projects — the Projects collection (studio UX overhaul, Slice 5b).
 *
 *   POST /api/projects           { clientId, name, description?, brief? } -> { projectId }
 *   GET  /api/projects?clientId= -> { projects: [...] }
 *
 * Mirrors /api/conversations: auth -> SERVER-side tenancy bind (the ONLY caller
 * tenancy field is `clientId`, validated owned -> 404 on a foreign id; 401 with no
 * operator), then every read/write scoped by the BOUND (workspaceId, clientId) via
 * the ProjectDataAccess seam. Handlers exported for unit tests; the POST/GET
 * wrappers resolve the live seams behind the creds gate. PII: log only ids.
 */

import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentWorkspace } from "@/lib/auth";
import type { Workspace } from "@/lib/auth";
import {
  bindRequestContext,
  NOT_WIRED_DATA_ACCESS,
  type ContentDataAccess,
} from "@/lib/content/context";
import { resolveContentDataAccess } from "@/lib/content/resolve-data-access";
import {
  NOT_WIRED_PROJECT_ACCESS,
  type ProjectDataAccess,
  type ProjectRow,
} from "@/lib/projects/context";
import { resolveProjectDataAccess } from "@/lib/projects/resolve-project-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export interface RouteDeps {
  data: Pick<ContentDataAccess, "clientBelongsToWorkspace">;
  projects: ProjectDataAccess;
  resolveWorkspace: () => Promise<Workspace | null>;
}

const DEFAULT_DEPS: RouteDeps = {
  data: NOT_WIRED_DATA_ACCESS,
  projects: NOT_WIRED_PROJECT_ACCESS,
  resolveWorkspace: getCurrentWorkspace,
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

const CreateBodySchema = z
  .object({
    clientId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    brief: z.string().max(8000).optional(),
  })
  .strict();

const ListQuerySchema = z.object({ clientId: z.string().uuid() });

function toWire(p: ProjectRow) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    brief: p.brief,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export async function handleCreateProject(
  request: Request,
  deps: RouteDeps = DEFAULT_DEPS,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid json", code: "bad-request" }, 400);
  }
  const parsed = CreateBodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid request body", code: "bad-request" }, 400);
  }
  const body = parsed.data;

  const bound = await bindRequestContext(body.clientId, deps.data, deps.resolveWorkspace);
  if (!bound.ok) {
    return json({ error: bound.code, code: bound.code }, bound.status);
  }
  const ctx = bound.context;

  const projectId = await deps.projects.createProject({
    workspaceId: ctx.workspaceId,
    clientId: ctx.clientId,
    name: body.name,
    description: body.description ?? null,
    brief: body.brief ?? "",
  });

  console.log(
    `[api/projects] create workspaceId=${ctx.workspaceId} clientId=${ctx.clientId} projectId=${projectId}`,
  );
  return json({ projectId }, 201);
}

export async function handleListProjects(
  request: Request,
  deps: RouteDeps = DEFAULT_DEPS,
): Promise<Response> {
  const url = new URL(request.url);
  const query = ListQuerySchema.safeParse({ clientId: url.searchParams.get("clientId") ?? "" });
  if (!query.success) {
    return json({ error: "missing or invalid clientId", code: "bad-request" }, 400);
  }

  const bound = await bindRequestContext(query.data.clientId, deps.data, deps.resolveWorkspace);
  if (!bound.ok) {
    return json({ error: bound.code, code: bound.code }, bound.status);
  }
  const ctx = bound.context;

  const rows = await deps.projects.listProjects(ctx.workspaceId, ctx.clientId);
  return json({ projects: rows.map(toWire) }, 200);
}

async function liveDeps(): Promise<RouteDeps> {
  const [data, projects] = await Promise.all([
    resolveContentDataAccess(),
    resolveProjectDataAccess(),
  ]);
  return { data, projects, resolveWorkspace: getCurrentWorkspace };
}

export async function POST(request: Request): Promise<Response> {
  return handleCreateProject(request, await liveDeps());
}

export async function GET(request: Request): Promise<Response> {
  return handleListProjects(request, await liveDeps());
}
