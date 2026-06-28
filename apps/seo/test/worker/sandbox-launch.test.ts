/**
 * Sandbox launcher + host-tool bridge — Tier-1 (no infra).
 *
 * Covers the unit-testable halves of acceptance #2/#3/#5/#6:
 *   #6 — capability-profile-APPLIED + fail-closed BOOT-REFUSAL (the spike's
 *        `assertControlsOrRefuse` truth table, re-run against the real launcher);
 *        env-scrub catches ambient-secret residue; the egress allowlist is the
 *        real SDK `networkPolicy` shape.
 *   #3 — the bridge bearer token scopes exactly one (workspace, client, run): a
 *        client-A bridge cannot be pointed at client B; model-supplied tenancy is
 *        refused; a host 401/403 surfaces as a typed auth rejection.
 *   #2 — `persistPiece` is the only mutation path; tenancy is injected from the
 *        binding, never the model.
 *   #5 — warm-VM working-dir-wipe-on-handoff logic.
 *
 * The live Sandbox bring-up (real microVM, real iptables/MMDS, real serpFetch ->
 * runScorers -> runGate -> persistPiece) is Tier-2 — see the PR report's
 * NEEDS-INPUT run steps. Here we inject fakes for the SDK + control probes so the
 * launcher's DECISION logic is exercised in isolation (mirrors how the spike's
 * boot-refusal probe tests the gate without a VM).
 */

import { describe, it, expect, vi } from "vitest";

import {
  assertControlsOrRefuse,
  BootRefusedError,
  buildWorkerEnv,
  scanEnvForSecrets,
  networkPolicyFor,
  pathWithinWorkdir,
  proveFsJail,
  wipeForHandoff,
  launchSandbox,
  type ControlEvidence,
  type LaunchProfile,
} from "@/worker/sandbox-launch";
import {
  createHostToolBridge,
  HostToolBridge,
  TenancyScopeError,
  HostToolAuthError,
  type RunBinding,
} from "@/worker/host-tool-bridge";

const BINDING_A: RunBinding = {
  runId: "run-A-0001",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};
const BINDING_B: RunBinding = {
  runId: "run-B-0002",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};

function profile(over: Partial<LaunchProfile> = {}): LaunchProfile {
  return {
    binding: BINDING_A,
    egressAllowlist: ["ai-gateway.vercel.sh", "seo-host.example"],
    bridgeJwt: "PLACEHOLDER_RUN_JWT_not_a_real_secret",
    gatewayBaseUrl: "https://ai-gateway.vercel.sh",
    hostBaseUrl: "https://seo-host.example",
    workdir: "/home/worker/run",
    timeoutMs: 120_000,
    ...over,
  };
}

const ALL_GOOD: ControlEvidence = {
  egressEnforced: true,
  envScrubbed: true,
  fsJailed: true,
  runJwtPresent: true,
};

// ── #6: boot-refusal truth table (the spike contract, real launcher) ──────────

describe("boot refusal — acceptance #6 fail-closed", () => {
  it("REFUSES when any single control is not in force", () => {
    expect(() => assertControlsOrRefuse({ ...ALL_GOOD, egressEnforced: false })).toThrow(BootRefusedError);
    expect(() => assertControlsOrRefuse({ ...ALL_GOOD, envScrubbed: false })).toThrow(BootRefusedError);
    expect(() => assertControlsOrRefuse({ ...ALL_GOOD, fsJailed: false })).toThrow(BootRefusedError);
    expect(() => assertControlsOrRefuse({ ...ALL_GOOD, runJwtPresent: false })).toThrow(BootRefusedError);
  });

  it("REFUSES when several controls are broken at once (first failure wins)", () => {
    expect(() =>
      assertControlsOrRefuse({
        egressEnforced: false,
        envScrubbed: false,
        fsJailed: false,
        runJwtPresent: true,
      }),
    ).toThrow(BootRefusedError);
  });

  it("ALLOWS only when every control is proven (positive control)", () => {
    expect(() => assertControlsOrRefuse(ALL_GOOD)).not.toThrow();
  });

  it("names the failing control on the refusal", () => {
    try {
      assertControlsOrRefuse({ ...ALL_GOOD, fsJailed: false });
      throw new Error("should have refused");
    } catch (err) {
      expect(err).toBeInstanceOf(BootRefusedError);
      expect((err as BootRefusedError).control).toBe("fs-jail");
    }
  });
});

// ── #6: env scrub ──────────────────────────────────────────────────────────────

