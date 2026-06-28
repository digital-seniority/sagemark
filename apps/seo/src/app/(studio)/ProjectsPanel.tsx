"use client";

/**
 * ProjectsPanel — the Projects surface on the studio home (Slice 5b).
 *
 * Lists the client's projects, creates a new one (POST /api/projects), and starts
 * an article INSIDE a project (a compact StartConversationButton carrying the
 * project id, so the new run inherits the project's cross-article context). Tenancy
 * is the server's — the panel only forwards the SERVER-RESOLVED clientId. Dark
 * tokens, no hardcoded palette. `fetchImpl` injectable for tests. Clean ASCII/UTF-8.
 */

import { useState } from "react";
import { StartConversationButton } from "./StartConversationButton";

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
}

export interface ProjectsPanelProps {
  clientId: string;
  initialProjects: ProjectSummary[];
  fetchImpl?: typeof fetch;
}

export function ProjectsPanel({ clientId, initialProjects, fetchImpl }: ProjectsPanelProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>(initialProjects);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const doFetch = fetchImpl ?? fetch;

  async function refresh() {
    try {
      const res = await doFetch(`/api/projects?clientId=${encodeURIComponent(clientId)}`, {
        headers: { accept: "application/json" },
      });
      if (res.ok) {
        const body = (await res.json()) as { projects?: ProjectSummary[] };
        if (Array.isArray(body.projects)) setProjects(body.projects);
      }
    } catch {
      // a failed refresh leaves the current list
    }
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await doFetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId, name: trimmed }),
      });
      if (!res.ok) {
        setError("Couldn't create the project. Try again.");
        return;
      }
      setName("");
      await refresh();
    } catch {
      setError("Couldn't create the project. Try again.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section data-testid="projects-panel">
      <h2
        style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.6 }}
      >
        Projects
      </h2>
      <p style={{ fontSize: 13, color: "var(--muted)", margin: "6px 0 14px", lineHeight: 1.55 }}>
        Group related articles. A new article started in a project automatically gets a summary
        of the prior work as context.
      </p>

      {/* New-project inline form */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <input
          data-testid="project-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
          placeholder="New project name"
          style={{
            flex: 1,
            maxWidth: 320,
            fontSize: 13,
            padding: "8px 11px",
            borderRadius: 9,
            border: "1px solid var(--line)",
            background: "var(--panel-2)",
            color: "var(--foreground)",
          }}
        />
        <button
          type="button"
          data-testid="project-create"
          onClick={() => void create()}
          disabled={creating || name.trim().length === 0}
          style={{
            fontSize: 13,
            fontWeight: 600,
            padding: "8px 14px",
            borderRadius: 999,
            color: "var(--background)",
            background: "var(--foreground)",
            border: "none",
            cursor: creating || name.trim().length === 0 ? "default" : "pointer",
            opacity: creating || name.trim().length === 0 ? 0.5 : 1,
          }}
        >
          {creating ? "Creating…" : "New project"}
        </button>
      </div>
      {error && (
        <p role="alert" data-testid="project-error" style={{ fontSize: 13, color: "var(--accent-red)", margin: "0 0 12px" }}>
          {error}
        </p>
      )}

      {projects.length === 0 ? (
        <p data-testid="projects-empty" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
          No projects yet. Create one to group articles and carry context between them.
        </p>
      ) : (
        <ul
          data-testid="projects-list"
          style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}
        >
          {projects.map((p) => (
            <li
              key={p.id}
              data-testid="project-row"
              data-project-id={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "0.75rem 1rem",
                borderRadius: 10,
                border: "1px solid var(--line)",
                background: "var(--panel)",
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{p.name}</span>
                {p.description && (
                  <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                    {p.description}
                  </span>
                )}
              </span>
              <StartConversationButton
                clientId={clientId}
                projectId={p.id}
                label="New article"
                compact
                fetchImpl={fetchImpl}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default ProjectsPanel;
