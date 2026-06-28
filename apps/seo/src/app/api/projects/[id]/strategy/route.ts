/**
 * GET /api/projects/[id]/strategy — read a project's strategy (tenancy-scoped).
 *
 * Mirrors the /api/projects collection route: auth → SERVER-side tenancy bind
 * (`clientId` query param; the URL [id] is the project id) → getProject →
 * return { strategy, strategyStatus }. Cross-tenant or unknown ids → 404.
 *
 * Clean ASCII / UTF-8.
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
} from "@/lib/projects/context";
import { resolveProjectDataAccess } from "@/lib/projects/resolve-project-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export interface RouteDeps {
  data: Pick<ContentDataAccess, "clientBelongsToWorkspace">;
  projects: Pick<ProjectDataAccess, "getProject">;
  resolveWorkspace: () => Promise<Workspace | null>;
}

const DEFAULT_DEPS: RouteDeps = {
  data: NOT_WIRED_DATA_ACCESS,
  projects: NOT_WIRED_PROJECT_ACCESS,
  resolveWorkspace: getCurrentWorkspace,
};

const QuerySchema = z.object({ clientId: z.string().uuid() });

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

export async function handleGetStrategy(
  request: Request,
  params: { id: string },
  deps: RouteDeps = DEFAULT_DEPS,
): Promise<Response> {
  const url = new URL(request.url);
  const query = QuerySchema.safeParse({ clientId: url.searchParams.get("clientId") ?? "" });
  if (!query.success) {
    return json({ error: "missing or invalid clientId", code: "bad-request" }, 400);
  }

  const bound = await bindRequestContext(query.data.clientId, deps.data, deps.resolveWorkspace);
  if (!bound.ok) {
    return json({ error: bound.code, code: bound.code }, bound.status);
  }
  const ctx = bound.context;

  const project = await deps.projects.getProject(params.id, ctx.workspaceId, ctx.clientId);
  if (!project) {
    return json({ error: "not found", code: "not-found" }, 404);
  }

  return json(
    {
      strategy: project.strategy ?? null,
      strategyStatus: project.strategyStatus ?? null,
      strategyApprovedAt: project.strategyApprovedAt ?? null,
    },
    200,
  );
}

async function liveDeps(): Promise<RouteDeps> {
  const [data, projects] = await Promise.all([
    resolveContentDataAccess(),
    resolveProjectDataAccess(),
  ]);
  return { data, projects, resolveWorkspace: getCurrentWorkspace };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleGetStrategy(request, await params, await liveDeps());
}
