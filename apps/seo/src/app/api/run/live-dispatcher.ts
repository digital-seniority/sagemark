/**
 * Live worker dispatcher (PR 007 wiring / P0.W.x, lane worker-runtime).
 *
 * THE FINAL SEAM that turns `/api/run` from "dispatcher not wired" into a live
 * autonomous-drafting run. The route mints the per-run bridge JWT + binds tenancy
 * SERVER-side, then hands a `WorkerDispatch` to a `WorkerDispatcher`; this module
 * is the production `WorkerDispatcher` that:
 *
 *   1. Builds a hardened `LaunchProfile` from the dispatch (tenancy from the
 *      VERIFIED scope, never request input).
 *   2. Provisions + boot-gates a per-run Vercel Sandbox microVM via the PR 006
 *      `launchSandbox` (which APPLIES + PROVES the capability-denial profile and
 *      throws `BootRefusedError` fail-closed if any control is unprovable).
 *   3. STARTS the worker process inside the VM (`launchSandbox` only provisions —
 *      it does not spawn the loop), capturing its stdout marker channel.
 *   4. Returns a `WorkerEventSource` (async iterable of `SseEvent`) that parses the
 *      worker's `::worker-*::` stdout markers into coded SSE events, ends cleanly
 *      on `::worker-result::`, and tears the sandbox down on completion / error.
 *
 * EGRESS IS HOST-ONLY. The worker reaches the model at
 * `ANTHROPIC_BASE_URL = {host}/api/model` (the host model-proxy verifies the bridge
 * JWT + forwards to the metered Gateway) AND reaches its `/content/api/*` tools on
 * the same `{host}`. So the egress allowlist is the single host domain — both the
 * model door and the tool bridge live there. No direct Gateway egress.
 *
 * FAIL-LOUD, NEVER SILENT. A `BootRefusedError` (or any launch failure) is surfaced
 * as a SINGLE terminal SSE `error` frame on the returned source — never a thrown
 * dispatch (which the route would turn into a JSON 503) and never an empty stream.
 * The relay forwards that one `error` frame and closes; the browser sees an
 * explicit failure row, not a hung spinner.
 *
 * INJECTION-FIRST. Every infra touch is an injectable dep so the Tier-1 test drives
 * the whole dispatcher (profile build, marker -> SSE mapping, boot-refusal, teardown)
 * with NO live Sandbox. The genuine live provisioning is a Tier-3 e2e.
 *
 * Clean ASCII / UTF-8.
 */

import "server-only";

import {
  launchSandbox as realLaunchSandbox,
  BootRefusedError,
  type LaunchProfile,
  type LaunchResult,
} from "@/worker/sandbox-launch";
import type { WorkerEventSource } from "@/lib/stream/sse-relay";
import {
  type SseEvent,
  type ToolUseStatus,
  type GateStage,
  isToolUseCode,
} from "@/lib/stream/event-taxonomy";
import type { WorkerDispatch, WorkerDispatcher } from "./route";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * The worker's ephemeral working-dir jail inside the VM. Matches the Dockerfile's
 * `WORKER_WORKDIR=/home/worker/run` (the FS jail root, [[DR-011]]).
 */
export const DEFAULT_WORKER_WORKDIR = "/home/worker/run";

/**
 * The compiled worker entrypoint, relative to the image WORKDIR (`/home/worker/app`).
 * The Dockerfile ENTRYPOINT is `node dist/worker/entry.js`; we start it the same way
 * since `launchSandbox` only provisions the VM (it does not spawn the loop).
 */
export const WORKER_ENTRY = "dist/worker/entry.js";

/**
 * The run-budget ceiling (ms) the VM is provisioned with. ~270s matches the
 * single-piece generation cap + the bridge-JWT expiry. The host relay carries the
 * same stall ceiling, so a wedged worker surfaces as a terminal error either way.
 */
export const DEFAULT_RUN_TIMEOUT_MS = 270_000;

// ── Host-URL resolution (documented precedence, fail-closed) ──────────────────

/**
 * Resolve the apps/seo HOST base URL — the single origin the worker may reach
 * (the model door at `/api/model` AND the `/content/api/*` tool bridge). Precedence:
 *
 *   1. `SEO_HOST_BASE_URL` — an explicit, fully-qualified override (highest
 *      priority; lets a deploy pin the exact host, e.g. a stable custom domain).
 *   2. `VERCEL_PROJECT_PRODUCTION_URL` — Vercel's STABLE production domain
 *      (preferred over the per-deployment URL because the bridge JWT + the worker
 *      egress allowlist must target a durable host, not an ephemeral preview URL).
 *   3. `VERCEL_URL` — the per-deployment URL (last-resort fallback).
 *
 * 2/3 are bare hostnames; we prepend `https://`. (1) is used verbatim. If none is
 * set we throw — fail-closed, never default to localhost or an empty host (which
 * would silently break the worker's only door).
 */
