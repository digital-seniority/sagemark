/**
 * Live worker dispatcher — Tier-1 (no live Sandbox).
 *
 * Drives `createLiveDispatcher` with an INJECTED fake `launchSandbox` + a scripted
 * worker log stream, asserting the contract the route relies on:
 *
 *   - it builds the right `LaunchProfile`: `gatewayBaseUrl = {host}/api/model`,
 *     egress HOST-ONLY (the host domain), the per-run bridge JWT passed through,
 *     and tenancy taken from the VERIFIED dispatch scope (never request input);
 *   - it STARTS the worker (launchSandbox only provisions) at `dist/worker/entry.js`
 *     with the brief on `WORKER_PROMPT`;
 *   - it maps the `::worker-*::` stdout markers to the right SSE events
 *     (`::worker-session-id::` -> nothing; `::worker-result:: completed` -> `done`;
 *     a non-completed result / terminal-error / fatal -> `error`);
 *   - a `BootRefusedError` (and any launch failure) surfaces as a SINGLE terminal
 *     SSE `error` frame — never an empty stream, never a thrown dispatch;
 *   - the sandbox is torn down (`stop`) on completion AND on error.
 *
 * The genuine live provisioning (real microVM, real worker loop, real model door)
 * is a Tier-3 NEEDS-INPUT e2e — see the PR report. It is NOT faked-passed here.
 */

import { describe, it, expect, vi } from "vitest";

import {
  createLiveDispatcher,
  buildLaunchProfile,
  resolveHostBaseUrl,
  parseWorkerLine,
  type StartedWorker,
  type WorkerLogChunk,
} from "@/app/api/run/live-dispatcher";
import {
  BootRefusedError,
  type LaunchProfile,
  type LaunchResult,
} from "@/worker/sandbox-launch";
import type { WorkerDispatch } from "@/app/api/run/route";
import type { SseEvent } from "@/lib/stream/event-taxonomy";

const SCOPE = {
  runId: "run-0001",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};
const DISPATCH: WorkerDispatch = {
  scope: SCOPE,
  bridgeJwt: "JWT_not_a_real_secret",
  prompt: "Write one grounded draft and persist it.",
};
const HOST = "https://seo.example.com";

/** A scripted worker whose stdout yields the given lines (joined with newlines). */
function scriptedWorker(stdoutLines: string[], stderrLines: string[] = []): StartedWorker {
  async function* logs(): AsyncGenerator<WorkerLogChunk> {
    for (const data of stderrLines) yield { stream: "stderr", data: data + "\n" };
    for (const data of stdoutLines) yield { stream: "stdout", data: data + "\n" };
  }
  return { logs };
}

/** A fake launch result whose sandbox records `stop()` calls (teardown proof). */
function fakeLaunch(): { result: LaunchResult; stop: ReturnType<typeof vi.fn> } {
  const stop = vi.fn(async () => undefined);
  const result = {
    sandbox: { stop } as unknown as LaunchResult["sandbox"],
    evidence: { egressEnforced: true, envScrubbed: true, fsJailed: true, runJwtPresent: true },
    env: {},
    lease: { leaseId: "lease_run-0001", binding: SCOPE },
  } as LaunchResult;
  return { result, stop };
}

async function drain(source: AsyncIterable<SseEvent>): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const e of source) out.push(e);
  return out;
}

// ── Host-URL resolution precedence ────────────────────────────────────────────

