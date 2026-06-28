/**
 * POST /content/api/strategy — host-validated strategy persist for a project.
 * Contract: `content-engine/1.0` (hub skill, Slice 2).
 *
 * A host-side tool the worker calls during a strategy run. THE TENANCY-TRUST BOUNDARY:
 *   1. Parse + validate (contract version, body).
 *   2. Bind tenancy SERVER-side (same pattern as /content/api/draft).
 *   3. REJECT (403) any payload whose request-supplied workspaceId/clientId does
 *      not match the bound context (criterion 2).
 *   4. Verify the projectId belongs to this (workspaceId, clientId) → 404.
 *   5. Write strategy to the bound project as `proposed` status.
 *
 * NO voice-spec gate — strategy planning precedes authoring. The gate on authoring
 * (voice spec + approved strategy) lives in /content/api/draft (Slice 5).
 *
 * PII rule: log only ids.
 */

import "server-only";
import { NextResponse } from "next/server";

import { getCurrentWorkspace } from "@/lib/auth";
import type { Workspace } from "@/lib/auth";
import {
  PersistStrategyRequestSchema,
  CONTENT_CONTRACT_VERSION,
  checkContractVersion,
} from "@/lib/content/contract";
import {
  authenticateBridgeRequest,
  assertTenancyMatch,
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
export const maxDuration = 30;

export interface StrategyDeps {
  data: Pick<ContentDataAccess, "clientBelongsToWorkspace">;
  projects: ProjectDataAccess;
  resolveWorkspace: () => Promise<Workspace | null>;
  jwtSecret?: string;
  bridgeNowMs?: () => number;
}

const DEFAULT_DEPS: StrategyDeps = {
  data: NOT_WIRED_DATA_ACCESS,
  projects: NOT_WIRED_PROJECT_ACCESS,
  resolveWorkspace: getCurrentWorkspace,
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

export async function handleStrategy(
  request: Request,
  deps: StrategyDeps = DEFAULT_DEPS,
): Promise<Response> {
  // 1. Parse + validate.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid json", code: "bad-request" }, 400);
  }
  const parsed = PersistStrategyRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid request body", code: "bad-request" }, 400);
  }
  const body = parsed.data;

  const mismatch = checkContractVersion(body.contractVersion);
  if (mismatch) return json({ error: "contract version mismatch", ...mismatch }, 409);

  // 2. Authenticate + bind tenancy SERVER-side.
  const bound = await authenticateBridgeRequest(
    request,
    body.clientId,
    deps.data,
    deps.resolveWorkspace,
    { secret: deps.jwtSecret, nowMs: deps.bridgeNowMs?.() },
  );
  if (!bound.ok) {
    return json({ error: bound.code, code: bound.code }, bound.status);
  }
  const ctx = bound.context;

  // 3. REJECT a request-supplied tenancy that does not match the binding (403).
  if (!assertTenancyMatch({ workspaceId: body.workspaceId, clientId: body.clientId }, ctx)) {
    return json(
      { error: "request tenancy does not match the bound context", code: "tenancy-mismatch" },
      403,
    );
  }

  // 4. Verify the project belongs to this tenancy (refuse cross-tenant writes).
  const project = await deps.projects.getProject(body.projectId, ctx.workspaceId, ctx.clientId);
  if (!project) {
    return json(
      { error: "project not found or does not belong to this client", code: "project-not-found" },
      404,
    );
  }

  // 5. Persist the strategy. Host-side write scoped by BOUND (workspaceId, clientId).
  try {
    await deps.projects.persistStrategy(body.projectId, body.strategy, ctx.workspaceId, ctx.clientId);
  } catch (err) {
    console.error("[content/strategy] persist failed", {
      workspaceId: ctx.workspaceId,
      clientId: ctx.clientId,
      projectId: body.projectId,
      message: err instanceof Error ? err.message : "unknown",
    });
    return json({ error: "strategy could not be saved", code: "persist-failed" }, 500);
  }

  console.log(
    `[content/strategy] ok workspaceId=${ctx.workspaceId} clientId=${ctx.clientId} projectId=${body.projectId}`,
  );

  return json(
    {
      contractVersion: CONTENT_CONTRACT_VERSION,
      projectId: body.projectId,
      strategyStatus: "proposed",
    },
    200,
  );
}

export async function POST(request: Request): Promise<Response> {
  const [data, projects] = await Promise.all([
    resolveContentDataAccess(),
    resolveProjectDataAccess(),
  ]);
  return handleStrategy(request, { ...DEFAULT_DEPS, data, projects });
}
