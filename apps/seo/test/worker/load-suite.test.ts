/**
 * load-suite + agent-worker wiring test (PR 008 / P0.W.5).
 *
 * Proves:
 *   - `load-suite` loads the REAL seo-blog-writer SKILL.md from the vendored
 *     package (DR-022), verbatim, and points the kernel host at the apps/seo
 *     /content/api contract (AC2 — the skill drives the route, not a re-impl).
 *   - the worker loop passes the loaded skill names to the SDK + drives the draft
 *     route through the run-scoped bridge (AC2).
 *   - A.011.1: the worker's SDK `allowedTools` === `WORKER_ALLOWED_TOOLS` from the
 *     capability profile (single source of truth — no string literals).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import path from "node:path";

import { describe, it, expect, vi } from "vitest";

import {
  loadSuite,
  parseSkillName,
  assertSuiteIsKernelBacked,
  SINGLE_DRAFTER_SKILL,
  SUITE_PACKAGE_REL_ROOT,
} from "@/worker/skills/load-suite";
import { runAgentLoop, type WorkerEnv } from "@/worker/agent-worker";
import { WORKER_ALLOWED_TOOLS } from "@/worker/capability-profile";
import { KERNEL_ROUTES } from "@/lib/content/contract";

// Repo root from this test (…/apps/seo/test/worker -> up 4).
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const WORKER_ENV: WorkerEnv = {
  gatewayBaseUrl: "https://ai-gateway.vercel.sh",
  bridgeJwt: "PLACEHOLDER_RUN_JWT_not_a_real_secret",
  hostBaseUrl: "https://seo-host.example",
  workdir: "/home/worker/run-A",
  binding: {
    runId: "run-A-0001",
    workspaceId: "11111111-1111-4111-8111-111111111111",
    clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  },
};

describe("load-suite — loads the REAL SKILL.md from the vendored package (DR-022)", () => {
  it("loads seo-blog-writer's real SKILL.md verbatim off disk + confirms its identity", () => {
    const suite = loadSuite({ kernelBaseUrl: WORKER_ENV.hostBaseUrl, appRoot: REPO_ROOT });
    expect(suite.skills.length).toBe(1);
    const drafter = suite.skills[0];
    expect(drafter.name).toBe(SINGLE_DRAFTER_SKILL);
    // The loaded path is the canonical vendored package (DR-022), NOT ~/.claude.
    expect(drafter.skillPath.replace(/\\/g, "/")).toContain(SUITE_PACKAGE_REL_ROOT);
    expect(drafter.skillPath.replace(/\\/g, "/")).toMatch(/seo-blog-writer\/SKILL\.md$/);
    // The bytes are the REAL skill (front-matter name parsed from the file).
    expect(drafter.frontMatterName).toBe("seo-blog-writer");
    expect(parseSkillName(drafter.markdown)).toBe("seo-blog-writer");
    // The markdown is the authored skill (not a re-authored stub).
    expect(drafter.markdown).toMatch(/grounded draft generator/i);
    expect(drafter.markdown).toMatch(/Kernel-backed/i);
  });

  it("points the kernel host at the apps/seo /content/api draft route (AC2 — drives the route)", () => {
    const suite = loadSuite({ kernelBaseUrl: WORKER_ENV.hostBaseUrl, appRoot: REPO_ROOT });
    expect(suite.kernelBaseUrl).toBe("https://seo-host.example");
    expect(suite.kernelRoutes.draft).toBe(KERNEL_ROUTES.draft);
    expect(suite.kernelRoutes.draft).toBe("/content/api/draft");
    // AC2: the suite is kernel-backed (no markdown-drift re-implementation).
    expect(assertSuiteIsKernelBacked(suite)).toEqual([]);
  });

  it("is fail-closed: a missing skill file / unknown skill / no host throws", () => {
    expect(() => loadSuite({ kernelBaseUrl: "" } as any)).toThrow(/kernelBaseUrl/);
    expect(() =>
      loadSuite({
        kernelBaseUrl: "https://h",
        appRoot: REPO_ROOT,
        requested: ["not-a-skill" as any],
      }),
    ).toThrow(/not a known suite skill/);
    expect(() =>
      loadSuite({
        kernelBaseUrl: "https://h",
        appRoot: "/nonexistent/root",
      }),
    ).toThrow(/SKILL\.md not found/);
  });

  it("a mismatched front-matter name is refused (DR-022 identity check)", () => {
    const fakeRead = () => "---\nname: imposter\n---\nbody";
    expect(() =>
      loadSuite({
        kernelBaseUrl: "https://h",
        appRoot: REPO_ROOT,
        existsImpl: () => true,
        readFileImpl: fakeRead,
      }),
    ).toThrow(/refusing to load a mismatched skill/);
  });
});

describe("agent-worker — drives the draft route + uses the profile allowlist", () => {
  it("A.011.1: the SDK allowedTools === WORKER_ALLOWED_TOOLS (single source of truth)", async () => {
    let capturedOptions: any = null;
    const fakeQuery = (args: { prompt: string; options: any }) => {
      capturedOptions = args.options;
      return (async function* () {
        yield { session_id: "sess-1" };
      })();
    };

    // Inject the suite loader so the test does not depend on disk layout.
    const loadSuiteImpl = () => ({
      skills: [
        {
          name: SINGLE_DRAFTER_SKILL,
          skillPath: "x/SKILL.md",
          frontMatterName: SINGLE_DRAFTER_SKILL,
          markdown: "kernel-backed draft route",
        },
      ],
      kernelBaseUrl: WORKER_ENV.hostBaseUrl,
      kernelRoutes: KERNEL_ROUTES,
      skillNames: [SINGLE_DRAFTER_SKILL],
    });

    // Inject the SDK MCP server build seam so no real SDK is needed.
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      tool: (name: string, _d: string, _s: unknown, handler: any) => ({ name, handler }),
      createSdkMcpServer: (cfg: any) => cfg,
    }));

    const res = await runAgentLoop({
      workerEnv: WORKER_ENV,
      prompt: "Draft the pillar piece.",
      queryImpl: fakeQuery as any,
      loadSuiteImpl: loadSuiteImpl as any,
    });

    expect(res.status).toBe("completed");
    expect(res.sessionId).toBe("sess-1");

    // A.011.1: the allowlist passed to the SDK is EXACTLY the profile constant.
    expect(capturedOptions.allowedTools).toEqual([...WORKER_ALLOWED_TOOLS]);
    // It is the imported constant's content, not re-declared literals.
    expect(capturedOptions.allowedTools).toEqual([
      "mcp__seo-worker-host-tools__persistPiece",
      "mcp__seo-worker-host-tools__persistStrategy",
      "mcp__seo-worker-host-tools__requestImages",
      "mcp__seo-worker-host-tools__readWorkdirFile",
    ]);
    // The skill content is passed as systemPrompt (not the `skills` option — DR-022
    // explicitly says the SDK's `skills` option is not wired; skill content is
    // injected as systemPrompt so the real authored methodology reaches the model).
    expect(typeof capturedOptions.systemPrompt).toBe("string");
    expect(capturedOptions.systemPrompt).toContain("kernel-backed");
    // No raw built-in tools.
    expect(capturedOptions.tools).toEqual([]);
  });

  it("AC2: the worker persists via the host /content/api/draft route (the kernel), not a re-impl", async () => {
    // Capture the host call the persistPiece tool makes through the bridge.
    let calledUrl = "";
    let calledBody: any = null;
    const fetchImpl = vi.fn(async (url: string, init: any) => {
      calledUrl = url;
      calledBody = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({ contractVersion: "content-engine/1.0", pieceId: "p1", slug: "pillar", status: "draft" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    // The query loop "is" the model: it invokes the persistPiece tool the worker
    // exposes. We drive that tool directly to prove it targets the draft route.
    const { createHostToolBridge } = await import("@/worker/host-tool-bridge");
    const bridge = createHostToolBridge({
      baseUrl: WORKER_ENV.hostBaseUrl,
      binding: WORKER_ENV.binding,
      bridgeJwt: WORKER_ENV.bridgeJwt,
      fetchImpl: fetchImpl as any,
    });
    const result = await bridge.persistPiece({ title: "Pillar", slug: "pillar", body: "## H\n\nbody\n" });

    expect(result.pieceId).toBe("p1");
    // The skill drives the apps/seo draft ROUTE (the kernel) — not a DB / provider.
    expect(calledUrl).toBe(`${WORKER_ENV.hostBaseUrl}${KERNEL_ROUTES.draft}`);
    expect(calledUrl).not.toMatch(/supabase|anthropic/i);
    // Tenancy was injected from the binding, never the model.
    expect(calledBody.workspaceId).toBe(WORKER_ENV.binding.workspaceId);
    expect(calledBody.clientId).toBe(WORKER_ENV.binding.clientId);
  });
});
