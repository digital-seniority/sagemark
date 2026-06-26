/**
 * Agent-SDK worker bootstrap (PR 006 / P0.W.2, lane worker-runtime).
 *
 * This is the autonomous loop that runs INSIDE the hardened Vercel Sandbox
 * (provisioned + boot-gated by `sandbox-launch.ts`). It drives the
 * `seo-blog-writer` suite skill through the Claude Agent SDK (`query()` over the
 * `claude` CLI subprocess) and points its toolset at the PR 005 `/content/api/*`
 * route contract via the run-scoped `host-tool-bridge` — the routes ARE the
 * toolset; the worker never re-implements the kernel.
 *
 * THE INVARIANTS THIS FILE ENCODES:
 *   • MODEL CREDENTIAL = the per-run bridge JWT, via the Gateway seam ONLY
 *     (DR-013 / resolve-gateway-model worker invariant). The SDK is pointed at
 *     `ANTHROPIC_BASE_URL` (the Gateway) + `ANTHROPIC_AUTH_TOKEN` (the JWT). No
 *     raw provider key is ever read (acceptance #6).
 *   • THE ONLY MUTATION PATH = the host `persistPiece` tool (acceptance #2). The
 *     worker has no Supabase client; it asks the host to persist. There is NO
 *     publish tool and NO general write tool in the model's surface.
 *   • NO RAW SHELL / ARBITRARY-FILE TOOL ([[DR-011]]). The model's only FS access
 *     is the workdir-scoped read tool, which refuses out-of-jail paths at the
 *     tool layer. `tools: []` removes ALL built-ins (Bash/Read/Write/WebFetch);
 *     only the curated SDK-MCP tools are exposed.
 *   • TENANCY bound per-run (acceptance #3): the bridge is minted for exactly one
 *     `(workspace, client, run)` and the model cannot supply tenancy.
 *   • TERMINAL ERROR + LEASE RELEASE on wedge/timeout (acceptance #4).
 *
 * THINNEST SLICE (this PR): the single-drafter path — the loop calls the host
 * `/content/api/draft` route to persist a grounded draft. The full
 * strategist→assistant→audit chain (PR 014) and the SSE transport (PR 007) are
 * out of scope.
 *
 * NON-SERVERLESS. This is a long-running process, hosted via the Dockerfile +
 * Sandbox, NOT a Next route. No Next APIs are imported here.
 *
 * Clean ASCII / UTF-8.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { z } from "zod";

import {
  createHostToolBridge,
  type HostToolBridge,
  type RunBinding,
} from "./host-tool-bridge";
import { pathWithinWorkdir } from "./sandbox-launch";
// A.011.1: the model tool allowlist is the capability-profile's single source of
// truth — import it, never re-declare the strings here.
import { WORKER_ALLOWED_TOOLS } from "./capability-profile";
import {
  loadSuite,
  SINGLE_DRAFTER_SKILL,
  type LoadedSuite,
} from "./skills/load-suite";

/** The skill the worker loads — the existing `seo-blog-writer` suite entry. */
export const WORKER_SKILL_NAME = SINGLE_DRAFTER_SKILL;

/**
 * Resolve the worker's model + bridge config from the SCRUBBED Sandbox env
 * (built by `sandbox-launch.buildWorkerEnv`). This is the worker's whole view of
 * the world: the Gateway base URL + bearer JWT, the host bridge URL, and the run
 * binding. A missing value is a hard, fail-fast error (no degraded run).
 */
export interface WorkerEnv {
  gatewayBaseUrl: string;
  bridgeJwt: string;
  hostBaseUrl: string;
  workdir: string;
  binding: RunBinding;
}

export function readWorkerEnv(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const required = (k: string): string => {
    const v = env[k];
    if (!v) throw new Error(`worker env missing required key: ${k} (fail-closed — refusing to run)`);
    return v;
  };
  // Hard invariant (acceptance #6): a raw provider key must NEVER be present.
  if (env.ANTHROPIC_API_KEY) {
    throw new Error(
      "worker env carries ANTHROPIC_API_KEY — the worker must use a Gateway bearer token only " +
        "(DR-013 worker invariant). Refusing to run.",
    );
  }
  return {
    gatewayBaseUrl: required("ANTHROPIC_BASE_URL"),
    bridgeJwt: required("ANTHROPIC_AUTH_TOKEN"),
    hostBaseUrl: required("SEO_HOST_BASE_URL"),
    workdir: required("WORKER_WORKDIR"),
    binding: {
      runId: required("RUN_ID"),
      workspaceId: required("RUN_WORKSPACE_ID"),
      clientId: required("RUN_CLIENT_ID"),
    },
  };
}