export function resolveHostBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.SEO_HOST_BASE_URL?.trim();
  if (explicit) return stripTrailingSlash(explicit);

  const prod = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (prod) return `https://${stripTrailingSlash(prod)}`;

  const deploy = env.VERCEL_URL?.trim();
  if (deploy) return `https://${stripTrailingSlash(deploy)}`;

  throw new Error(
    "cannot resolve the SEO host base URL: set SEO_HOST_BASE_URL (or run on Vercel " +
      "where VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL is present). Fail-closed — " +
      "the worker has no model door / tool bridge without a host.",
  );
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

/** The host DOMAIN (no scheme/port path) for the egress allowlist entry. */
function hostDomainFor(hostBaseUrl: string): string {
  try {
    return new URL(hostBaseUrl).host; // host = hostname[:port]
  } catch {
    // hostBaseUrl was a bare domain (no scheme) — use as-is.
    return hostBaseUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

// ── Profile builder (tenancy from the verified scope, never request input) ────

/**
 * Build the hardened `LaunchProfile` for one run. EGRESS IS HOST-ONLY: the single
 * allowlisted host is the apps/seo origin, since both the model proxy (`/api/model`)
 * and the tool bridge (`/content/api/*`) live there. The gateway base URL the
 * worker's SDK is pointed at (`ANTHROPIC_BASE_URL`) is `{host}/api/model`.
 */
export function buildLaunchProfile(args: {
  dispatch: WorkerDispatch;
  hostBaseUrl: string;
  workdir: string;
  timeoutMs: number;
}): LaunchProfile {
  const { dispatch, hostBaseUrl, workdir, timeoutMs } = args;
  return {
    // Tenancy + identity binding comes from the VERIFIED dispatch scope only.
    binding: {
      runId: dispatch.scope.runId,
      workspaceId: dispatch.scope.workspaceId,
      clientId: dispatch.scope.clientId,
      ...(dispatch.scope.projectId ? { projectId: dispatch.scope.projectId } : {}),
    },
    // HOST-ONLY egress: the model door + the tool bridge are both on the host.
    egressAllowlist: [hostDomainFor(hostBaseUrl)],
    bridgeJwt: dispatch.bridgeJwt,
    // The worker's model door = the host model-proxy (verifies JWT -> Gateway).
    gatewayBaseUrl: `${hostBaseUrl}/api/model`,
    hostBaseUrl,
    workdir,
    timeoutMs,
    ...(dispatch.scope.workerMode ? { workerMode: dispatch.scope.workerMode } : {}),
  };
}

// ── Worker stdout-marker -> SseEvent parsing ──────────────────────────────────

/**
 * The stdout markers the worker emits, and how this dispatcher maps each to a coded
 * SSE event (or to nothing). Two families:
 *
 * LIFECYCLE (from `worker/entry.ts`):
 *   ::worker-session-id:: <id>      -> (no downstream event; host-side resume key)
 *   ::worker-result:: {json}        -> `done` if status==="completed", else `error`
 *   ::worker-terminal-error:: {json}-> `error` (the worker's terminal failure)
 *   ::worker-fatal:: <message>      -> `error` (an unhandled crash in the entry)
 *
 * RICH LIVE DELTAS (P-J, from `worker/emit.ts` via the SDK loop in
 * `agent-worker.ts`). The payload is `base64(JSON(body))` — injection-safe (a model
 * token that looks like a marker, or contains a newline, cannot break the framing
 * or forge a marker, because base64's alphabet has no `:`/space/newline). A
 * non-base64 / non-JSON / schema-invalid payload is DROPPED (`{kind:"none"}`),
 * never forwarded as free text (the no-raw-prose-leak discipline):
 *   ::worker-token:: <b64>          -> `token-delta` (the article typing in)
 *   ::worker-thinking:: <b64>       -> `thinking`    (agent reasoning, muted)
 *   ::worker-tool:: <b64>           -> `tool-use`    (coded tool row; unknown code dropped)
 *   ::worker-gate:: <b64>           -> `gate`        (Stage-A vetoes / Stage-B score+verdict)
 *
 * Lifecycle markers terminate the stream (`done`/`error`); rich-delta markers are
 * intermediate frames that never terminate it.
 */
/**
 * Distributive omit — applies `Omit` to EACH member of the `SseEvent` union so an
 * `error` body keeps `code`/`message` and a `done` body keeps just `type` (a plain
 * `Omit<SseEvent, ...>` collapses the union to its shared keys). Mirrors
 * `worker/emit.ts`'s `EventBody`.
 */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** One event minus the envelope fields the dispatcher stamps (`seq` + `runId`). */
export type EventBody = DistributiveOmit<SseEvent, "seq" | "runId">;

export type MarkerParse =
  | { kind: "none" }
  | { kind: "session-id"; sessionId: string }
  | { kind: "event"; event: EventBody };

const RE_SESSION_ID = /^::worker-session-id::\s*(.*)$/;
const RE_RESULT = /^::worker-result::\s*(.*)$/;
const RE_TERMINAL_ERROR = /^::worker-terminal-error::\s*(.*)$/;
const RE_FATAL = /^::worker-fatal::\s*(.*)$/;
// CLI stderr and diagnostic markers written to worker stdout — NOT forwarded as SSE
// events (they are diagnostic-only). Captured in rawStderrLines for the no-output
// error message so failures surface instead of producing a silent `done`.
const RE_CLI_ERR = /^::worker-cli-err::\s*(.*)$/;
const RE_DIAG = /^::worker-diag::\s*(.*)$/;
// Rich live-delta markers (P-J). The payload is a base64 blob (no `::`, space, or
// newline), so the prefix match is unambiguous and the blob is decoded separately.
const RE_TOKEN = /^::worker-token::\s*(.*)$/;
const RE_THINKING = /^::worker-thinking::\s*(.*)$/;
const RE_TOOL = /^::worker-tool::\s*(.*)$/;
const RE_GATE = /^::worker-gate::\s*(.*)$/;

/**
 * Decode a rich-delta marker payload (`base64(JSON(body))`) back into a plain
 * object, or null if it is not valid base64-of-JSON. FAIL-SAFE: any decode/parse
 * failure returns null so the caller drops the marker (never crashes, never
 * forwards raw bytes downstream).
 */
function decodeMarkerPayload(b64: string): Record<string, unknown> | null {
  const trimmed = b64.trim();
  if (!trimmed) return null;
  // Reject anything outside the base64 alphabet up front (defence-in-depth: a
  // forged payload with stray bytes can't sneak through as "JSON").
  if (!/^[A-Za-z0-9+/=]+$/.test(trimmed)) return null;
  let json: string;
  try {
    json = Buffer.from(trimmed, "base64").toString("utf8");
  } catch {
    return null;
  }
  const parsed = safeJson(json);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/**
 * Parse ONE stdout line into a marker result. A non-marker line is `{kind:"none"}`
 * (raw worker stdout is never forwarded as a free-text SSE row — injection-surface
 * discipline). Malformed marker JSON degrades to a terminal error (fail-loud).
 */
export function parseWorkerLine(line: string): MarkerParse {
  const trimmed = line.trim();
  if (!trimmed) return { kind: "none" };

  let m = RE_SESSION_ID.exec(trimmed);
  if (m) return { kind: "session-id", sessionId: (m[1] ?? "").trim() };

  m = RE_RESULT.exec(trimmed);
  if (m) {
    const parsed = safeJson(m[1] ?? "");
    const status = (parsed as { status?: unknown })?.status;
    if (status === "completed") {
      return { kind: "event", event: { type: "done" } };
    }
    return {
      kind: "event",
      event: {
        type: "error",
        code: "WORKER_LOOP_FAILED",
        message:
          typeof status === "string"
            ? `worker run ended with status '${status}'`
            : "worker run ended without a completed status",
      },
    };
  }

  m = RE_TERMINAL_ERROR.exec(trimmed);
  if (m) {
    const parsed = safeJson(m[1] ?? "") as { code?: unknown; message?: unknown } | null;
    return {
      kind: "event",
      event: {
        type: "error",
        code: typeof parsed?.code === "string" ? parsed.code : "WORKER_LOOP_FAILED",
        message:
          typeof parsed?.message === "string" ? parsed.message : "worker emitted a terminal error",
      },
    };
  }

  m = RE_FATAL.exec(trimmed);
  if (m) {
    return {
      kind: "event",
      event: { type: "error", code: "WORKER_LOOP_FAILED", message: (m[1] ?? "").trim() || "worker crashed" },
    };
  }

  // ── Rich live-delta markers (P-J). Decode base64(JSON), validate, map to the
  //    taxonomy event. A malformed / schema-invalid payload is DROPPED (no crash,
  //    no raw-prose forwarding). These are intermediate frames — never terminal.

  m = RE_TOKEN.exec(trimmed);
  if (m) {
    const payload = decodeMarkerPayload(m[1] ?? "");
    const delta = payload?.delta;
    if (typeof delta === "string" && delta.length > 0) {
      return { kind: "event", event: { type: "token-delta", delta } };
    }
    return { kind: "none" };
  }

  m = RE_THINKING.exec(trimmed);
  if (m) {
    const payload = decodeMarkerPayload(m[1] ?? "");
    const delta = payload?.delta;
    if (typeof delta === "string" && delta.length > 0) {
      return { kind: "event", event: { type: "thinking", delta } };
    }
    return { kind: "none" };
  }

  m = RE_TOOL.exec(trimmed);
  if (m) {
    const payload = decodeMarkerPayload(m[1] ?? "");
    const code = payload?.code;
    const status = payload?.status;
    // The CODE must be a stable taxonomy code and the STATUS a known lifecycle —
    // an unknown/forged code is dropped (the acceptance-2 chokepoint, mirrored on
    // the host side so a compromised worker still can't inject a free-text row).
    if (isToolUseCode(code) && isToolUseStatus(status)) {
      const label = typeof payload?.label === "string" ? payload.label : undefined;
      return { kind: "event", event: { type: "tool-use", code, status, label } };
    }
    return { kind: "none" };
  }

  m = RE_GATE.exec(trimmed);
  if (m) {
    const payload = decodeMarkerPayload(m[1] ?? "");
    const stage = payload?.stage;
    if (isGateStage(stage)) {
      const vetoes = Array.isArray(payload?.vetoes)
        ? (payload.vetoes as unknown[]).filter((v): v is string => typeof v === "string")
        : undefined;
      const score = typeof payload?.score === "number" ? payload.score : null;
      const verdict = typeof payload?.verdict === "string" ? payload.verdict : null;
      return { kind: "event", event: { type: "gate", stage, vetoes, score, verdict } };
    }
    return { kind: "none" };
  }

  return { kind: "none" };
}

/** Guard: a known tool-use lifecycle status. */
function isToolUseStatus(value: unknown): value is ToolUseStatus {
  return value === "running" || value === "ok" || value === "error";
}

/** Guard: a known deterministic-gate stage. */
function isGateStage(value: unknown): value is GateStage {
  return value === "stageA" || value === "stageB";
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s.trim());
  } catch {
    return null;
  }
}

// ── The log-line source (the worker stdout/stderr channel, abstracted) ────────

/** One worker log chunk (the shape `@vercel/sandbox` `Command.logs()` yields). */
export interface WorkerLogChunk {
  data: string;
  stream: "stdout" | "stderr";
}

/** An async source of worker log chunks (the started command's `logs()`). */
export type WorkerLogs = AsyncIterable<WorkerLogChunk>;

/** A started worker command — just enough surface to read logs + await exit. */
export interface StartedWorker {
  logs: () => WorkerLogs;
}

/** A teardownable sandbox handle (the bit of the launch result the source needs). */
export interface SandboxHandle {
  stop?: () => Promise<unknown>;
}

// ── Dispatcher deps (injection seam for the Tier-1 test) ──────────────────────

export interface LiveDispatcherDeps {
  /** Provision + boot-gate the VM (default: PR 006 `launchSandbox`). */
  launchSandboxImpl?: (profile: LaunchProfile) => Promise<LaunchResult>;
  /** Start the worker process in the VM + return its log source. */
  startWorker?: (
    sandbox: LaunchResult["sandbox"],
    prompt: string,
    baseEnv: Record<string, string>,
  ) => Promise<StartedWorker>;
  /** Resolve the host base URL (default: env precedence above). */
  resolveHostBaseUrl?: () => string;
  /** The FS-jail workdir (default `/home/worker/run`). */
  workdir?: string;
  /** The VM run-budget ceiling (default 90s). */
  timeoutMs?: number;
}

/**
 * Start the worker loop inside the provisioned VM. `launchSandbox` only PROVISIONS
 * the hardened VM; the loop is NOT spawned by it. We start it the same way the
 * Dockerfile ENTRYPOINT does (`node dist/worker/entry.js`), passing the run's brief
 * via `WORKER_PROMPT`. We re-spread the scrubbed base env (`launch.env`, from
 * `buildWorkerEnv`) onto the per-command env because the `@vercel/sandbox` SDK treats
 * a per-command `env` as an OVERRIDE of the sandbox defaults, not a merge — so passing
 * `{ WORKER_PROMPT }` alone would starve the entry process of `ANTHROPIC_BASE_URL`,
 * `SEO_HOST_BASE_URL`, `RUN_ID`, etc. and `readWorkerEnv()` would throw before the loop.
 * Spreading is safe under both readings (a no-op if the SDK actually merges).
 * Detached, so we stream its logs while it runs.
 *
 * `cwd` is set explicitly so `process.cwd()` inside the worker resolves to
 * `/home/worker/app` — the app root where the snapshot installs node_modules and
 * skills. Without it the sandbox default CWD (not /home/worker/app) would cause
 * `loadSuite` to fail finding the vendored skill SKILL.md files (DR-022).
 */
async function startWorkerInSandbox(
  sandbox: LaunchResult["sandbox"],
  prompt: string,
  baseEnv: Record<string, string>,
): Promise<StartedWorker> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cmd = await (sandbox as any).runCommand({
    cmd: "node",
    args: [WORKER_ENTRY],
    cwd: "/home/worker/app",
    env: { ...baseEnv, WORKER_PROMPT: prompt },
    detached: true,
  });
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logs: () => (cmd as any).logs() as WorkerLogs,
  };
}

