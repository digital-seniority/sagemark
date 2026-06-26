"use client";

/**
 * VersionDiff — a READS-ONLY line diff between two content-piece versions
 * (P1.U.4 / PR 013).
 *
 * The compare half of the version hub: given two append-only versions (PR 012 /
 * `content_piece_versions`) it renders a line-level diff so the operator can SEE
 * what changed between, say, an earlier draft and the named sign-off. It is PURELY
 * PRESENTATIONAL + READ-ONLY — it computes the diff over the two bodies in render
 * and never writes, switches, names, or mutates anything. (Switch/name live in the
 * /api/versions route + VersionHub; compare touches nothing.)
 *
 * The diff is a minimal LCS line diff (no dependency) — deterministic, so the DOM
 * test can assert added/removed lines. Colour from `currentColor` + opacity, no
 * hardcoded palette (the studio convention); add/remove carry a `data-diff` attr a
 * later themed build can map to accent tokens. Clean ASCII / UTF-8.
 */

export type DiffLineKind = "context" | "added" | "removed";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/**
 * Compute a minimal line-level diff (LCS) between two bodies. Pure + exported so
 * the DOM test asserts the diff lines directly. Read-only — no side effects.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "context", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: "removed", text: a[i]! });
      i++;
    } else {
      out.push({ kind: "added", text: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ kind: "removed", text: a[i++]! });
  while (j < m) out.push({ kind: "added", text: b[j++]! });
  return out;
}

const SUBTLE: React.CSSProperties = { opacity: 0.6, fontSize: 12 };

const KIND_PREFIX: Record<DiffLineKind, string> = {
  context: " ",
  added: "+",
  removed: "-",
};

const KIND_OPACITY: Record<DiffLineKind, number> = {
  context: 0.55,
  added: 1,
  removed: 0.85,
};

export interface VersionDiffProps {
  /** The "from" version label (e.g. "v1"). */
  beforeLabel: string;
  /** The "to" version label (e.g. "v3 · sign-off"). */
  afterLabel: string;
  /** The earlier version body. */
  before: string;
  /** The later version body. */
  after: string;
}

export function VersionDiff({ beforeLabel, afterLabel, before, after }: VersionDiffProps) {
  const lines = diffLines(before, after);
  const added = lines.filter((l) => l.kind === "added").length;
  const removed = lines.filter((l) => l.kind === "removed").length;

  return (
    <div
      data-testid="version-diff"
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <header
        style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}
      >
        <span style={{ ...SUBTLE, fontWeight: 600 }}>
          {beforeLabel} <span style={{ opacity: 0.4 }}>&rarr;</span> {afterLabel}
        </span>
        <span data-testid="version-diff-stat" style={{ ...SUBTLE, fontSize: 11 }}>
          <span data-testid="version-diff-added">+{added}</span>{" "}
          <span data-testid="version-diff-removed">&minus;{removed}</span>
        </span>
      </header>

      {added === 0 && removed === 0 ? (
        <p data-testid="version-diff-identical" style={{ ...SUBTLE, fontSize: 12, margin: 0 }}>
          These two versions are identical.
        </p>
      ) : (
        <pre
          data-testid="version-diff-body"
          style={{
            margin: 0,
            padding: "0.5rem 0.625rem",
            border: "1px solid currentColor",
            borderRadius: 8,
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            background: "color-mix(in srgb, currentColor 4%, transparent)",
          }}
        >
          {lines.map((l, idx) => (
            <span
              key={`diff:${idx}`}
              data-testid="version-diff-line"
              data-diff={l.kind}
              style={{ display: "block", opacity: KIND_OPACITY[l.kind] }}
            >
              {KIND_PREFIX[l.kind]} {l.text}
            </span>
          ))}
        </pre>
      )}
    </div>
  );
}

export default VersionDiff;
