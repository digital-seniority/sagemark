/**
 * Project data-access seam (studio UX overhaul, Slice 5).
 *
 * The Projects layer (migration 0042) persists ONLY through this seam — mirroring
 * the content + conversation seams:
 *   - every method is TENANCY-SCOPED by the BOUND `(workspaceId, clientId)` (the
 *     server's notion of "who"), never request input; a cross-tenant id resolves to
 *     null / empty, never a leak;
 *   - the production default `NOT_WIRED_PROJECT_ACCESS` THROWS on every method
 *     (fail-closed) until the live service-role adapter is composed on (creds-gated);
 *   - tests inject an in-memory/fixture impl.
 *
 * `listProjectPieces` is the cross-article context source: the facts about the
 * articles already in a project that `build-project-context.ts` summarizes for a
 * new run. Clean ASCII / UTF-8. No `server-only` (imported by plain-Node tests).
 */

/** A persisted `projects` row. */
export interface ProjectRow {
  id: string;
  workspaceId: string;
  clientId: string;
  name: string;
  description: string | null;
  /** The operator-editable narrative carried into new articles. */
  brief: string;
  /** The auto-facts cache (jsonb), or null. */
  summary: unknown | null;
  /** The proposed or approved ContentStrategy JSON blob, or null. */
  strategy: unknown | null;
  /** 'proposed' | 'approved' | 'archived' | null (null = no strategy yet). */
  strategyStatus: "proposed" | "approved" | "archived" | null;
  strategyApprovedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The facts about one prior article in a project (the context source). */
export interface ProjectPieceFact {
  id: string;
  title: string;
  slug: string;
  clusterRole: string | null;
  funnelStage: string | null;
  primaryKeyword: string | null;
  excerpt: string | null;
}

/** Create-a-project payload (the BOUND tenancy, never request input). */
export interface CreateProjectInput {
  workspaceId: string;
  clientId: string;
  name: string;
  description?: string | null;
  brief?: string | null;
}

/** The mockable project data-access seam. Every method is tenancy-scoped. */
export interface ProjectDataAccess {
  createProject(input: CreateProjectInput): Promise<string>;
  listProjects(workspaceId: string, clientId: string): Promise<ProjectRow[]>;
  getProject(id: string, workspaceId: string, clientId: string): Promise<ProjectRow | null>;
  /** Update the operator-editable brief + bump updated_at. Scoped by the bound pair. */
  updateProjectBrief(
    id: string,
    brief: string,
    workspaceId: string,
    clientId: string,
  ): Promise<void>;
  /**
   * List the articles already in a project (the cross-article context source),
   * most-recent first. Scoped by the bound (workspaceId, clientId) AND the
   * project id.
   */
  listProjectPieces(
    projectId: string,
    workspaceId: string,
    clientId: string,
  ): Promise<ProjectPieceFact[]>;
  /**
   * Persist a proposed ContentStrategy (strategy_status → 'proposed').
   * Replaces any prior draft. Scoped by bound tenancy.
   */
  persistStrategy(
    id: string,
    strategy: unknown,
    workspaceId: string,
    clientId: string,
  ): Promise<void>;
  /**
   * Flip strategy_status 'proposed' → 'approved' and stamp strategy_approved_at.
   * Scoped by bound tenancy.
   */
  approveStrategy(
    id: string,
    workspaceId: string,
    clientId: string,
  ): Promise<void>;
}

/** Fail-closed default error (mirrors the content/conversation seams). */
class ProjectAccessNotWiredError extends Error {
  readonly code = "PROJECT_ACCESS_NOT_WIRED" as const;
  constructor(op: string) {
    super(
      `project data access is not wired: '${op}' has no live Supabase backend in ` +
        `this build. Inject a ProjectDataAccess via the route seam, or wire the live ` +
        `service-role impl.`,
    );
    this.name = "ProjectAccessNotWiredError";
  }
}

export { ProjectAccessNotWiredError };

/** The production default — every method throws (fail-closed, never fail-open). */
export const NOT_WIRED_PROJECT_ACCESS: ProjectDataAccess = {
  createProject: () => {
    throw new ProjectAccessNotWiredError("createProject");
  },
  listProjects: () => {
    throw new ProjectAccessNotWiredError("listProjects");
  },
  getProject: () => {
    throw new ProjectAccessNotWiredError("getProject");
  },
  updateProjectBrief: () => {
    throw new ProjectAccessNotWiredError("updateProjectBrief");
  },
  listProjectPieces: () => {
    throw new ProjectAccessNotWiredError("listProjectPieces");
  },
  persistStrategy: () => {
    throw new ProjectAccessNotWiredError("persistStrategy");
  },
  approveStrategy: () => {
    throw new ProjectAccessNotWiredError("approveStrategy");
  },
};
