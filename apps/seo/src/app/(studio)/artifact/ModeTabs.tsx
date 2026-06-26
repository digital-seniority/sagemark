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

export const ARTIFACT_MODES = ["draft", "preview"] as const;
export type ArtifactMode = (typeof ARTIFACT_MODES)[number];

const MODE_LABEL: Record<ArtifactMode, string> = {
  draft: "Draft",
  preview: "Preview",
};

export interface ModeTabsProps {
  active: ArtifactMode;
  onChange: (mode: ArtifactMode) => void;
}

export function ModeTabs({ active, onChange }: ModeTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Artifact view"
      data-testid="mode-tabs"
      style={{ display: "inline-flex", gap: 4, border: "1px solid currentColor", borderRadius: 8, padding: 2 }}
    >
      {ARTIFACT_MODES.map((mode) => {
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
              fontSize: 12,
              fontWeight: 600,
              padding: "4px 12px",
              borderRadius: 6,
              color: "inherit",
              background: selected
                ? "color-mix(in srgb, currentColor 12%, transparent)"
                : "transparent",
              opacity: selected ? 1 : 0.55,
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
