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

/** A compact roadmap item for context injection (avoids importing the full schema module). */
export interface ProjectContextRoadmapItem {
  slug: string;
  title: string;
  clusterRole: string;
  funnelStage?: string | null;
  primaryKeyword?: string | null;
}

/** An approved ContentStrategy reduced to the fields the context builder needs. */
export interface ProjectContextStrategy {
  objective?: string | null;
  audience?: string | null;
  gapAnalysis?: string | null;
  eeatPlan?: string | null;
  conversionArchitecture?: string | null;
  roadmap: ProjectContextRoadmapItem[];
}

export interface ProjectContextInput {
  /** The project name (framing). */
  projectName: string;
  /** The operator-editable project brief (narrative guidance), if any. */
  brief?: string | null;
  /** The articles already in the project (most-recent first is fine). */
  pieces: ProjectContextPiece[];
  /** The approved hub ContentStrategy (hub authoring only). */
  strategy?: ProjectContextStrategy | null;
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

  // Inject the approved hub strategy so the worker knows the full roadmap,
  // E-E-A-T plan, and conversion architecture for this cluster.
  const strategy = input.strategy;
  if (strategy) {
    lines.push("", "Approved hub content strategy:");
    if (strategy.objective) lines.push(`Objective: ${truncate(strategy.objective, 300)}`);
    if (strategy.audience) lines.push(`Audience: ${truncate(strategy.audience, 300)}`);
    if (strategy.gapAnalysis) lines.push(`Gap analysis: ${truncate(strategy.gapAnalysis, 400)}`);
    if (strategy.eeatPlan) lines.push(`E-E-A-T plan: ${truncate(strategy.eeatPlan, 400)}`);
    if (strategy.conversionArchitecture) {
      lines.push(`Conversion architecture: ${truncate(strategy.conversionArchitecture, 300)}`);
    }
    if (strategy.roadmap.length > 0) {
      lines.push("", "Full hub roadmap (write only your assigned page):");
      for (const item of strategy.roadmap) {
        const tag = [item.clusterRole, item.funnelStage, item.primaryKeyword]
          .filter(Boolean)
          .join(" · ");
        lines.push(`- [${item.slug}] "${item.title}"${tag ? ` [${tag}]` : ""}`);
      }
    }
  }

  if (pieces.length > 0) {
    lines.push("", "Articles already authored in this project:");
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
