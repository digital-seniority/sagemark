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
  loadParentSkillMarkdown,
  SINGLE_DRAFTER_SKILL,
  SUITE_CHAIN,
  type LoadedSuite,
  type SuiteSkillName,
} from "./skills/load-suite";
import {
  WorkerEventEmitter,
  emitFromSdkMessage,
  createStdoutMarkerSink,
} from "./emit";

/** The skill the worker loads for the single-drafter slice (PR 008). */
export const WORKER_SKILL_NAME = SINGLE_DRAFTER_SKILL;

/**
 * The full self-revising chain the worker registers for an end-to-end run
 * (PR 014): seo-strategist -> seo-assistant -> seo-blog-writer -> seo-audit, run
 * DIRECTLY (the REAL SKILL.md files), each driving its `/content/api/*` kernel
 * route. This is the default requested set; a caller may still request the
 * single-drafter slice via `requestedSkills`.
 */
export const WORKER_CHAIN_SKILLS: readonly SuiteSkillName[] = SUITE_CHAIN;

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
  /** Optional hub run mode (absent → single-drafter default). */
  workerMode?: string;
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
  const projectId = env.RUN_PROJECT_ID?.trim() || undefined;
  const workerMode = env.WORKER_MODE?.trim() || undefined;
  return {
    gatewayBaseUrl: required("ANTHROPIC_BASE_URL"),
    bridgeJwt: required("ANTHROPIC_AUTH_TOKEN"),
    hostBaseUrl: required("SEO_HOST_BASE_URL"),
    workdir: required("WORKER_WORKDIR"),
    binding: {
      runId: required("RUN_ID"),
      workspaceId: required("RUN_WORKSPACE_ID"),
      clientId: required("RUN_CLIENT_ID"),
      ...(projectId ? { projectId } : {}),
    },
    ...(workerMode ? { workerMode } : {}),
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
      "ONLY way to save work. Tenancy and projectId are fixed by the run binding; " +
      "do not supply workspace/client/project ids. For hub pages, supply clusterRole " +
      "and funnelStage so the orchestrator can track the roadmap.",
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
      clusterRole: z
        .enum(["pillar", "cornerstone", "spoke", "faq", "checklist"])
        .optional(),
      funnelStage: z
        .enum(["awareness", "consideration", "decision", "retention"])
        .optional(),
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

  const persistStrategy = tool(
    "persistStrategy",
    "Persist the completed ContentStrategy for the bound project via the host. The " +
      "project enters 'proposed' status pending human approval. Call this ONCE after " +
      "finalising the strategy; do NOT supply workspaceId, clientId, or projectId — " +
      "those are fixed by the run binding.",
    {
      strategy: z.record(z.string(), z.unknown()),
    },
    async (args: Record<string, unknown>) => {
      const result = await opts.bridge.persistStrategy(args as any);
      return {
        content: [
          {
            type: "text",
            text: `Strategy persisted for project ${result.projectId} (status=${result.strategyStatus}). Awaiting operator approval before authoring begins.`,
          },
        ],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  const requestImages = tool(
    "requestImages",
    "Register a per-page image request for the current hub page. The host fetches a " +
      "licensed Pexels photo matching the query and returns a `[photo:<slug>]` token to " +
      "embed in the draft body — the SSR render path resolves the token to a signed URL. " +
      "Call once per hub page before persisting the draft. Do NOT supply workspaceId or clientId.",
    {
      slug: z.string().min(1).max(100),
      query: z.string().min(1).max(200),
      alt: z.string().min(1).max(300),
    },
    async (args: Record<string, unknown>) => {
      const result = await opts.bridge.requestImages(args as any);
      return {
        content: [
          {
            type: "text",
            text: `Image registered for slug=${result.slug}. Embed the token \`${result.token}\` in the draft body where the hero image should appear.`,
          },
        ],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  return createSdkMcpServer({
    name: "seo-worker-host-tools",
    version: "1.0.0",
    tools: [persistPiece, persistStrategy, requestImages, readWorkdirFile],
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
  /**
   * Which suite skills to register for this run. Defaults to the full chain
   * (`WORKER_CHAIN_SKILLS`: strategist -> assistant -> writer -> audit, PR 014).
   * Pass `[WORKER_SKILL_NAME]` for the PR 008 single-drafter slice.
   */
  requestedSkills?: readonly SuiteSkillName[];
  /** Called with the resolved Agent-SDK session id (for host-side persistence). */
  onSessionId?: (sessionId: string) => void | Promise<void>;
  /** Called on terminal failure so the host can release the lease (acceptance #4). */
  onTerminalError?: (err: { code: string; message: string }) => void | Promise<void>;
  /**
   * Per-run RICH LIVE-STREAM emitter (P-J). Each raw SDK message is translated
   * (`emitFromSdkMessage`) into coded `SseEvent`s and pushed through this emitter's
   * sink. In production the sink writes injection-safe stdout MARKERS
   * (`createStdoutMarkerSink`) the host dispatcher decodes into the live canvas
   * stream (token deltas typing in, tool rows ticking). Injectable so the Tier-1
   * test drives the translation with an in-memory sink and asserts the markers
   * WITHOUT a live SDK. When omitted, a stdout-marker emitter is built from the
   * run binding's `runId`; pass `null` to DISABLE rich streaming (lifecycle only).
   */
  streamEmitter?: WorkerEventEmitter | null;
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

  // The rich live-stream emitter (P-J). Default: a stdout-marker emitter keyed on
  // the run id — each SDK message becomes injection-safe `::worker-*::` markers the
  // host dispatcher decodes into the live canvas stream. `null` disables it (the
  // run still emits lifecycle markers from `entry.ts`); a custom emitter is the
  // Tier-1 test seam.
  const streamEmitter =
    opts.streamEmitter === null
      ? null
      : (opts.streamEmitter ?? new WorkerEventEmitter(workerEnv.binding.runId, createStdoutMarkerSink()));

  const loop = async (): Promise<RunLoopResult> => {
    const toolServer = await buildWorkerToolServer({
      bridge,
      workdir: workerEnv.workdir,
    });

    // Load the REAL suite SKILL.md files from the vendored package (DR-022) and
    // point their kernel host at the apps/seo /content/api contract — the skills
    // are run DIRECTLY (not re-authored) and drive their routes (acceptance #2).
    // The default loaded set is the FULL chain (strategist -> assistant -> writer
    // -> audit, PR 014); a caller may request the PR 008 single-drafter slice.
    const requested = opts.requestedSkills ?? WORKER_CHAIN_SKILLS;
    const suite: LoadedSuite =
      opts.loadSuiteImpl?.({ kernelBaseUrl: workerEnv.hostBaseUrl }) ??
      loadSuite({
        // appRoot defaults to process.cwd() (the worker app root /home/worker/app
        // in the image, where the Dockerfile COPYs the vendored suite — A.011.9).
        // workdir is the draft FS jail, NOT the suite root, so it is NOT passed here.
        kernelBaseUrl: workerEnv.hostBaseUrl,
        requested,
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

    // The SKILL.md drives the model as systemPrompt (DR-022). The SDK's `skills`
    // option is not wired in the CLI subprocess path (0 refs in sdk.mjs) and
    // settingSources:["project"] won't resolve in the Sandbox image. Branch on
    // workerMode: standalone hub modes use the parent + sub-skill methodology;
    // the default single-drafter path uses seo-blog-writer as before.
    const mode = workerEnv.workerMode ?? "single-drafter";
    let systemPrompt: string | undefined;
    if (mode === "standalone-strategy") {
      // Run 1: seo-strategist sub-skill + kernel addendum.
      // The parent seo-copywriter SKILL.md is intentionally NOT included here — it
      // describes the standalone static-site workflow (HTML files, Vercel deploy, etc.)
      // which is incorrect context for the in-app kernel mode. The strategist SKILL.md
      // alone drives the ContentStrategy; the kernel addendum re-interprets step 8.
      const strategistSkill = suite.skills.find((s) => s.name === "seo-strategist");
      const kernelAddendum = `## Kernel context — how to persist the strategy

You are running inside the SEO Creator web app, not the standalone CLI. In this
context, **"surface the ContentStrategy for operator approval" (step 8 of your
operating procedure) means calling the \`persistStrategy\` tool** — NOT printing
it as text. A text response alone is not persisted to the database and will be
lost; only \`persistStrategy\` records the strategy.

Once you have completed the full ContentStrategy (all sections: objective /
audience / market, topic-cluster map, competitive-gap analysis, E-E-A-T /
authorship plan, GEO/AEO + schema plan, conversion architecture, and prioritized
content roadmap), call \`persistStrategy\` **once** with a \`strategy\` object
containing the full artifact as a JSON-serialisable object. The host will save it
and set the project status to \`proposed\`, awaiting operator approval. Do not
call it until the strategy is complete and all sections are filled.`;
      const parts = [strategistSkill?.markdown, kernelAddendum].filter(Boolean) as string[];
      systemPrompt = parts.join("\n\n---\n\n");
    } else if (mode === "standalone-author") {
      // Runs 2+: self-contained hub-writer prompt — NO seo-blog-writer SKILL.md.
      //
      // The seo-blog-writer SKILL.md describes the kernel workflow where the "draft
      // route" persists automatically after the model generates. In the kernel context
      // there is no implicit persistence — the model must call `persistPiece` explicitly.
      // Using the SKILL.md causes the model to follow the kernel flow (call requestImages,
      // return article as text) without calling persistPiece, so nothing is saved.
      //
      // A self-contained prompt mirrors the pattern used for standalone-strategy:
      // explicitly say "NOT printing as text — only persistPiece records the article."
      systemPrompt = `# SEO Hub Article Writer — Kernel Mode

You are authoring **one article** for a branded content hub. The turn prompt gives
you the full page assignment: title, slug, clusterRole, funnelStage, target keyword,
and projectId. The approved ContentStrategy and project context are also in the prompt.

## Operating procedure

**Step 1 (optional) — request a hero image.** Call \`requestImages\` once with:
- \`query\`: a descriptive Pexels image search suited to the page topic
- \`slug\`: the exact slug from the assignment

**Step 2 — write the article.** Produce 1500–2500 words of grounded, accurate content:
- Open with a **self-contained quick-answer paragraph** (2–3 sentences; direct answer
  to the article's core question — AI answer engines will lift this passage)
- Every statistic traces to a **named, citable source** (e.g. "The Alzheimer's
  Association reports that..."); unsourced figures are omitted, never fabricated
- YMYL-safe framing: informational only, no diagnosis or treatment; include a short
  disclaimer near the end ("This article is for informational purposes only...")
- One \`[photo:slug]\` placeholder in the body where an image would best appear
- A structured **FAQ block** at the end: 5–7 question/answer pairs with self-contained
  answers (answers must stand alone — no "see above") for FAQPage JSON-LD

**Step 3 (required) — persist the article by calling \`persistPiece\` exactly once:**
- \`title\`: exact title from the assignment
- \`slug\`: exact slug from the assignment
- \`body\`: the complete article in **Markdown** (NOT HTML, NOT plain text)
- \`excerpt\`: 1–2 sentence summary for cards and meta
- \`metaDescription\`: 150–160 characters for search results
- \`clusterRole\`: exact value from the assignment (pillar / cornerstone / spoke / faq / checklist)
- \`funnelStage\`: exact value from the assignment
- \`projectId\`: exact value from the assignment
- \`faqData\`: array of \`{ question, answer }\` objects from the FAQ block

**CRITICAL: \`persistPiece\` is the ONLY delivery mechanism. Do NOT return the article
as text output — a text response is NOT saved to the database. The article is only
recorded when you call \`persistPiece\` with the body as a parameter. One
\`persistPiece\` call ends the run.**

## What NOT to do

- Do NOT write HTML, CSS, or JS files
- Do NOT call \`persistStrategy\`
- Do NOT revise an existing draft — this is always a NEW article
- Do NOT skip \`persistPiece\` — text output without the tool call saves nothing`;
    } else {
      // Default single-drafter: seo-blog-writer SKILL.md (back-compat, PR 008/014).
      const writerSkill = suite.skills.find((s) => s.name === "seo-blog-writer");
      systemPrompt = writerSkill?.markdown;
    }

    // Build the env the CLI subprocess will run under. The sandbox VM is created
    // with a scrubbed env (ALLOWED_ENV_KEYS only) via buildWorkerEnv, so the
    // Vercel Sandbox env parameter may replace — not merge — the base system env.
    // process.env therefore may lack HOME and PATH. Providing explicit fallbacks
    // ensures the CLI subprocess can:
    //   • find its config dir (~/.claude)   → HOME
    //   • resolve system binaries           → PATH
    //   • read TLS certs                    → NODE_EXTRA_CA_CERTS / SSL_CERT_DIR
    // We spread process.env first so any system-level vars that DO exist are kept.
    const sdkEnv: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (e): e is [string, string] => typeof e[1] === "string",
        ),
      ),
      // Explicit fallbacks: present iff the base env has them; otherwise set safe defaults.
      HOME: process.env.HOME ?? "/home/worker",
      PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      TMPDIR: process.env.TMPDIR ?? "/tmp",
    };

    const iterator = queryImpl!({
      prompt: opts.prompt,
      options: {
        // Explicit env with HOME/PATH fallbacks (see comment above). We do NOT
        // omit `env` — if process.env lacks HOME the CLI subprocess can't find
        // its config dir and exits silently with code 0 (no JSON on stdout).
        env: sdkEnv,
        // The sandbox env lacks PATH so "node" by name fails with ENOENT.
        // process.execPath is the absolute path to the Node binary already running.
        executable: process.execPath,
        cwd: workerEnv.workdir,
        // No raw built-in tools at all (Bash/Read/Write/WebFetch removed) —
        // only the curated host-tool MCP surface is reachable ([[DR-011]]).
        tools: [],
        mcpServers: { "seo-worker-host-tools": toolServer },
        // A.011.1: the allowlist is the capability-profile's single source of
        // truth — spread the imported constant (no string literals here).
        allowedTools: [...WORKER_ALLOWED_TOOLS],
        ...(systemPrompt ? { systemPrompt } : {}),
        // bypassPermissions is required for headless sandbox execution — no TTY
        // is present to accept prompts. The curated allowedTools list (above) is
        // the actual capability control; permissionMode is the session gate.
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        // Capture CLI subprocess stderr so errors appear in the worker's stdout
        // stream and are captured by sourceFromWorker's rawStderrLines logic.
        stderr: (msg: string) => {
          process.stdout.write(`::worker-cli-err:: ${msg.slice(0, 500)}\n`);
        },
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sdkResult: any = null;
    let msgCount = 0;
    for await (const message of iterator) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = message as any;
      // Capture SDK result messages (the CLI's final status frame).
      if (msg?.type === "result") sdkResult = msg;

      // Diagnostic: emit the raw SDK message shape (type, subtype, keys) so we can
      // see what the SDK is actually yielding — remove once the format is confirmed.
      msgCount++;
      process.stdout.write(
        `::worker-diag:: msg#${msgCount} type=${String(msg?.type ?? "?")} subtype=${String(msg?.subtype ?? "?")} keys=${Object.keys(msg ?? {}).join(",")}\n`,
      );

      // Capture the SDK session id as soon as it appears (resume key, acceptance #1).
      const candidate = msg?.session_id ?? msg?.sessionId;
      if (candidate && !sessionId) {
        sessionId = String(candidate);
        await opts.onSessionId?.(sessionId);
      }

      // RICH LIVE STREAM (P-J): translate the raw SDK message into coded events
      // (token deltas / thinking / tool-use rows / gate frames) and push them
      // through the emitter's sink (stdout markers in prod). A malformed/unknown
      // message yields zero events (`emitFromSdkMessage` is conservative — no
      // free-text passthrough). A translation throw must NEVER break the run, so it
      // is isolated: streaming is best-effort UX fidelity, the draft/persist path
      // is the deliverable and is independent of stdout fidelity (DR-044).
      if (streamEmitter) {
        try {
          await emitFromSdkMessage(streamEmitter, message);
        } catch {
          // swallow — a stream-translation failure never wedges the loop.
        }
      }
    }

    // Surface CLI errors from the SDK result message so they reach the SSE stream
    // instead of silently becoming a bare `done` event (the for-await loop completes
    // normally even when the CLI exits with an API error).
    if (sdkResult && sdkResult.subtype !== "success") {
      throw new Error(
        `SDK run ended with non-success result: subtype=${String(sdkResult.subtype ?? "unknown")}, ` +
          `error=${String(sdkResult.error ?? sdkResult.message ?? "none")}`,
      );
    }
    if (!sdkResult) {
      throw new Error(
        `CLI subprocess produced no result message — mode=${mode}, HOME=${sdkEnv.HOME ?? "unset"}, ` +
          `execPath=${process.execPath}, ANTHROPIC_BASE_URL=${workerEnv.gatewayBaseUrl}`,
      );
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