// ── The event source (marker stream -> SseEvent async iterable + teardown) ────

/**
 * Build a `WorkerEventSource` from a started worker's log chunks: split stdout into
 * lines, parse each marker, yield the mapped coded events, and end after the first
 * terminal frame (`done` / `error`). The sandbox is torn down in `finally` so no VM
 * is left holding a lease on completion, error, or early consumer cancel.
 *
 * STDERR LIFECYCLE MARKERS. `entry.ts` emits `::worker-terminal-error::` and
 * `::worker-fatal::` to stderr (via console.error), not stdout. We also parse stderr
 * for those lifecycle-only markers so the real error message (not the generic
 * "worker run ended with status 'error'" from the stdout `::worker-result::`) reaches
 * the client. Rich-delta markers (token/thinking/tool/gate) only ever appear on
 * stdout, so we never forward raw stderr lines — the injection-surface discipline
 * is preserved.
 */
async function* sourceFromWorker(
  worker: StartedWorker,
  sandbox: SandboxHandle,
): AsyncGenerator<EventBody> {
  let stdoutBuf = "";
  let stderrBuf = "";
  // Raw stderr lines that don't match any marker pattern (e.g. Node module errors).
  // Captured for diagnostic context in the no-output error event.
  const rawStderrLines: string[] = [];
  let yieldedAnyEvent = false;
  try {
    for await (const chunk of worker.logs()) {
      if (chunk.stream === "stdout") {
        stdoutBuf += chunk.data;
        let nl: number;
        while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
          const line = stdoutBuf.slice(0, nl);
          stdoutBuf = stdoutBuf.slice(nl + 1);
          const parsed = parseWorkerLine(line);
          if (parsed.kind === "event") {
            yieldedAnyEvent = true;
            yield parsed.event;
            if (parsed.event.type === "done" || parsed.event.type === "error") return;
          }
          // CLI errors and diagnostics on stdout: not forwarded as SSE but captured
          // for the no-output error context so failures are not silently swallowed.
          if (parsed.kind === "none") {
            const isCliDiag = RE_CLI_ERR.test(line) || RE_DIAG.test(line);
            if (isCliDiag && line.trim() && rawStderrLines.length < 10) {
              rawStderrLines.push(line.trim().slice(0, 300));
            }
          }
          // session-id / none: nothing forwarded downstream.
        }
      } else {
        // stderr: parse lifecycle terminal markers only (::worker-terminal-error::,
        // ::worker-fatal::). Rich-delta markers never appear on stderr; raw lines
        // are never forwarded as free text (injection-surface discipline), but we
        // capture a snippet for diagnostic context when the worker emits no events.
        stderrBuf += chunk.data;
        let nl: number;
        while ((nl = stderrBuf.indexOf("\n")) >= 0) {
          const line = stderrBuf.slice(0, nl);
          stderrBuf = stderrBuf.slice(nl + 1);
          const parsed = parseWorkerLine(line);
          if (
            parsed.kind === "event" &&
            (parsed.event.type === "done" || parsed.event.type === "error")
          ) {
            yieldedAnyEvent = true;
            yield parsed.event;
            return;
          }
          // Capture raw stderr for diagnostics (truncated; never forwarded as prose).
          if (line.trim() && rawStderrLines.length < 5) {
            rawStderrLines.push(line.trim().slice(0, 300));
          }
        }
      }
    }
    // Flush stdout tail for a marker not terminated by a newline.
    const tail = parseWorkerLine(stdoutBuf);
    if (tail.kind === "event") {
      yieldedAnyEvent = true;
      yield tail.event;
      return;
    }
    // Flush stderr tail for a lifecycle marker not terminated by a newline.
    const stderrTail = parseWorkerLine(stderrBuf);
    if (
      stderrTail.kind === "event" &&
      (stderrTail.event.type === "done" || stderrTail.event.type === "error")
    ) {
      yieldedAnyEvent = true;
      yield stderrTail.event;
      return;
    }
    // The log stream ended with no terminal marker. If we got no events at all this
    // is an unhandled crash (Node module error, OOM, signal) — surface it as a
    // loud error rather than a silent "done" that masks the failure.
    if (!yieldedAnyEvent) {
      const diagCtx = rawStderrLines.length
        ? `stderr: ${rawStderrLines.join(" | ")}`
        : "no stdout/stderr output received from worker";
      yield {
        type: "error",
        code: "WORKER_LOOP_FAILED",
        message: `worker exited without emitting any events (${diagCtx})`,
      };
    }
  } finally {
    await sandbox.stop?.().catch(() => undefined);
  }
}