describe("resolveHostBaseUrl — documented precedence, fail-closed", () => {
  it("prefers SEO_HOST_BASE_URL (verbatim, trailing slash stripped)", () => {
    expect(
      resolveHostBaseUrl({
        SEO_HOST_BASE_URL: "https://pinned.example/",
        VERCEL_PROJECT_PRODUCTION_URL: "prod.vercel.app",
        VERCEL_URL: "deploy.vercel.app",
      } as NodeJS.ProcessEnv),
    ).toBe("https://pinned.example");
  });

  it("falls back to the STABLE production URL over the per-deployment URL", () => {
    expect(
      resolveHostBaseUrl({
        VERCEL_PROJECT_PRODUCTION_URL: "prod.vercel.app",
        VERCEL_URL: "deploy.vercel.app",
      } as NodeJS.ProcessEnv),
    ).toBe("https://prod.vercel.app");
  });

  it("falls back to VERCEL_URL last", () => {
    expect(resolveHostBaseUrl({ VERCEL_URL: "deploy.vercel.app" } as NodeJS.ProcessEnv)).toBe(
      "https://deploy.vercel.app",
    );
  });

  it("throws fail-closed when no host is resolvable", () => {
    expect(() => resolveHostBaseUrl({} as NodeJS.ProcessEnv)).toThrow(/cannot resolve the SEO host/);
  });
});

// ── Profile build (gateway = {host}/api/model, egress host-only, JWT passed) ───

describe("buildLaunchProfile — the LaunchProfile shape", () => {
  const profile: LaunchProfile = buildLaunchProfile({
    dispatch: DISPATCH,
    hostBaseUrl: HOST,
    workdir: "/home/worker/run",
    timeoutMs: 90_000,
  });

  it("points the model door at {host}/api/model", () => {
    expect(profile.gatewayBaseUrl).toBe("https://seo.example.com/api/model");
  });

  it("allowlists ONLY the host domain (host-only egress: model + tools both there)", () => {
    expect(profile.egressAllowlist).toEqual(["seo.example.com"]);
  });

  it("passes the per-run bridge JWT and the host base URL through", () => {
    expect(profile.bridgeJwt).toBe(DISPATCH.bridgeJwt);
    expect(profile.hostBaseUrl).toBe(HOST);
  });

  it("binds tenancy from the verified dispatch scope (never request input)", () => {
    expect(profile.binding).toEqual(SCOPE);
  });
});

// ── Marker -> SSE mapping (the parse unit) ─────────────────────────────────────

describe("parseWorkerLine — the marker taxonomy", () => {
  it("maps ::worker-session-id:: to a session-id (no downstream event)", () => {
    expect(parseWorkerLine("::worker-session-id:: sess_abc")).toEqual({
      kind: "session-id",
      sessionId: "sess_abc",
    });
  });

  it("maps a completed ::worker-result:: to a clean `done`", () => {
    expect(parseWorkerLine('::worker-result:: {"status":"completed","sessionId":"s"}')).toEqual({
      kind: "event",
      event: { type: "done" },
    });
  });

  it("maps a non-completed ::worker-result:: to a terminal `error`", () => {
    const p = parseWorkerLine('::worker-result:: {"status":"error"}');
    expect(p).toMatchObject({ kind: "event", event: { type: "error", code: "WORKER_LOOP_FAILED" } });
  });

  it("maps ::worker-terminal-error:: to a coded `error`", () => {
    expect(
      parseWorkerLine('::worker-terminal-error:: {"code":"WORKER_TIMEOUT","message":"wedged"}'),
    ).toEqual({
      kind: "event",
      event: { type: "error", code: "WORKER_TIMEOUT", message: "wedged" },
    });
  });

  it("maps ::worker-fatal:: to a terminal `error`", () => {
    expect(parseWorkerLine("::worker-fatal:: boom")).toEqual({
      kind: "event",
      event: { type: "error", code: "WORKER_LOOP_FAILED", message: "boom" },
    });
  });

  it("never forwards raw (non-marker) stdout as an event", () => {
    expect(parseWorkerLine("just some model prose")).toEqual({ kind: "none" });
    expect(parseWorkerLine("")).toEqual({ kind: "none" });
  });
});

// ── The dispatcher end-to-end (injected launch + scripted worker) ─────────────

