"use client";

/**
 * StudioWelcome — the first-run guidance state of the agent chat zone (Slice 2,
 * the dark-canvas overhaul).
 *
 * Replaces the bare "No turns yet" / "Waiting for the agent..." strings on a fresh
 * conversation with a warm, plain-language invitation: what the operator types, and
 * three one-click example briefs that dispatch a turn immediately (onPick ->
 * the lifted useTurnStream.sendTurn). It renders ONLY when the conversation is
 * truly empty (no prior turns, no live feed) — AgentPanel owns that condition.
 *
 * VOICE-SPEC HARD STOP (Bible). When the bound client has no approved voice spec,
 * generation is blocked: pass `blockedReason` and the welcome shows the fail-closed
 * reason instead of the prompt examples (no "generate anyway" affordance). The
 * wiring of the real voice-spec status is surfaced by the canvas page; until then
 * the prop is simply absent and the guidance shows.
 *
 * Presentational + one onPick callback. Dark tokens, no hardcoded palette beyond
 * the accent vars. Clean ASCII / UTF-8.
 */

/** Example briefs that seed a first turn (Whispering Willows / memory-care context). */
const EXAMPLES: ReadonlyArray<{ short: string; prompt: string }> = [
  {
    short: "Early signs of dementia",
    prompt:
      "Draft a spoke on the early signs of dementia for our hub. Decision stage, warm and reassuring — gently point families toward touring a community.",
  },
  {
    short: "Choosing a memory care community",
    prompt:
      "Write a decision-stage guide on how families choose a memory care community, in our warm, non-institutional voice.",
  },
  {
    short: "Memory care costs FAQ",
    prompt:
      "Create an FAQ on memory care costs in Skagit County — clear, sourced answers families can trust.",
  },
];

export interface StudioWelcomeProps {
  /** Dispatch a first turn from a picked example (the lifted sendTurn). */
  onPick: (prompt: string) => void | Promise<void>;
  /**
   * When set, the client has no approved voice spec — generation is blocked and
   * this fail-closed reason shows instead of the examples (Bible hard stop).
   */
  blockedReason?: string | null;
}

export function StudioWelcome({ onPick, blockedReason = null }: StudioWelcomeProps) {
  if (blockedReason) {
    return (
      <div
        data-testid="studio-welcome-blocked"
        data-anim="fade-up"
        style={{
          border: "1px solid color-mix(in srgb, var(--accent-amber) 40%, var(--line))",
          background: "color-mix(in srgb, var(--accent-amber) 9%, transparent)",
          borderRadius: 12,
          padding: "1rem 1.1rem",
          animation: "studio-fade-up 0.35s ease both",
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: "var(--accent-amber)" }}>
          Generation is paused
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)", lineHeight: 1.55 }}>
          {blockedReason}
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="studio-welcome"
      data-anim="fade-up"
      style={{ display: "flex", flexDirection: "column", gap: 14, animation: "studio-fade-up 0.4s ease both" }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          background: "color-mix(in srgb, var(--accent-purple) 22%, transparent)",
          border: "1px solid color-mix(in srgb, var(--accent-purple) 45%, var(--line))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 15,
        }}
      >
        ✦
      </div>

      <div>
        <p style={{ margin: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.3 }}>
          What should we write?
        </p>
        <p style={{ margin: "7px 0 0", fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          Describe the piece you want in your own words. I&rsquo;ll research live sources,
          draft it in your approved voice as you watch, and grade it against the quality
          gate — every step shows here.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <p
          style={{
            margin: 0,
            fontSize: 10.5,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--muted-2)",
          }}
        >
          Try one to start
        </p>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.short}
            type="button"
            data-testid="studio-welcome-example"
            onClick={() => onPick(ex.prompt)}
            style={{
              appearance: "none",
              cursor: "pointer",
              textAlign: "left",
              font: "inherit",
              fontSize: 13,
              color: "var(--foreground)",
              border: "1px solid var(--line)",
              background: "var(--panel-2)",
              borderRadius: 10,
              padding: "9px 11px",
              display: "flex",
              alignItems: "center",
              gap: 9,
            }}
          >
            <span aria-hidden="true" style={{ color: "var(--accent-blue)", fontSize: 14 }}>
              ↗
            </span>
            {ex.short}
          </button>
        ))}
      </div>
    </div>
  );
}

export default StudioWelcome;
