"use client";

/**
 * VersionHub — switch / name / compare a piece's append-only versions
 * (P1.U.4 / PR 013).
 *
 * Mounts in the Inspector (PR 011 / P1.U.2). It surfaces the append-only
 * `content_piece_versions` history (PR 012 / P1.U.3) and lets the operator:
 *
 *   - SWITCH  the active/displayed version (a pointer update via `onSwitch` ->
 *     `/api/versions/[id]` op=switch). It NEVER destroys other versions.
 *   - NAME    a version, esp. the recorded human-release SIGN-OFF (via `onName` ->
 *     op=name). Append-only metadata.
 *   - COMPARE any two versions (VersionDiff — reads only).
 *
 * THE UNDELETABLE NAMED SIGN-OFF. A named sign-off version is the recorded
 * human-release marker. There is NO delete affordance anywhere in this hub (the
 * history is append-only; the route exposes no delete path) and a sign-off row is
 * rendered with a locked badge + its name/sign-off controls disabled — its name
 * can never be overwritten (the route rejects it 409 signoff-immutable). This UI
 * has no path to delete or re-name a sign-off.
 *
 * Presentational shell: it reads an already-fetched `versions` projection + invokes
 * injected async callbacks for the server actions (so it is fully DOM-testable with
 * no live route). Colour from `currentColor` + opacity; verdict via the shared
 * ScoreSignalDot. Clean ASCII / UTF-8.
 */

import { useState } from "react";
import { ScoreSignalDot, type GateVerdict } from "@/components/ScoreSignalDot";
import { VersionDiff } from "./VersionDiff";

/** One version row the hub renders (the wire shape from /api/versions GET). */
export interface HubVersion {
  id: string;
  version: number;
  body: string;
  verdict: GateVerdict | string | null;
  snapshotAt: string;
  name: string | null;
  isActive: boolean;
  isSignoff: boolean;
}

export interface VersionHubProps {
  /** The append-only version history (any order; the hub sorts by version). */
  versions: HubVersion[];
  /** Switch the active/displayed version (op=switch). Pointer update; never destroys. */
  onSwitch?: (version: number) => void | Promise<void>;
  /** Name a version; `asSignoff` marks the undeletable sign-off (op=name). */
  onName?: (version: number, name: string, asSignoff: boolean) => void | Promise<void>;
}

const SUBTLE: React.CSSProperties = { opacity: 0.6, fontSize: 12 };

function label(v: HubVersion): string {
  const parts = [`v${v.version}`];
  if (v.name) parts.push(v.name);
  if (v.isSignoff) parts.push("sign-off");
  return parts.join(" · ");
}