describe("env scrub — acceptance #6 no ambient secrets", () => {
  it("a clean worker env carries only the allowlisted keys (no offenders)", () => {
    expect(scanEnvForSecrets(buildWorkerEnv(profile()))).toEqual([]);
  });

  it("flags a Supabase service-role key as an offender", () => {
    const env = { ...buildWorkerEnv(profile()), SUPABASE_SERVICE_ROLE_KEY: "svc.role.key" };
    expect(scanEnvForSecrets(env)).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("flags a raw provider key (worker must use a bearer token only)", () => {
    const env = { ...buildWorkerEnv(profile()), ANTHROPIC_API_KEY: "sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx" };
    expect(scanEnvForSecrets(env)).toContain("ANTHROPIC_API_KEY");
  });

  it("flags a renamed/unknown key carrying a secret-shaped value", () => {
    const env = { ...buildWorkerEnv(profile()), SNEAKY: "AKIA0123456789ABCDEFGHIJKLMNOP" };
    expect(scanEnvForSecrets(env)).toContain("SNEAKY");
  });

  it("the built env never contains a raw provider key by construction", () => {
    expect(buildWorkerEnv(profile()).ANTHROPIC_API_KEY).toBeUndefined();
    // The bearer token IS present (the worker's one credential).
    expect(buildWorkerEnv(profile()).ANTHROPIC_AUTH_TOKEN).toBeTruthy();
  });
});

// ── #6: egress allowlist is the real SDK shape ────────────────────────────────

describe("egress policy — acceptance #6 default-deny allowlist", () => {
  it("builds a default-deny networkPolicy that allows only the profile hosts + denies private subnets", () => {
    const pol = networkPolicyFor(profile()) as { allow: string[]; subnets: { deny: string[] } };
    expect(pol.allow).toEqual(["ai-gateway.vercel.sh", "seo-host.example"]);
    expect(pol.subnets.deny).toContain("169.254.0.0/16");
  });
});

// ── #6: fs jail (workdir-scoped, [[DR-011]]) ──────────────────────────────────

describe("fs jail — acceptance #6 / DR-011 workdir-scoped", () => {
  it("refuses out-of-jail paths and allows in-jail paths", () => {
    const wd = "/home/worker/run";
    expect(pathWithinWorkdir(wd, "/etc/shadow")).toBe(false);
    expect(pathWithinWorkdir(wd, "../sibling-run/secret")).toBe(false);
    expect(pathWithinWorkdir(wd, `${wd}/../escape`)).toBe(false);
    expect(pathWithinWorkdir(wd, "draft.md")).toBe(true);
    expect(pathWithinWorkdir(wd, `${wd}/sub/note.md`)).toBe(true);
  });

  it("proveFsJail returns true (out refused, in allowed)", () => {
    expect(proveFsJail("/home/worker/run")).toBe(true);
  });
});

// ── #6: launcher applies the profile and refuses on a missing control ─────────

describe("launchSandbox — acceptance #6 profile applied + fail-closed", () => {
  function fakeSandbox(networkPolicy: unknown) {
    return {
      networkPolicy,
      runCommand: vi.fn(async () => ({ exitCode: 0, stdout: async () => "HTTPCODE=000", stderr: async () => "" })),
      stop: vi.fn(async () => undefined),
    };
  }

  it("provisions, proves every control, and returns a verified sandbox + lease", async () => {
    const sb = fakeSandbox({ allow: ["ai-gateway.vercel.sh", "seo-host.example"], subnets: { deny: ["169.254.0.0/16"] } });
    const result = await launchSandbox(profile(), {
      loadSandboxImpl: async () => ({ create: async () => sb as never }),
      hardenImpl: async () => ({ mmdsBlocked: true }),
    });
    expect(result.evidence).toEqual(ALL_GOOD);
    expect(result.lease.binding).toEqual(BINDING_A);
    expect(result.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("REFUSES to boot + tears down when the MMDS block does not take (egress unprovable)", async () => {
    const sb = fakeSandbox({ allow: ["ai-gateway.vercel.sh"], subnets: { deny: ["169.254.0.0/16"] } });
    await expect(
      launchSandbox(profile(), {
        loadSandboxImpl: async () => ({ create: async () => sb as never }),
        hardenImpl: async () => ({ mmdsBlocked: false }),
      }),
    ).rejects.toBeInstanceOf(BootRefusedError);
    expect(sb.stop).toHaveBeenCalled();
  });

  it("REFUSES to boot when the sandbox booted allow-all (networkPolicy read-back failed)", async () => {
    const sb = fakeSandbox("allow-all");
    await expect(
      launchSandbox(profile(), {
        loadSandboxImpl: async () => ({ create: async () => sb as never }),
        hardenImpl: async () => ({ mmdsBlocked: true }),
      }),
    ).rejects.toBeInstanceOf(BootRefusedError);
  });

  it("REFUSES to boot when the env carries an ambient secret", async () => {
    const sb = fakeSandbox({ allow: ["ai-gateway.vercel.sh", "seo-host.example"], subnets: { deny: ["169.254.0.0/16"] } });
    await expect(
      launchSandbox(profile(), {
        loadSandboxImpl: async () => ({ create: async () => sb as never }),
        hardenImpl: async () => ({ mmdsBlocked: true }),
        scanEnvImpl: () => ["SUPABASE_SERVICE_ROLE_KEY"], // simulate a leak
      }),
    ).rejects.toBeInstanceOf(BootRefusedError);
  });
});

// ── #5: warm-VM working-dir wipe on handoff ───────────────────────────────────

describe("wipeForHandoff — acceptance #5 warm-pool residue", () => {
  it("wipes the working dir and restarts the claude subprocess on lease handoff", async () => {
    const calls: string[] = [];
    const sb = {
      runCommand: vi.fn(async ({ args }: { args: string[] }) => {
        const script = args[args.length - 1];
        calls.push(script);
        // First call = wipe (ls | wc -l → 0 remaining); second = restart (echo restarted).
        const stdout = script.includes("restarted") ? "restarted\n" : "0\n";
        return { exitCode: 0, stdout: async () => stdout, stderr: async () => "" };
      }),
    };
    const res = await wipeForHandoff(sb as never, "/home/worker/run");
    expect(res.workdirWiped).toBe(true);
    expect(res.subprocessRestarted).toBe(true);
    // The wipe targeted the workdir; the restart killed the claude process.
    expect(calls.some((c) => c.includes("rm -rf /home/worker/run"))).toBe(true);
    expect(calls.some((c) => c.includes("pkill -f claude"))).toBe(true);
  });
});

// ── #2/#3: bridge tenancy scoping ─────────────────────────────────────────────

describe("host-tool-bridge — acceptance #3 token scopes exactly one (workspace, client, run)", () => {
  it("requires a complete binding + a JWT at construction (fail-closed)", () => {
    expect(() =>
      createHostToolBridge({ baseUrl: "https://h", binding: BINDING_A, bridgeJwt: "" }),
    ).toThrow(/per-run bridge JWT/);
    expect(() =>
      createHostToolBridge({
        baseUrl: "https://h",
        binding: { runId: "", workspaceId: "", clientId: "" },
        bridgeJwt: "jwt",
      }),
    ).toThrow(/complete .* binding/);
  });

  it("freezes the binding — a client-A bridge always sends client-A tenancy, never client B", async () => {
    const seen: { workspaceId: string; clientId: string }[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      seen.push({ workspaceId: body.workspaceId, clientId: body.clientId });
      return new Response(
        JSON.stringify({ contractVersion: "content-engine/1.1", pieceId: "p1", slug: "s", status: "draft" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const bridgeA = new HostToolBridge({
      baseUrl: "https://seo-host.example",
      binding: BINDING_A,
      bridgeJwt: "jwt-A",
      fetchImpl: fetchImpl as never,
    });
    await bridgeA.persistPiece({ title: "T", slug: "t", body: "## H\n\nbody\n" });
    expect(seen[0]).toEqual({ workspaceId: BINDING_A.workspaceId, clientId: BINDING_A.clientId });
    // The binding is read-only — there is no setter to repoint it at client B.
    expect(bridgeA.runBinding).toEqual(BINDING_A);
    expect(bridgeA.runBinding.clientId).not.toBe(BINDING_B.clientId);
  });

  it("sends the per-run bearer JWT + contract-version handshake on every call", async () => {
    let headers: Headers | undefined;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      headers = new Headers(init.headers);
      return new Response(
        JSON.stringify({ contractVersion: "content-engine/1.1", pieceId: "p1", slug: "s", status: "draft" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const bridge = new HostToolBridge({
      baseUrl: "https://seo-host.example",
      binding: BINDING_A,
      bridgeJwt: "jwt-A",
      fetchImpl: fetchImpl as never,
    });
    await bridge.persistPiece({ title: "T", slug: "t", body: "## H\n\nbody\n" });
    expect(headers!.get("authorization")).toBe("Bearer jwt-A");
    expect(headers!.get("x-content-contract-version")).toBe("content-engine/1.1");
    expect(headers!.get("x-client-id")).toBe(BINDING_A.clientId);
  });

  it("refuses model-supplied tenancy (the model cannot widen scope)", async () => {
    const bridge = new HostToolBridge({
      baseUrl: "https://seo-host.example",
      binding: BINDING_A,
      bridgeJwt: "jwt-A",
      fetchImpl: vi.fn() as never,
    });
    await expect(
      // @ts-expect-error — deliberately injecting forbidden tenancy
      bridge.persistPiece({ title: "T", slug: "t", body: "b", clientId: BINDING_B.clientId }),
    ).rejects.toBeInstanceOf(TenancyScopeError);
  });

  it("a client-A token rejected by the host (403) surfaces as a typed auth rejection (acceptance #3)", async () => {
    // Models the host's server-side `assertTenancyMatch` 403 when a token is
    // presented for the wrong tenancy — the bridge does not fabricate success.
    const fetchImpl = vi.fn(async () => new Response("forbidden", { status: 403 }));
    const bridge = new HostToolBridge({
      baseUrl: "https://seo-host.example",
      binding: BINDING_A,
      bridgeJwt: "jwt-A",
      fetchImpl: fetchImpl as never,
    });
    await expect(
      bridge.persistPiece({ title: "T", slug: "t", body: "## H\n\nbody\n" }),
    ).rejects.toBeInstanceOf(HostToolAuthError);
  });
});
