/**
 * /api/projects — create + list, tenancy-scoped (Slice 5b).
 *
 * Mirrors the conversation-routes suite: the only caller tenancy field is clientId
 * (validated owned -> 404 on a foreign id; 401 with no operator); create/list run
 * scoped by the BOUND (workspaceId, clientId) via an injected ProjectDataAccess.
 */

import { describe, it, expect, vi } from "vitest";

import { handleCreateProject, handleListProjects, type RouteDeps } from "@/app/api/projects/route";
import type {
  ProjectDataAccess,
  ProjectRow,
  CreateProjectInput,
} from "@/lib/projects/context";
import {
  makeData,
  workspace,
  jsonRequest,
  WORKSPACE_A,
  CLIENT_A,
  CLIENT_B,
} from "../content/fixtures";

function projectRow(over: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "proj-1",
    workspaceId: WORKSPACE_A,
    clientId: CLIENT_A,
    name: "Dementia Care Hub",
    description: null,
    brief: "",
    summary: null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    ...over,
  };
}

function makeProjects(rows: ProjectRow[] = []) {
  const created: CreateProjectInput[] = [];
  const seam: ProjectDataAccess = {
    createProject: vi.fn(async (input: CreateProjectInput) => {
      created.push(input);
      return "proj-new";
    }),
    listProjects: vi.fn(async () => rows),
    getProject: vi.fn(async () => rows[0] ?? null),
    updateProjectBrief: vi.fn(async () => undefined),
    listProjectPieces: vi.fn(async () => []),
  };
  return Object.assign(seam, { created });
}

function deps(over: Partial<RouteDeps> = {}): RouteDeps {
  return {
    data: makeData(),
    projects: makeProjects(),
    resolveWorkspace: async () => workspace(WORKSPACE_A),
    ...over,
  };
}

function getRequest(clientId: string): Request {
  return new Request(`http://test/api/projects?clientId=${encodeURIComponent(clientId)}`);
}

describe("POST /api/projects — create", () => {
  it("creates scoped to the SERVER's workspace + validated clientId", async () => {
    const projects = makeProjects();
    const res = await handleCreateProject(
      jsonRequest({ clientId: CLIENT_A, name: "Dementia Care Hub" }),
      deps({ projects }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).projectId).toBe("proj-new");
    expect(projects.created[0]).toMatchObject({
      workspaceId: WORKSPACE_A,
      clientId: CLIENT_A,
      name: "Dementia Care Hub",
    });
  });

  it("a foreign clientId not owned by the workspace -> 404 (no create)", async () => {
    const projects = makeProjects();
    const res = await handleCreateProject(
      jsonRequest({ clientId: CLIENT_B, name: "X" }),
      deps({ projects }),
    );
    expect(res.status).toBe(404);
    expect(projects.created).toHaveLength(0);
  });

  it("missing name -> 400", async () => {
    const res = await handleCreateProject(jsonRequest({ clientId: CLIENT_A }), deps());
    expect(res.status).toBe(400);
  });

  it("a body carrying its own workspaceId is rejected (strict) -> 400", async () => {
    const res = await handleCreateProject(
      jsonRequest({ clientId: CLIENT_A, name: "X", workspaceId: WORKSPACE_A }),
      deps(),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/projects — list", () => {
  it("lists the bound tenant's projects", async () => {
    const res = await handleListProjects(
      getRequest(CLIENT_A),
      deps({ projects: makeProjects([projectRow(), projectRow({ id: "proj-2", name: "Second" })]) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toHaveLength(2);
    expect(body.projects[0]).toMatchObject({ id: "proj-1", name: "Dementia Care Hub" });
  });

  it("a foreign clientId -> 404", async () => {
    const res = await handleListProjects(getRequest(CLIENT_B), deps());
    expect(res.status).toBe(404);
  });
});