export function VersionHub({ versions, onSwitch, onName }: VersionHubProps) {
  const sorted = versions.slice().sort((a, b) => a.version - b.version);

  // Compare selection: default to (earliest, latest) when 2+ versions exist.
  const [compareFrom, setCompareFrom] = useState<number | null>(
    sorted.length >= 2 ? sorted[0]!.version : null,
  );
  const [compareTo, setCompareTo] = useState<number | null>(
    sorted.length >= 2 ? sorted[sorted.length - 1]!.version : null,
  );
  // Inline name editor: which version is being named, and the draft text.
  const [namingVersion, setNamingVersion] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  if (sorted.length === 0) {
    return (
      <div data-testid="version-hub" data-zone-body="version-hub">
        <p data-testid="version-hub-empty" style={{ ...SUBTLE, fontSize: 13, margin: 0 }}>
          No versions yet. Each gated edit appends a version here.
        </p>
      </div>
    );
  }

  const before = sorted.find((v) => v.version === compareFrom);
  const after = sorted.find((v) => v.version === compareTo);

  return (
    <div
      data-testid="version-hub"
      data-zone-body="version-hub"
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <p style={{ textTransform: "uppercase", letterSpacing: "0.1em", ...SUBTLE }}>Versions</p>
        <span style={{ ...SUBTLE, fontSize: 11 }}>{sorted.length} total · append-only</span>
      </header>

      {/* ── Version list (switch + name) ──────────────────────────────────── */}
      <ol
        data-testid="version-list"
        aria-label="Version history"
        style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}
      >
        {sorted.map((v) => (
          <li
            key={v.id}
            data-testid="version-row"
            data-version={v.version}
            data-active={v.isActive ? "true" : "false"}
            data-signoff={v.isSignoff ? "true" : "false"}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: "0.5rem 0.625rem",
              border: "1px solid currentColor",
              borderRadius: 8,
              opacity: v.isActive ? 1 : 0.85,
              background: v.isActive
                ? "color-mix(in srgb, currentColor 8%, transparent)"
                : "transparent",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span data-testid="version-label" style={{ fontWeight: 600, fontSize: 13 }}>
                  {label(v)}
                </span>
                {v.isSignoff && (
                  <span
                    data-testid="version-signoff-badge"
                    title="Named sign-off — the recorded human-release marker. Undeletable + immutable."
                    aria-label="Named sign-off: undeletable"
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      padding: "1px 6px",
                      borderRadius: 999,
                      border: "1px solid currentColor",
                      opacity: 0.85,
                    }}
                  >
                    LOCKED
                  </span>
                )}
              </span>
              <ScoreSignalDot verdict={v.verdict ?? null} />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                data-testid="version-switch"
                disabled={v.isActive}
                onClick={() => onSwitch?.(v.version)}
                style={btnStyle(v.isActive)}
              >
                {v.isActive ? "Active" : "Switch to this"}
              </button>

              {/* NAME — a sign-off is immutable: no name affordance on it at all. */}
              {!v.isSignoff &&
                (namingVersion === v.version ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <input
                      data-testid="version-name-input"
                      aria-label={`Name version ${v.version}`}
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      placeholder="e.g. client sign-off"
                      style={{
                        fontSize: 12,
                        padding: "2px 6px",
                        borderRadius: 6,
                        border: "1px solid currentColor",
                        background: "transparent",
                        color: "inherit",
                      }}
                    />
                    <label
                      style={{ ...SUBTLE, fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}
                    >
                      <input
                        type="checkbox"
                        data-testid="version-name-signoff"
                        id={`signoff-${v.version}`}
                      />
                      sign-off
                    </label>
                    <button
                      type="button"
                      data-testid="version-name-save"
                      disabled={nameDraft.trim().length === 0}
                      onClick={() => {
                        const asSignoff =
                          (document.getElementById(`signoff-${v.version}`) as HTMLInputElement | null)
                            ?.checked ?? false;
                        void onName?.(v.version, nameDraft.trim(), asSignoff);
                        setNamingVersion(null);
                        setNameDraft("");
                      }}
                      style={btnStyle(nameDraft.trim().length === 0)}
                    >
                      Save
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    data-testid="version-name-open"
                    onClick={() => {
                      setNamingVersion(v.version);
                      setNameDraft(v.name ?? "");
                    }}
                    style={btnStyle(false)}
                  >
                    {v.name ? "Rename" : "Name"}
                  </button>
                ))}
            </div>
          </li>
        ))}
      </ol>

      {/* ── Compare (VersionDiff — reads only) ────────────────────────────── */}
      {sorted.length >= 2 && (
        <section data-testid="version-compare" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ ...SUBTLE, textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 11 }}>
              Compare
            </span>
            <select
              data-testid="compare-from"
              aria-label="Compare from version"
              value={compareFrom ?? ""}
              onChange={(e) => setCompareFrom(Number(e.target.value))}
              style={selectStyle}
            >
              {sorted.map((v) => (
                <option key={`from:${v.id}`} value={v.version}>
                  {label(v)}
                </option>
              ))}
            </select>
            <span style={{ opacity: 0.4 }}>&rarr;</span>
            <select
              data-testid="compare-to"
              aria-label="Compare to version"
              value={compareTo ?? ""}
              onChange={(e) => setCompareTo(Number(e.target.value))}
              style={selectStyle}
            >
              {sorted.map((v) => (
                <option key={`to:${v.id}`} value={v.version}>
                  {label(v)}
                </option>
              ))}
            </select>
          </div>

          {before && after && (
            <VersionDiff
              beforeLabel={label(before)}
              afterLabel={label(after)}
              before={before.body}
              after={after.body}
            />
          )}
        </section>
      )}
    </div>
  );
}

function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.02em",
    padding: "3px 10px",
    borderRadius: 999,
    border: "1px solid currentColor",
    background: "transparent",
    color: "inherit",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 0.85,
  };
}

const selectStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "2px 6px",
  borderRadius: 6,
  border: "1px solid currentColor",
  background: "transparent",
  color: "inherit",
};

export default VersionHub;
