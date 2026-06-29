"use client";

/**
 * ArtifactZone — the CENTER zone of the three-zone studio canvas.
 *
 * Brief card + a Draft/Preview switch + the verdict dot + Export, and the body:
 *   - DRAFT (view) renders the live serif reading view (`DraftPaper`) the
 *     token-delta stream materializes into.
 *   - DRAFT (edit, Slice 3) swaps in the `MarkdownEditor` so the operator can edit
 *     the markdown directly; "Save & re-check" POSTs /api/revise (append-only
 *     version + full gate re-run) and folds the re-gated result back via
 *     `onApplyEdit`. Each accepted edit lands in the `ActivityFeed`. (Asking the
 *     agent to edit is the chat composer's revision turn — both paths coexist.)
 *   - PREVIEW renders the real reading view in a sandboxed iframe (`PreviewFrame`).
 *
 * Editing is available only on a chat-driven canvas with a known pieceId + body
 * (so the save can target the persisted draft). Colour from the dark tokens.
 * Clean ASCII / UTF-8.
 */

import { useState } from "react";
import { ScoreSignalDot } from "@/components/ScoreSignalDot";
import type { GateScorecard } from "@/lib/stream/use-ui-message-stream";
import { reviseDraft, ReviseError } from "@/lib/edit/revise-client";
import { BriefCard, type ContentBrief } from "./BriefCard";
import { StrategyCard } from "./StrategyCard";
import { ModeTabs, type ArtifactMode } from "./ModeTabs";
import type { ContentStrategy } from "@sagemark/schema-flywheel";
import { DraftPaper } from "./DraftPaper";
import { MarkdownEditor } from "./MarkdownEditor";
import { PreviewFrame } from "./PreviewFrame";
import { ExportMenu } from "./ExportMenu";
import { ActivityFeed, type EditActivityItem, type EditVerdict } from "../agent/ActivityFeed";
import { PageProgressList } from "./PageProgressList";

/** The re-gated edit result the canvas folds back as the persisted truth. */
export interface ApplyEditResult {
  body: string;
  verdict: string | null;
  score: number | null;
  vetoes: string[];
}

export interface ArtifactZoneProps {
  /** The resolved content brief, or null before a run produces one. */
  brief: ContentBrief | null;
  /** The project's hub strategy (present when the project is in a hub program). */
  strategy?: ContentStrategy | null;
  /** 'proposed' = awaiting operator approval; 'approved' = authoring unlocked. */
  strategyStatus?: "proposed" | "approved" | "archived" | null;
  /** The project id (needed for the approve POST). */
  projectId?: string | null;
  /** The bound client id (needed for tenancy on the approve POST). */
  strategyClientId?: string | null;
  /** The client's public blog slug — enables the Hub preview tab (Slice 11). */
  hubBlogSlug?: string | null;
  /** The accumulated markdown body from the SSE `token-delta` stream / snapshot. */
  body: string;
  /** Whether the body is still actively streaming (drives the live caret hint). */
  streaming?: boolean;
  /** The latest gate scorecard projection (drives the verdict signal dot). */
  scorecard?: GateScorecard | null;
  /** The bound client (needed to save an in-place edit). */
  clientId?: string | null;
  /** The piece being edited (null before a draft exists; gates the save). */
  pieceId?: string | null;
  /** Fold a re-gated in-place edit back into the canvas (chat path only). */
  onApplyEdit?: (result: ApplyEditResult) => void;
  /** Bump to re-fetch the hub roadmap so the authored count advances live (S3). */
  roadmapRefreshSignal?: number;
  /** Injectable fetch for the revise POST (tests). */
  fetchImpl?: typeof fetch;
}

/** Map a revise error code to a plain, operator-facing reason. */
function reviseErrorMessage(code: string): string {
  switch (code) {
    case "piece-not-editable":
      return "This piece is no longer a draft, so it can't be edited.";
    case "rate-limited":
      return "Too many edits just now — wait a moment and try again.";
    case "stale-edit":
      return "The draft changed since you started. Reload to get the latest.";
    case "no-version":
      return "There's no saved draft to edit yet.";
    default:
      return "Couldn't save the edit. Try again.";
  }
}

const TOOLBTN: React.CSSProperties = {
  appearance: "none",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11.5,
  color: "var(--foreground)",
  background: "transparent",
  border: "1px solid var(--line)",
  borderRadius: 7,
  padding: "4px 9px",
};

