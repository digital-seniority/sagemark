/**
 * build-project-context — assemble the cross-article context a new run inherits
 * when its conversation belongs to a Project (studio UX overhaul, Slice 5).
 *
 * THE HYBRID MECHANISM (the operator's chosen design): the context the worker
 * receives is the operator's editable project BRIEF (a narrative) PLUS an
 * auto-assembled FACT LIST of the articles already in the project (title, role,
 * funnel stage, keyword, a short excerpt). No model call — the facts come straight
 * from the persisted pieces; the brief is whatever the operator wrote. The result
 * is a plain-language note the turn composer fences as DATA and hands the worker,
 * so a new spoke keeps continuity with the cluster, reuses the keyword map, and
 * does not re-cover ground already written.
 *
 * PURE + deterministic: no I/O, no Date, no model. Bounded in size (the composer
 * also clamps the whole brief). Clean ASCII / UTF-8.
 */

/** One prior article in the project, projected to the facts the context needs. */
export interface ProjectContextPiece {
  title: string;
  slug: string;
  /** pillar | cornerstone | spoke | faq | checklist (when known). */
  clusterRole?: string | null;
  /** awareness | consideration | decision | retention (when known). */
  funnelStage?: string | null;
  /** The piece's primary keyword (from its brief snapshot), when known. */
  primaryKeyword?: string | null;
  /** A short excerpt / meta description, when known. */
  excerpt?: string | null;
}

export interface ProjectContextInput {
  /** The project name (framing). */
  projectName: string;
  /** The operator-editable project brief (narrative guidance), if any. */
  brief?: string | null;
  /** The articles already in the project (most-recent first is fine). */
  pieces: ProjectContextPiece[];
}

export interface BuildProjectContextOptions {
  /** Max prior articles to list (most-recent first). Default 12. */
  maxPieces?: number;
  /** Max excerpt chars per article. Default 140. */
  maxExcerpt?: number;
  /** Overall character budget for the note. Default 3000. */
  maxChars?: number;
}

const DEFAULTS: Required<BuildProjectContextOptions> = {
  maxPieces: 12,
  maxExcerpt: 140,
  maxChars: 3000,
};

function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}

/** A compact `[role · stage · keyword]` tag for a prior article (omits blanks). */
function pieceTag(p: ProjectContextPiece): string {
  const parts = [p.clusterRole, p.funnelStage, p.primaryKeyword].filter(
    (x): x is string => typeof x === "string" && x.trim().length > 0,
  );
  return parts.length ? ` [${parts.join(" · ")}]` : "";
}

/**
 * Build the project-context note, or `null` when there is nothing to carry (no
 * brief AND no prior pieces — a brand-new empty project adds no context). The note
 * is plain prose; the turn composer wraps it in a fenced DATA block.
 */
export function buildProjectContext(
  input: ProjectContextInput,
  options: BuildProjectContextOptions = {},
): string | null {
  const opts = { ...DEFAULTS, ...options };
  const brief = (input.brief ?? "").trim();
  const pieces = input.pieces.slice(0, opts.maxPieces);

  if (!brief && pieces.length === 0) return null;

  const lines: string[] = [];
  lines.push(
    `This article belongs to the project "${input.projectName.trim() || "Untitled project"}". ` +
      "Keep continuity with the work already done in this project: match the established angle " +
      "and voice, reuse the keyword map, link to related pieces where natural, and do NOT " +
      "re-cover ground the articles below already handle.",
  );

  if (brief) {
    lines.push("", "Project brief (the operator's guidance):", brief);
  }

  if (pieces.length > 0) {
    lines.push("", "Articles already in this project:");
    for (const p of pieces) {
      const title = truncate(p.title || p.slug || "Untitled", 120);
      const excerpt = p.excerpt ? ` — ${truncate(p.excerpt, opts.maxExcerpt)}` : "";
      lines.push(`- "${title}"${pieceTag(p)}${excerpt}`);
    }
  }

  let note = lines.join("\n");
  if (note.length > opts.maxChars) {
    note = note.slice(0, opts.maxChars - 1).trimEnd() + "…";
  }
  return note;
}