describe("createLiveDispatcher — provisions, starts, relays, tears down", () => {
  it("builds the host-only profile, starts the worker at the entry, and relays `done`", async () => {
    const { result, stop } = fakeLaunch();
    let seenProfile: LaunchProfile | undefined;
    let seenPrompt: string | undefined;

    const dispatcher = createLiveDispatcher({
      resolveHostBaseUrl: () => HOST,
      launchSandboxImpl: async (p) => {
        seenProfile = p;
        return result;
      },
      startWorker: async (_sandbox, prompt) => {
        seenPrompt = prompt;
        return scriptedWorker([
          "::worker-session-id:: sess_xyz",
          "some model prose that must be dropped",
          '::worker-result:: {"status":"completed","sessionId":"sess_xyz"}',
        ]);
      },
    });

    const source = await dispatcher(DISPATCH);
    const events = await drain(source);

    // Profile: model door + host-only egress + JWT + tenancy.
    expect(seenProfile?.gatewayBaseUrl).toBe("https://seo.example.com/api/model");
    expect(seenProfile?.egressAllowlist).toEqual(["seo.example.com"]);
    expect(seenProfile?.bridgeJwt).toBe(DISPATCH.bridgeJwt);
    expect(seenProfile?.binding).toEqual(SCOPE);
    // The brief is forwarded to the worker.
    expect(seenPrompt).toBe(DISPATCH.prompt);

    // Only the lifecycle `done` is forwarded (session-id + prose dropped), stamped.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "done", seq: 0, runId: SCOPE.runId });

    // Teardown on completion.
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("relays a worker terminal-error marker as a terminal SSE error + tears down", async () => {
    const { result, stop } = fakeLaunch();
    const dispatcher = createLiveDispatcher({
      resolveHostBaseUrl: () => HOST,
      launchSandboxImpl: async () => result,
      startWorker: async () =>
        scriptedWorker(['::worker-terminal-error:: {"code":"WORKER_TIMEOUT","message":"wedged"}']),
    });

    const events = await drain(await dispatcher(DISPATCH));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "error",
      code: "WORKER_TIMEOUT",
      message: "wedged",
      runId: SCOPE.runId,
    });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("surfaces a BootRefusedError as a SINGLE terminal SSE error (never empty)", async () => {
    const dispatcher = createLiveDispatcher({
      resolveHostBaseUrl: () => HOST,
      launchSandboxImpl: async () => {
        throw new BootRefusedError("egress", "egress allowlist / MMDS block not provably enforced");
      },
      startWorker: async () => {
        throw new Error("worker must NEVER start after a boot refusal");
      },
    });

    const events = await drain(await dispatcher(DISPATCH));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    expect((events[0] as Extract<SseEvent, { type: "error" }>).message).toContain("boot-refused:egress");
    expect(events[0].runId).toBe(SCOPE.runId);
  });

  it("surfaces a host-URL resolution failure as a terminal SSE error (fail-closed)", async () => {
    let launched = false;
    const dispatcher = createLiveDispatcher({
      resolveHostBaseUrl: () => {
        throw new Error("cannot resolve the SEO host base URL");
      },
      launchSandboxImpl: async () => {
        launched = true;
        throw new Error("unreachable");
      },
    });

    const events = await drain(await dispatcher(DISPATCH));
    expect(launched).toBe(false); // never provisioned without a host
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", code: "RELAY_FAILED" });
  });

  it("tears down the sandbox if the worker fails to START", async () => {
    const { result, stop } = fakeLaunch();
    const dispatcher = createLiveDispatcher({
      resolveHostBaseUrl: () => HOST,
      launchSandboxImpl: async () => result,
      startWorker: async () => {
        throw new Error("exec failed");
      },
    });

    const events = await drain(await dispatcher(DISPATCH));
    expect(events[0]).toMatchObject({ type: "error", code: "WORKER_LOOP_FAILED" });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("closes cleanly (relay emits `done`) when the worker stream ends with no terminal marker", async () => {
    const { result } = fakeLaunch();
    const dispatcher = createLiveDispatcher({
      resolveHostBaseUrl: () => HOST,
      launchSandboxImpl: async () => result,
      startWorker: async () => scriptedWorker(["::worker-session-id:: s", "noise"]),
    });

    // No terminal marker -> the dispatcher source ends with no events; the relay
    // (not under test here) then synthesizes a clean `done`. Assert empty + no throw.
    const events = await drain(await dispatcher(DISPATCH));
    expect(events).toEqual([]);
  });
});
