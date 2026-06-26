"use client";

/**
 * VoiceSpecEditor — the brand-voice spec editor with the `approved_at IS NULL`
 * HARD STOP (PR 009).
 *
 * THE HARD STOP (acceptance 1). A client's voice spec is the prerequisite for
 * creating any content piece. A spec whose `approved_at IS NULL` is a DRAFT spec
 * — it does NOT unlock composition. When no APPROVED spec exists, the editor:
 *   - shows an explicit "no approved voice spec" reason (never a silent default),
 *   - DISABLES the "create a piece" / composer affordance (`canCompose === false`),
 *   - offers ONLY the approve action.
 * There is NO default-voice fallback: the pipeline refuses piece creation until an
 * operator approves a spec. This mirrors the server-side draft-route hard stop
 * (`/content/api/draft` returns 409 `no-approved-voice-spec`) — the UI must not
 * paper over it by enabling the composer when the server would refuse.
 *
 * The component is presentational + state-only (no DB): the parent Server
 * Component resolves the spec (`approvedAt`) and passes it in; the editor renders
 * the gate. Colors/fonts come from the globals.css `--background`/`--foreground`
 * tokens via `currentColor` + opacity (no hardcoded palette).
 */

import { useState } from "react";

/** A byline author entry (voice_specs.spec.authors[]). */
export interface VoiceAuthorDraft {
  id?: string;
  name: string;
  credentials: string;
}

/** The editable voice-spec fields the editor surfaces. */
export interface VoiceSpecDraft {
  tone: string;
  audience: string;
  bannedLexicon: string;
  authors: VoiceAuthorDraft[];
}

export interface VoiceSpecEditorProps {
  clientId: string;
  /**
   * The spec's `approved_at` (ISO) or null. NULL ⇒ the hard stop: composition is
   * refused until an operator approves. This is read from the persisted row, never
   * assumed.
   */
  approvedAt: string | null;
  /** The current (possibly draft) spec fields. */
  initial?: Partial<VoiceSpecDraft>;
  /** Persist-the-spec callback (wired by the parent to the data layer). */
  onSave?: (draft: VoiceSpecDraft) => Promise<void> | void;
  /** Approve-the-spec callback — the only action that lifts the hard stop. */
  onApprove?: () => Promise<void> | void;
}

/** True iff the spec is APPROVED (a non-null, non-empty approvedAt). */
export function isVoiceSpecApproved(approvedAt: string | null | undefined): boolean {
  return typeof approvedAt === "string" && approvedAt.trim().length > 0;
}

const SUBTLE: React.CSSProperties = { opacity: 0.6, fontSize: 13 };
const FIELD: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid currentColor",
  borderRadius: 6,
  background: "transparent",
  color: "inherit",
  font: "inherit",
};

export function VoiceSpecEditor(props: VoiceSpecEditorProps) {
  const { clientId, approvedAt, initial, onSave, onApprove } = props;
  const approved = isVoiceSpecApproved(approvedAt);
  // The HARD STOP: composition is unlocked ONLY by an approved spec. Never
  // default-true; an unknown/null approvedAt fails closed to "cannot compose".
  const canCompose = approved;

  const [draft, setDraft] = useState<VoiceSpecDraft>({
    tone: initial?.tone ?? "",
    audience: initial?.audience ?? "",
    bannedLexicon: initial?.bannedLexicon ?? "",
    authors: initial?.authors ?? [{ name: "", credentials: "" }],
  });
  const [busy, setBusy] = useState(false);

  function update<K extends keyof VoiceSpecDraft>(key: K, value: VoiceSpecDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function handleApprove() {
    if (!onApprove) return;
    setBusy(true);
    try {
      await onApprove();
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!onSave) return;
    setBusy(true);
    try {
      await onSave(draft);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Voice spec editor"
      data-can-compose={canCompose ? "true" : "false"}
      style={{ maxWidth: 640, margin: "0 auto", padding: "2rem 1.5rem" }}
    >
      <p style={{ textTransform: "uppercase", letterSpacing: "0.1em", ...SUBTLE }}>
        Brand voice
      </p>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>Voice spec</h1>
      <p style={SUBTLE}>Client {clientId}</p>

      {/* THE HARD STOP banner — explicit, never silent. */}
      {!approved && (
        <div
          role="alert"
          data-testid="no-approved-voice-spec"
          style={{
            marginTop: 20,
            padding: "0.875rem 1rem",
            border: "1px solid currentColor",
            borderRadius: 8,
            background: "color-mix(in srgb, currentColor 8%, transparent)",
          }}
        >
          <strong>No approved voice spec.</strong>{" "}
          Piece creation is refused until you approve a spec. There is no
          default-voice fallback — approve a spec to unlock composition.
        </div>
      )}

      <div style={{ display: "grid", gap: 16, marginTop: 24 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={SUBTLE}>Tone</span>
          <input
            style={FIELD}
            value={draft.tone}
            onChange={(e) => update("tone", e.target.value)}
            placeholder="authoritative, warm, plain-spoken"
          />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={SUBTLE}>Audience</span>
          <input
            style={FIELD}
            value={draft.audience}
            onChange={(e) => update("audience", e.target.value)}
            placeholder="adult children of aging parents"
          />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={SUBTLE}>Banned lexicon (comma-separated)</span>
          <input
            style={FIELD}
            value={draft.bannedLexicon}
            onChange={(e) => update("bannedLexicon", e.target.value)}
            placeholder="cure, guaranteed, miracle"
          />
        </label>

        <fieldset style={{ border: "1px solid currentColor", borderRadius: 8, padding: "0.875rem 1rem" }}>
          <legend style={SUBTLE}>Byline author</legend>
          <div style={{ display: "grid", gap: 8 }}>
            <input
              style={FIELD}
              value={draft.authors[0]?.name ?? ""}
              onChange={(e) =>
                update("authors", [
                  { ...(draft.authors[0] ?? { name: "", credentials: "" }), name: e.target.value },
                  ...draft.authors.slice(1),
                ])
              }
              placeholder="Dr. Jane Roe"
              aria-label="Author name"
            />
            <input
              style={FIELD}
              value={draft.authors[0]?.credentials ?? ""}
              onChange={(e) =>
                update("authors", [
                  { ...(draft.authors[0] ?? { name: "", credentials: "" }), credentials: e.target.value },
                  ...draft.authors.slice(1),
                ])
              }
              placeholder="RN, CDP"
              aria-label="Author credentials"
            />
          </div>
        </fieldset>
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 24, alignItems: "center" }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={busy || !onSave}
          style={{ ...FIELD, width: "auto", cursor: "pointer" }}
        >
          Save spec
        </button>
        {!approved && (
          <button
            type="button"
            onClick={handleApprove}
            disabled={busy || !onApprove}
            style={{ ...FIELD, width: "auto", cursor: "pointer", fontWeight: 600 }}
          >
            Approve spec
          </button>
        )}
        {/* The composer affordance — DISABLED while the hard stop is active. */}
        <button
          type="button"
          data-testid="create-piece"
          disabled={!canCompose}
          aria-disabled={!canCompose}
          title={canCompose ? "Create a piece" : "Approve a voice spec first"}
          style={{
            ...FIELD,
            width: "auto",
            cursor: canCompose ? "pointer" : "not-allowed",
            opacity: canCompose ? 1 : 0.4,
            marginLeft: "auto",
          }}
        >
          Create a piece
        </button>
      </div>

      {approved && (
        <p style={{ ...SUBTLE, marginTop: 12 }}>
          Approved {approvedAt} — composition unlocked.
        </p>
      )}
    </section>
  );
}

export default VoiceSpecEditor;