export function ArtifactZone({
  brief,
  strategy = null,
  strategyStatus: initialStrategyStatus = null,
  projectId = null,
  strategyClientId = null,
  hubBlogSlug = null,
  body,
  streaming = false,
  scorecard,
  clientId = null,
  pieceId = null,
  onApplyEdit,
  roadmapRefreshSignal = 0,
  fetchImpl,
}: ArtifactZoneProps) {
  const [localStrategyStatus, setLocalStrategyStatus] = useState(initialStrategyStatus);
  const [mode, setMode] = useState<ArtifactMode>("draft");
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(body);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [edits, setEdits] = useState<EditActivityItem[]>([]);

  const canEdit =
    Boolean(onApplyEdit && clientId && pieceId && body.trim().length > 0) && !streaming;

  function startEditing() {
    setDraftText(body);
    setSaveError(null);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setSaveError(null);
  }

  async function saveEdit() {
    if (!clientId || !pieceId || !onApplyEdit) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await reviseDraft({ clientId, pieceId, body: draftText }, fetchImpl);
      const vetoes = result.stageAClean ? [] : result.failureCodes;
      onApplyEdit({ body: draftText, verdict: result.verdict, score: result.score, vetoes });
      setEdits((prev) => [
        ...prev,
        {
          version: result.version,
          summary: "Edited directly in the editor",
          verdict: (result.verdict as EditVerdict | null) ?? null,
          score: result.score,
          stageAClean: result.stageAClean,
        },
      ]);
      setEditing(false);
    } catch (err) {
      setSaveError(
        err instanceof ReviseError ? reviseErrorMessage(err.code) : "Couldn't save the edit. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      data-zone-body="artifact"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: "1rem 1.25rem",
        height: "100%",
        minHeight: 0,
      }}
    >
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <ModeTabs active={mode} onChange={setMode} hubEnabled={Boolean(hubBlogSlug && strategy)} />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {mode === "draft" && canEdit && !editing && (
            <button type="button" data-testid="artifact-edit-toggle" style={TOOLBTN} onClick={startEditing}>
              Edit
            </button>
          )}
          <ExportMenu brief={brief} body={body} />
          <ScoreSignalDot verdict={scorecard?.verdict ?? null} score={scorecard?.score ?? null} />
        </div>
      </header>

      {/* Hub roadmap progress — visible when strategy approved + projectId bound. */}
      {localStrategyStatus === "approved" && projectId && strategyClientId && (
        <PageProgressList
          projectId={projectId}
          clientId={strategyClientId}
          refreshSignal={roadmapRefreshSignal}
          fetchImpl={fetchImpl}
        />
      )}

      {strategy && projectId && strategyClientId && localStrategyStatus && (
        <StrategyCard
          projectId={projectId}
          clientId={strategyClientId}
          strategy={strategy}
          strategyStatus={localStrategyStatus}
          fetchImpl={fetchImpl}
          onApproved={() => setLocalStrategyStatus("approved")}
        />
      )}

      <BriefCard brief={brief} />

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {mode === "draft" ? (
          editing ? (
            // The operator edits the markdown source directly; Save re-gates it.
            <MarkdownEditor body={body} streaming={false} onLocalEdit={setDraftText} />
          ) : (
            <DraftPaper body={body} streaming={streaming} />
          )
        ) : (
          <PreviewFrame
            brief={brief}
            body={body}
            hubBlogSlug={hubBlogSlug}
            hubMode={mode === "hub"}
          />
        )}

        {/* In-place edit history — each row is a re-gated saved version. */}
        {mode === "draft" && !editing && edits.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 10.5,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--muted-2)",
              }}
            >
              Edit history
            </p>
            <ActivityFeed edits={edits} />
          </div>
        )}
      </div>

      {/* Edit footer — Save & re-check / Cancel, with a plain error reason. */}
      {mode === "draft" && editing && (
        <div
          data-testid="artifact-edit-footer"
          style={{ display: "flex", alignItems: "center", gap: 10, borderTop: "1px solid var(--line)", paddingTop: 10 }}
        >
          <button
            type="button"
            data-testid="artifact-save-edit"
            disabled={saving}
            onClick={saveEdit}
            style={{
              ...TOOLBTN,
              color: "#06121f",
              background: "var(--accent-blue)",
              border: "1px solid var(--accent-blue)",
              fontWeight: 600,
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Re-checking…" : "Save & re-check"}
          </button>
          <button type="button" data-testid="artifact-cancel-edit" disabled={saving} style={TOOLBTN} onClick={cancelEditing}>
            Cancel
          </button>
          {saveError && (
            <span data-testid="artifact-save-error" style={{ fontSize: 12, color: "var(--accent-red)" }}>
              {saveError}
            </span>
          )}
          {!saveError && (
            <span style={{ fontSize: 11, color: "var(--muted)" }}>Saving snapshots a new version and re-runs the gate.</span>
          )}
        </div>
      )}

      {/* The live-stream footer — the gate re-runs once the draft settles. */}
      {streaming && mode === "draft" && (
        <div
          data-testid="artifact-streaming-footer"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            color: "var(--accent-blue)",
            borderTop: "1px solid var(--line)",
            paddingTop: 10,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--accent-blue)",
              animation: "studio-pulse 1.2s ease-in-out infinite",
            }}
          />
          streaming — the gate re-runs when the draft settles
        </div>
      )}
    </div>
  );
}

export default ArtifactZone;
