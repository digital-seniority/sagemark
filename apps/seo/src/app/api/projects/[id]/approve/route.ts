/**
 * POST /api/projects/[id]/approve — approve a proposed content strategy.
 *
 * Flips strategy_status 'proposed' → 'approved'. Requires an authenticated
 * operator (auth → tenancy bind). Body: { clientId: string }.
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
  projects: Pick<ProjectDataAccess, "getProject" | "approveStrategy">;
  resolveWorkspace: () => Promise<Workspace | null>;
}

const DEFAULT_DEPS: RouteDeps = {
  data: NOT_WIRED_DATA_ACCESS,
  projects: NOT_WIRED_PROJECT_ACCESS,
  resolveWorkspace: getCurrentWorkspace,
};

const BodySchema = z.object({ clientId: z.string().uuid() }).strict();

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

export async function handleApproveStrategy(
  request: Request,
  params: { id: string },
  deps: RouteDeps = DEFAULT_DEPS,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid json", code: "bad-request" }, 400);
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "missing or invalid clientId", code: "bad-request" }, 400);
  }

  const bound = await bindRequestContext(parsed.data.clientId, deps.data, deps.resolveWorkspace);
  if (!bound.ok) {
    return json({ error: bound.code, code: bound.code }, bound.status);
  }
  const ctx = bound.context;

  // Verify the project exists and belongs to the bound tenancy.
  const project = await deps.projects.getProject(params.id, ctx.workspaceId, ctx.clientId);
  if (!project) {
    return json({ error: "not found", code: "not-found" }, 404);
  }
  if (!project.strategyStatus || project.strategyStatus === "approved") {
    return json({ strategyStatus: project.strategyStatus ?? null }, 200);
  }

  await deps.projects.approveStrategy(params.id, ctx.workspaceId, ctx.clientId);

  console.log(
    `[api/projects/approve] workspaceId=${ctx.workspaceId} clientId=${ctx.clientId} projectId=${params.id}`,
  );
  return json({ strategyStatus: "approved" }, 200);
}

async function liveDeps(): Promise<RouteDeps> {
  const [data, projects] = await Promise.all([
    resolveContentDataAccess(),
    resolveProjectDataAccess(),
  ]);
  return { data, projects, resolveWorkspace: getCurrentWorkspace };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleApproveStrategy(request, await params, await liveDeps());
}