/** One terminal-error-only source (boot refusal / launch failure → fail-loud). */
async function* terminalErrorSource(
  code: string,
  message: string,
): AsyncGenerator<EventBody> {
  yield { type: "error", code, message };
}

/**
 * Stamp the run envelope (`seq` + `runId`) onto each bodied event so the result is
 * a proper `WorkerEventSource` (`AsyncIterable<SseEvent>`). `seq` is monotonic per
 * source — the relay uses it as the resume cursor.
 */
async function* withEnvelope(
  runId: string,
  inner: AsyncGenerator<EventBody>,
): AsyncGenerator<SseEvent> {
  let seq = 0;
  for await (const body of inner) {
    yield { ...(body as object), seq: seq++, runId } as SseEvent;
  }
}

// ── The live dispatcher factory ───────────────────────────────────────────────

/**
 * Create the production `WorkerDispatcher`. It provisions a per-run Sandbox, starts
 * the worker, and relays its marker stream as coded SSE events — surfacing a
 * `BootRefusedError` (or any launch failure) as a single terminal SSE `error` frame
 * (fail-loud, never an empty stream, never a thrown dispatch).
 */
export function createLiveDispatcher(deps: LiveDispatcherDeps = {}): WorkerDispatcher {
  const launchSandboxImpl = deps.launchSandboxImpl ?? realLaunchSandbox;
  const startWorker = deps.startWorker ?? startWorkerInSandbox;
  const resolveHost = deps.resolveHostBaseUrl ?? (() => resolveHostBaseUrl());
  const workdir = deps.workdir ?? DEFAULT_WORKER_WORKDIR;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;

  return async (dispatch: WorkerDispatch): Promise<WorkerEventSource> => {
    const runId = dispatch.scope.runId;

    let hostBaseUrl: string;
    try {
      hostBaseUrl = resolveHost();
    } catch (err) {
      return withEnvelope(
        runId,
        terminalErrorSource("RELAY_FAILED", (err as Error).message),
      );
    }

    const profile = buildLaunchProfile({ dispatch, hostBaseUrl, workdir, timeoutMs });

    let launch: LaunchResult;
    try {
      launch = await launchSandboxImpl(profile);
    } catch (err) {
      // BootRefusedError (or any launch failure) -> one terminal SSE error frame.
      const code = err instanceof BootRefusedError ? "WORKER_LOOP_FAILED" : "RELAY_FAILED";
      return withEnvelope(runId, terminalErrorSource(code, (err as Error).message));
    }

    let worker: StartedWorker;
    try {
      worker = await startWorker(launch.sandbox, dispatch.prompt, launch.env);
    } catch (err) {
      await (launch.sandbox as SandboxHandle).stop?.().catch(() => undefined);
      return withEnvelope(
        runId,
        terminalErrorSource("WORKER_LOOP_FAILED", (err as Error).message),
      );
    }

    return withEnvelope(runId, sourceFromWorker(worker, launch.sandbox as SandboxHandle));
  };
}
