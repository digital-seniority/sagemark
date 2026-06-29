"use client";

/**
 * RunWarmup — the "the run is alive" indicator (S2). Replaces the static
 * "Waiting for the agent to start the run..." during the 30–60s before the first
 * stream event arrives (sandbox boot + skill load), so the operator never faces a
 * dead box. It shows the run's lifecycle stages and advances an honest, time-based
 * estimate of the current stage (the stages DO happen in this order); it never
 * claims a stage is "complete". The moment real feed events arrive, AgentMessageStream
 * renders those instead and this unmounts.
 *
 * Presentational + a single advancing timer. Dark tokens, clean ASCII / UTF-8.
 */

import { useEffect, useState } from "react";

const STAGES: ReadonlyArray<{ label: string; hint: string }> = [
  { label: "Booting the secure sandbox", hint: "an isolated VM, per run" },
  { label: "Loading the SEO skill", hint: "your copywriting playbook" },
  { label: "Researching live sources", hint: "gathering citable facts" },
  { label: "Drafting your page", hint: "writing in your approved voice" },
];

/** Approx ms before the highlighted stage advances (boot is the long pole). */
const ADVANCE_MS = [26000, 11000, 15000];

export function RunWarmup() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (stage >= STAGES.length - 1) return; // hold on the final stage until real events arrive
    const t = setTimeout(
      () => setStage((s) => Math.min(s + 1, STAGES.length - 1)),
      ADVANCE_MS[stage] ?? 12000,
    );
    return () => clearTimeout(t);
  }, [stage]);

  return (
    <div
      data-testid="run-warmup"
      data-stage={stage}
      data-anim="fade-up"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "0.9rem 1rem",
        border: "1px solid var(--line)",
        borderRadius: 12,
        background: "var(--panel-2)",
        animation: "studio-fade-up 0.35s ease both",
      }}
    >
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
        Starting the run — the first response can take 30–60s while the secure sandbox boots.
      </p>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 9 }}>
        {STAGES.map((s, i) => {
          const active = i === stage;
          const passed = i < stage;
          return (
            <li
              key={s.label}
              data-active={active}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 9,
                opacity: i <= stage ? 1 : 0.4,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  flex: "none",
                  width: 8,
                  height: 8,
                  marginTop: 1,
                  borderRadius: "50%",
                  background: active
                    ? "var(--accent-blue)"
                    : passed
                      ? "color-mix(in srgb, var(--accent-blue) 45%, transparent)"
                      : "transparent",
                  border: active || passed ? "none" : "1px solid var(--line)",
                  boxShadow: active ? "0 0 8px var(--accent-blue)" : "none",
                  animation: active ? "studio-pulse 1.2s ease-in-out infinite" : "none",
                }}
              />
              <span style={{ fontSize: 13, fontWeight: active ? 600 : 400 }}>
                {s.label}
                {active && <span style={{ opacity: 0.6 }}>…</span>}
                <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)", fontWeight: 400 }}>
                  {s.hint}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default RunWarmup;