// ── The curated model tool surface (SDK-MCP tools) ─────────────────────────────

/**
 * Build the worker's MCP tool server: the ONLY tools the model can call. The
 * tool surface is the enforcement boundary ([[DR-011]] / acceptance #2):
 *
 *   • `persistPiece` — the ONLY mutation path. Calls the host `/content/api/draft`
 *     route through the run-scoped bridge. Tenancy is injected from the binding;
 *     the model cannot supply it.
 *   • `readWorkdirFile` — workdir-scoped read. Refuses any path outside the run's
 *     ephemeral workdir at the TOOL layer (before touching the FS).
 *
 * Deliberately ABSENT: any publish tool, any general write/shell/arbitrary-file
 * tool. `@anthropic-ai/claude-agent-sdk` is imported dynamically so this module
 * imports with no SDK present (Tier-1 unit tests touch the tool LOGIC, not the
 * live SDK); a missing dep throws a precise NEEDS-DEP error.
 */
export async function buildWorkerToolServer(opts: {
  bridge: HostToolBridge;
  workdir: string;
  readFileImpl?: (absPath: string) => Promise<string>;
}): Promise<unknown> {
  let tool: any;
  let createSdkMcpServer: any;
  try {
    ({ tool, createSdkMcpServer } = (await import("@anthropic-ai/claude-agent-sdk")) as any);
  } catch (err) {
    throw new Error(
      "[NEEDS-DEP] @anthropic-ai/claude-agent-sdk is not installed. " +
        "Install it: `pnpm --filter @sagemark/seo add @anthropic-ai/claude-agent-sdk`. " +
        `Underlying error: ${(err as Error).message}`,
    );
  }

  const persistPiece = tool(
    "persistPiece",
    "Persist the grounded draft as a content_pieces row via the host. This is the " +
      "ONLY way to save work. Tenancy is fixed by the run; do not supply workspace " +
      "or client ids.",
    {
      title: z.string().min(1).max(300),
      slug: z
        .string()
        .min(1)
        .max(100)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      body: z.string().min(1),
      excerpt: z.string().max(600).optional(),
      metaDescription: z.string().max(320).optional(),
      isYmyl: z.boolean().optional(),
    },
    async (args: Record<string, unknown>) => {
      const result = await opts.bridge.persistPiece(args as any);
      return {
        content: [
          {
            type: "text",
            text: `Persisted piece ${result.pieceId} (slug=${result.slug}, status=${result.status}).`,
          },
        ],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  const readFileImpl =
    opts.readFileImpl ??
    (async (absPath: string) => {
      const { readFile } = await import("node:fs/promises");
      return readFile(absPath, "utf8");
    });

  const readWorkdirFile = tool(
    "readWorkdirFile",
    "Read a file from the run's ephemeral working directory. Paths outside the " +
      "working directory are refused.",
    { path: z.string().min(1) },
    async (args: Record<string, unknown>) => {
      const requested = String(args.path);
      if (!pathWithinWorkdir(opts.workdir, requested)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Refused: '${requested}' resolves outside the working-dir jail '${opts.workdir}'.`,
            },
          ],
        };
      }
      const abs = requested.startsWith("/") ? requested : `${opts.workdir}/${requested}`;
      try {
        const text = await readFileImpl(abs);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: `Could not read '${requested}': ${(err as Error).message}` }],
        };
      }
    },
  );

  return createSdkMcpServer({
    name: "seo-worker-host-tools",
    version: "1.0.0",
    tools: [persistPiece, readWorkdirFile],
  });
}

// ── The loop runner ────────────────────────────────────────────────────────────

export interface RunLoopOptions {
  /** Resolved worker env (defaults to `readWorkerEnv()`). */
  workerEnv?: WorkerEnv;
  /** The brief prompt that drives the single-drafter slice. */
  prompt: string;
  /** Wedge ceiling (acceptance #4). Defaults to 10 min. */
  timeoutMs?: number;
  /** Injectable `query` for tests; defaults to the SDK's. */
  queryImpl?: (args: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<any>;
  /** Injectable suite loader for tests; defaults to the real `loadSuite` off disk. */
  loadSuiteImpl?: (args: { kernelBaseUrl: string }) => LoadedSuite;
  /** Called with the resolved Agent-SDK session id (for host-side persistence). */
  onSessionId?: (sessionId: string) => void | Promise<void>;
  /** Called on terminal failure so the host can release the lease (acceptance #4). */
  onTerminalError?: (err: { code: string; message: string }) => void | Promise<void>;
}

export interface RunLoopResult {
  status: "completed" | "error";
  sessionId: string | null;
  terminalError: { code: string; message: string } | null;
}

/**
 * Run the autonomous brief→draft loop. Builds the run-scoped bridge + curated
 * tool surface, points the Agent SDK at the Gateway via the bearer JWT, loads the
 * `seo-blog-writer` skill, and constrains the model to the host tools only.
 *
 * Fail-closed timeout (acceptance #4): the whole loop races a wedge ceiling; on
 * timeout it emits a terminal error event + invokes `onTerminalError` so the host
 * releases the lease. No zombie microVM (the VM also carries the SDK-level
 * `timeout` from `sandbox-launch`, this is the in-process backstop).
 */
export async function runAgentLoop(opts: RunLoopOptions): Promise<RunLoopResult> {
  const workerEnv = opts.workerEnv ?? readWorkerEnv();
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;

  const bridge = createHostToolBridge({
    baseUrl: workerEnv.hostBaseUrl,
    binding: workerEnv.binding,
    bridgeJwt: workerEnv.bridgeJwt,
  });

  let sessionId: string | null = null;

  const loop = async (): Promise<RunLoopResult> => {
    const toolServer = await buildWorkerToolServer({
      bridge,
      workdir: workerEnv.workdir,
    });

    // Load the REAL seo-blog-writer SKILL.md from the vendored suite (DR-022) and
    // point its kernel host at the apps/seo /content/api contract — the skill is
    // run DIRECTLY (not re-authored) and drives the route (acceptance #2). The
    // loaded set is the single-drafter slice (PR 008).
    const suite: LoadedSuite =
      opts.loadSuiteImpl?.({ kernelBaseUrl: workerEnv.hostBaseUrl }) ??
      loadSuite({
        // appRoot defaults to process.cwd() (the worker app root /home/worker/app
        // in the image, where the Dockerfile COPYs the vendored suite — A.011.9).
        // workdir is the draft FS jail, NOT the suite root, so it is NOT passed here.
        kernelBaseUrl: workerEnv.hostBaseUrl,
        requested: [WORKER_SKILL_NAME],
      });

    let queryImpl = opts.queryImpl;
    if (!queryImpl) {
      try {
        ({ query: queryImpl } = (await import("@anthropic-ai/claude-agent-sdk")) as any);
      } catch (err) {
        throw new Error(
          "[NEEDS-DEP] @anthropic-ai/claude-agent-sdk is not installed. " +
            `Underlying error: ${(err as Error).message}`,
        );
      }
    }

    const iterator = queryImpl!({
      prompt: opts.prompt,
      options: {
        // Route ALL model traffic through the Gateway bearer seam — the SDK reads
        // ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN from the scrubbed env.
        env: {
          ANTHROPIC_BASE_URL: workerEnv.gatewayBaseUrl,
          ANTHROPIC_AUTH_TOKEN: workerEnv.bridgeJwt,
        },
        cwd: workerEnv.workdir,
        // No raw built-in tools at all (Bash/Read/Write/WebFetch removed) —
        // only the curated host-tool MCP surface is reachable ([[DR-011]]).
        tools: [],
        mcpServers: { "seo-worker-host-tools": toolServer },
        // A.011.1: the allowlist is the capability-profile's single source of
        // truth — spread the imported constant (no string literals here).
        allowedTools: [...WORKER_ALLOWED_TOOLS],
        // Load the REAL seo-blog-writer SKILL.md from the vendored suite (DR-022)
        // — COPY'd into the Sandbox image by the Dockerfile (A.011.9), so we no
        // longer rely on settingSources:["project"] resolving in the VM.
        settingSources: ["project"],
        skills: suite.skillNames,
        permissionMode: "default",
      },
    });

    for await (const message of iterator) {
      // Capture the SDK session id as soon as it appears (resume key, acceptance #1).
      const candidate = (message as any)?.session_id ?? (message as any)?.sessionId;
      if (candidate && !sessionId) {
        sessionId = String(candidate);
        await opts.onSessionId?.(sessionId);
      }
    }

    return { status: "completed", sessionId, terminalError: null };
  };

  // Race the loop against the wedge ceiling (acceptance #4).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wedge = new Promise<RunLoopResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        status: "error",
        sessionId,
        terminalError: {
          code: "WORKER_TIMEOUT",
          message: `worker loop exceeded the ${timeoutMs}ms wedge ceiling — emitting terminal error and releasing lease`,
        },
      });
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([loop(), wedge]);
    if (result.status === "error" && result.terminalError) {
      await opts.onTerminalError?.(result.terminalError);
    }
    return result;
  } catch (err) {
    const terminalError = {
      code: "WORKER_LOOP_FAILED",
      message: err instanceof Error ? err.message : String(err),
    };
    await opts.onTerminalError?.(terminalError);
    return { status: "error", sessionId, terminalError };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
