/**
 * Worker process entrypoint (PR 006 / P0.W.2, lane worker-runtime).
 *
 * The compiled form of this file (`dist/worker/entry.js`) is the Dockerfile
 * ENTRYPOINT — the long-running process the per-run Vercel Sandbox microVM boots.
 * It does the minimum: read the SCRUBBED env (fail-closed if anything is
 * missing / a raw provider key is present), then run the autonomous loop.
 *
 * IMPORTANT — this runs ONLY inside the Sandbox, AFTER `sandbox-launch` has
 * provisioned + boot-gated the VM (the hardened profile is applied and proven
 * BEFORE this process starts; this file does not re-apply controls). The brief
 * prompt is supplied via `WORKER_PROMPT` (the host injects the run's brief).
 *
 * Non-serverless; no Next APIs. Clean ASCII / UTF-8.
 */

import { readWorkerEnv, runAgentLoop } from "./agent-worker";

async function main(): Promise<void> {
  const workerEnv = readWorkerEnv();
  const prompt =
    process.env.WORKER_PROMPT ??
    "Run the seo-blog-writer skill to produce one grounded draft for this run, " +
      "then persist it via the persistPiece tool. Do not publish.";

  const result = await runAgentLoop({
    workerEnv,
    prompt,
    onSessionId: (sessionId) => {
      // The host persists this (the reload/resume key, acceptance #1). Inside the
      // Sandbox we only emit it to stdout — the host tails the run log / bridge.
      // eslint-disable-next-line no-console
      console.log(`::worker-session-id:: ${sessionId}`);
    },
    onTerminalError: (err) => {
      // Terminal error event (acceptance #4). The host reads this and releases
      // the lease; the process then exits non-zero so no zombie loop lingers.
      // eslint-disable-next-line no-console
      console.error(`::worker-terminal-error:: ${JSON.stringify(err)}`);
    },
  });

  // eslint-disable-next-line no-console
  console.log(`::worker-result:: ${JSON.stringify({ status: result.status, sessionId: result.sessionId })}`);
  process.exit(result.status === "completed" ? 0 : 1);
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`::worker-fatal:: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
