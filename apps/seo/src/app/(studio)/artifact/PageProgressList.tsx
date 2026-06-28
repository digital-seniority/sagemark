"use client";

/**
 * PageProgressList — roadmap progress panel for hub projects (Slice 11).
 *
 * Shown in ArtifactZone when a hub project's strategy is approved and
 * authoring is underway. Fetches the orchestration status from
 * GET /api/projects/[id]/orchestrate?clientId=<id> and displays per-page
 * authored/pending status.
 *
 * Polls once on mount (no live polling — the operator can dispatch runs manually
 * via the canvas chat and the list refreshes on the next modal open / page reload).
 */

import { useEffect, useState } from "react";

/** Per-page status row from the orchestrate route (Slice 6). */
interface OrchestratePageStatus {
  slug: string;
  title: string;
  clusterRole: string | null;
  funnelStage: string | null;
  primaryKeyword: string | null;
  authored: boolean;
}

interface OrchestrateStatus {
  projectId: string;
  strategyStatus: string;
  total: number;
  authoredCount: number;
  pendingCount: number;
  pages: OrchestratePageStatus[];
}

export interface PageProgressListProps {
  projectId: string;
  clientId: string;
  /** Optional fetch override for tests. */
  fetchImpl?: typeof fetch;
}

const CLUSTER_ROLE_LABEL: Record<string, string> = {
  pillar: "Pillar",
  cornerstone: "Cornerstone",
  spoke: "Spoke",
  faq: "FAQ",
  checklist: "Checklist",
};

export function PageProgressList({ projectId, clientId, fetchImpl }: PageProgressListProps) {
  const [status, setStatus] = useState<OrchestrateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetcher = fetchImpl ?? fetch;
    setLoading(true);
    fetcher(`/api/projects/${encodeURIComponent(projectId)}/orchestrate?clientId=${encodeURIComponent(clientId)}`)
      .then(async (res) => {
        if (!res.ok) {
          setError(`Could not load roadmap status (${res.status})`);
          return;
        }
        const data = (await res.json()) as OrchestrateStatus;
        setStatus(data);
      })
      .catch(() => setError("Could not load roadmap status"))
      .finally(() => setLoading(false));
  }, [projectId, clientId, fetchImpl]);

  if (loading) {
    return (
      <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
        Loading roadmap…
      </p>
    );
  }

  if (error || !status) {
    return (
      <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
        {error ?? "No roadmap data."}
      </p>
    );
  }

  return (
    <div data-testid="page-progress-list" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <p
        style={{
          margin: "0 0 4px",
          fontSize: 10.5,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--muted-2)",
        }}
      >
        Hub roadmap · {status.authoredCount}/{status.total} pages authored
      </p>
      {status.pages.map((page) => (
        <div
          key={page.slug}
          data-testid="page-progress-row"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 8px",
            borderRadius: 6,
            background: page.authored ? "rgba(34,197,94,0.07)" : "var(--surface-2, rgba(255,255,255,0.04))",
            border: `1px solid ${page.authored ? "rgba(34,197,94,0.2)" : "var(--line)"}`,
          }}
        >
          {/* Status dot */}
          <span
            aria-label={page.authored ? "Authored" : "Pending"}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              flexShrink: 0,
              background: page.authored ? "#22c55e" : "var(--muted)",
            }}
          />
          {/* Title + role chip */}
          <span style={{ flex: 1, fontSize: 12, color: "var(--foreground)", minWidth: 0 }}>
            <span style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {page.title}
            </span>
          </span>
          {page.clusterRole ? (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "var(--muted-2)",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                flexShrink: 0,
              }}
            >
              {CLUSTER_ROLE_LABEL[page.clusterRole] ?? page.clusterRole}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
