/**
 * GET /api/projects/[id]/orchestrate — hub roadmap orchestration status.
 *
 * Returns the project's roadmap with per-page authored/pending status, derived
 * by cross-referencing the approved ContentStrategy.roadmap with the slugs of
 * content_pieces already persisted for this project. The canvas (Slice 11) uses
 * this to drive the PageProgressList and know when to auto-dispatch the next
 * authoring run.
 *
 * Auth + tenancy follow the /api/projects pattern: operator auth → SERVER-side
 * tenancy bind (clientId from query param) → read project + listProjectPieces.
 * Cross-tenant or unknown projectId → 404. No strategy → 409.
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
import type { ContentStrategy, ContentStrategyRoadmapItem } from "@sagemark/schema-flywheel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export interface RouteDeps {
  data: Pick<ContentDataAccess, "clientBelongsToWorkspace">;
  projects: Pick<ProjectDataAccess, "getProject" | "listProjectPieces">;
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

export interface OrchestratePageStatus {
  slug: string;
  title: string;
  clusterRole: string;
  funnelStage: string | null;
  primaryKeyword: string | null;
  /** Whether a content_pieces row already exists for this slug in the project. */
  authored: boolean;
}

export interface OrchestrateStatus {
  projectId: string;
  strategyStatus: "approved";
  total: number;
  authoredCount: number;
  pendingCount: number;
  pages: OrchestratePageStatus[];
}

export async function handleGetOrchestrate(
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
  if (project.strategyStatus !== "approved" || !project.strategy) {
    return json(
      {
        error: "project strategy must be approved before orchestration is available",
        code: "strategy-not-approved",
      },
      409,
    );
  }

  const strategy = project.strategy as ContentStrategy;
  const roadmap: ContentStrategyRoadmapItem[] = strategy.roadmap ?? [];

  // Derive authored status from the existing pieces for this project.
  const existingPieces = await deps.projects.listProjectPieces(
    params.id,
    ctx.workspaceId,
    ctx.clientId,
  );
  const authoredSlugs = new Set(existingPieces.map((p) => p.slug));

  const pages: OrchestratePageStatus[] = roadmap.map((item) => ({
    slug: item.slug,
    title: item.title,
    clusterRole: item.clusterRole,
    funnelStage: item.funnelStage ?? null,
    primaryKeyword: item.primaryKeyword ?? null,
    authored: authoredSlugs.has(item.slug),
  }));

  const authoredCount = pages.filter((p) => p.authored).length;

  return json(
    {
      projectId: params.id,
      strategyStatus: "approved",
      total: pages.length,
      authoredCount,
      pendingCount: pages.length - authoredCount,
      pages,
    } satisfies OrchestrateStatus,
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
  return handleGetOrchestrate(request, await params, await liveDeps());
}
