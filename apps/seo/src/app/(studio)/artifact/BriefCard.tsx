/**
 * BriefCard — the content-piece brief summary at the top of the artifact zone
 * (PR 010 / P1.U.1).
 *
 * Adapts videogen's brief card to a markdown content_piece: instead of a video
 * brief it surfaces the SEO piece's working title, target slug, primary keyword,
 * funnel stage, and YMYL flag — the at-a-glance "what is this run producing"
 * context the operator needs above the body. Purely presentational; the parent
 * passes a resolved `brief` (a content_pieces projection), or null before a run
 * has a brief.
 *
 * Colour from `currentColor` + opacity (no hardcoded palette). Clean ASCII / UTF-8.
 */

/** The brief projection the card renders (a content_pieces / brief row subset). */
export interface ContentBrief {
  title: string;
  slug: string;
  /** The primary target keyword for the piece. */
  primaryKeyword?: string | null;
  /** The funnel stage (TOFU / MOFU / BOFU), if assigned. */
  funnelStage?: string | null;
  /** Whether this is a Your-Money-Your-Life piece (stricter gate). */
  isYmyl?: boolean;
}

export interface BriefCardProps {
  brief: ContentBrief | null;
}

const SUBTLE: React.CSSProperties = { opacity: 0.6, fontSize: 13 };

export function BriefCard({ brief }: BriefCardProps) {
  if (!brief) {
    return (
      <div
        data-testid="brief-card-empty"
        style={{
          border: "1px solid currentColor",
          borderRadius: 10,
          padding: "0.875rem 1rem",
          ...SUBTLE,
        }}
      >
        No brief yet — the run has not produced a content brief.
      </div>
    );
  }

  return (
    <section
      aria-label="Content brief"
      data-testid="brief-card"
      style={{ border: "1px solid currentColor", borderRadius: 10, padding: "0.875rem 1rem" }}
    >
      <p style={{ textTransform: "uppercase", letterSpacing: "0.1em", ...SUBTLE }}>
        Brief
        {brief.isYmyl ? " · YMYL" : ""}
      </p>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "6px 0 2px" }}>{brief.title}</h2>
      <p style={SUBTLE}>/{brief.slug}</p>

      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "4px 12px",
          marginTop: 10,
          fontSize: 13,
        }}
      >
        <dt style={SUBTLE}>Primary keyword</dt>
        <dd data-testid="brief-keyword">{brief.primaryKeyword || "—"}</dd>
        <dt style={SUBTLE}>Funnel stage</dt>
        <dd data-testid="brief-funnel">{brief.funnelStage || "—"}</dd>
      </dl>
    </section>
  );
}

export default BriefCard;
