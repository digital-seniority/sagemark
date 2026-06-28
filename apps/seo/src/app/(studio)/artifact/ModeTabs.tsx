"use client";

/**
 * ModeTabs — the artifact-zone view switcher (PR 010 / P1.U.1).
 *
 * Replaces videogen's preview/scenes/renders tabs with the markdown content_piece's
 * two operator views:
 *   - "draft"   — the live/persisted markdown body (the default working view),
 *   - "preview" — the rendered-prose reading view (PR 011/013 fill the renderer;
 *                 the shell shows a clearly-marked placeholder).
 *
 * A controlled tablist (ARIA `tablist`/`tab`) — the parent `ArtifactZone` owns the
 * active mode. Colour from `currentColor` + opacity. Clean ASCII / UTF-8.
 */

export const ARTIFACT_MODES = ["draft", "preview", "hub"] as const;
export type ArtifactMode = (typeof ARTIFACT_MODES)[number];

const MODE_LABEL: Record<ArtifactMode, string> = {
  draft: "Draft",
  preview: "Preview",
  hub: "Hub",
};

export interface ModeTabsProps {
  active: ArtifactMode;
  onChange: (mode: ArtifactMode) => void;
  /** When false, the "hub" tab is hidden (only shown for hub projects). */
  hubEnabled?: boolean;
}

export function ModeTabs({ active, onChange, hubEnabled = false }: ModeTabsProps) {
  const visibleModes = ARTIFACT_MODES.filter((m) => m !== "hub" || hubEnabled);
  return (
    <div
      role="tablist"
      aria-label="Artifact view"
      data-testid="mode-tabs"
      style={{ display: "inline-flex", gap: 2 }}
    >
      {visibleModes.map((mode) => {
        const selected = mode === active;
        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={selected}
            data-mode={mode}
            data-active={selected ? "true" : "false"}
            onClick={() => onChange(mode)}
            style={{
              appearance: "none",
              border: "none",
              cursor: "pointer",
              font: "inherit",
              fontSize: 12.5,
              fontWeight: 600,
              padding: "6px 10px",
              // An underline tab (mock): the active view is marked by an accent
              // bottom border, the rest read muted.
              borderBottom: selected
                ? "2px solid var(--accent-blue)"
                : "2px solid transparent",
              borderRadius: 0,
              background: "transparent",
              color: selected ? "var(--foreground)" : "var(--muted)",
            }}
          >
            {MODE_LABEL[mode]}
          </button>
        );
      })}
    </div>
  );
}

export default ModeTabs;
