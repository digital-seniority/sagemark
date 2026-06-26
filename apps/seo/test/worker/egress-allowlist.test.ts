/**
 * Egress allowlist confinement — PR 006b / P0.W.3, acceptance #1.
 *
 * The worker can reach ONLY the Claude API/Gateway endpoint(s) and the apps/seo
 * host-tool bridge URL. Every other host — arbitrary public hosts, RFC-1918
 * private ranges, and the `169.254.169.254` cloud-metadata IP — is refused at the
 * NETWORK layer (default-deny `networkPolicy` allowlist + an in-VM iptables DROP
 * on the link-local MMDS range, [[DR-010]]), NOT merely because no tool exposes a
 * raw fetch.
 *
 * TIER 1 (this file, runs here): the egress CONTROL CONSTRUCTION is unit-tested
 * against the real SDK `networkPolicy` shape — the default-deny allowlist permits
 * only the profile hosts, the private/link-local subnets are denied, the MMDS
 * range is the in-VM DROP target, and the read-back gate refuses an allow-all VM.
 * A simulated "curl from inside the worker to a non-allowlisted host" is driven
 * through the same default-deny decision the SDK enforces and asserted to fail.
 *
 * TIER 2/3 (live Sandbox) — NEEDS-INPUT: the real microVM run (actual iptables /
 * MMDS turning `401` → timeout, a real `curl` from inside the VM to an
 * off-allowlist host getting a TCP reset / DNS denial) requires live Vercel-
 * Sandbox infra not available in this worktree. PR 000 already proved this on real
 * VMs (`apps/seo/spike/capability-enforcement/RESULTS.md`, egress PASS after the
 * MMDS remediation, [[DR-010]]); the live re-run steps are in the PR report.
 */

import { describe, it, expect, vi } from "vitest";

import {
  networkPolicyFor,
  policyReflectsAllowlist,
  DENY_CIDRS,
  LINK_LOCAL_CIDR,
  hardenSandbox,
  launchSandbox,
  BootRefusedError,
  type LaunchProfile,
} from "@/worker/sandbox-launch";
import type { RunBinding } from "@/worker/host-tool-bridge";

const BINDING: RunBinding = {
  runId: "run-egress-0001",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

const GATEWAY_HOST = "ai-gateway.vercel.sh";
const HOST_BRIDGE_HOST = "seo-host.example";

function profile(over: Partial<LaunchProfile> = {}): LaunchProfile {
  return {
    binding: BINDING,
    egressAllowlist: [GATEWAY_HOST, HOST_BRIDGE_HOST],
    bridgeJwt: "PLACEHOLDER_RUN_JWT_not_a_real_secret",
    gatewayBaseUrl: `https://${GATEWAY_HOST}`,
    hostBaseUrl: `https://${HOST_BRIDGE_HOST}`,
    workdir: "/home/worker/run",
    timeoutMs: 120_000,
    ...over,
  };
}

/**
 * Model the SDK default-deny `networkPolicy` decision: a destination host is
 * permitted ONLY if it is on the `allow` set; a destination IP is denied if it
 * falls in any `subnets.deny` CIDR (subnet-deny takes precedence). This mirrors
 * the platform's egress decision so a "curl from inside the worker" can be driven
 * deterministically in Tier 1.
 */
function ipv4InCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const toInt = (a: string) =>
    a.split(".").reduce((acc, oct) => (acc << 8) + (Number(oct) & 0xff), 0) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(range) & mask);
}

function isIpv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/** True == the egress would be PERMITTED by the default-deny policy. */
function egressPermitted(policy: ReturnType<typeof networkPolicyFor>, host: string): boolean {
  if (policy === "allow-all") return true;
  if (policy === "deny-all") return false;
  const denyCidrs = policy.subnets?.deny ?? [];
  if (isIpv4(host) && denyCidrs.some((c) => ipv4InCidr(host, c))) return false; // subnet-deny precedence
  const allow = Array.isArray(policy.allow) ? policy.allow : [];
  return allow.includes(host);
}

describe("egress allowlist — acceptance #1 default-deny networkPolicy", () => {
  it("permits ONLY the Gateway + host-bridge hosts (everything else default-denied)", () => {
    const pol = networkPolicyFor(profile());
    expect(egressPermitted(pol, GATEWAY_HOST)).toBe(true);
    expect(egressPermitted(pol, HOST_BRIDGE_HOST)).toBe(true);
    // Non-allowlisted public hosts are refused at the network layer.
    expect(egressPermitted(pol, "evil.example.com")).toBe(false);
    expect(egressPermitted(pol, "api.anthropic.com")).toBe(false); // raw provider endpoint — Gateway-only ([[DR-016]])
    expect(egressPermitted(pol, "supabase.co")).toBe(false);
  });

  it("refuses the cloud-metadata IP 169.254.169.254 at the subnet layer", () => {
    const pol = networkPolicyFor(profile());
    expect(egressPermitted(pol, "169.254.169.254")).toBe(false);
  });

  it("refuses RFC-1918 private ranges (IP-literal egress cannot bypass the allowlist)", () => {
    const pol = networkPolicyFor(profile());
    expect(egressPermitted(pol, "10.0.0.5")).toBe(false);
    expect(egressPermitted(pol, "172.16.10.10")).toBe(false);
    expect(egressPermitted(pol, "192.168.1.1")).toBe(false);
  });

  it("declares the private/link-local deny CIDRs + the MMDS DROP range", () => {
    expect(DENY_CIDRS).toContain("169.254.0.0/16");
    expect(DENY_CIDRS).toContain("10.0.0.0/8");
    expect(DENY_CIDRS).toContain("172.16.0.0/12");
    expect(DENY_CIDRS).toContain("192.168.0.0/16");
    // The in-VM iptables DROP target ([[DR-010]]) is the link-local MMDS range.
    expect(LINK_LOCAL_CIDR).toBe("169.254.0.0/16");
  });

  it("read-back gate rejects an allow-all VM (a dropped policy is NOT a default-deny allowlist)", () => {
    expect(policyReflectsAllowlist("allow-all", profile())).toBe(false);
    expect(policyReflectsAllowlist(undefined, profile())).toBe(false);
    // A custom allowlist with a non-empty allow set IS a default-deny allowlist.
    expect(policyReflectsAllowlist(networkPolicyFor(profile()), profile())).toBe(true);
  });
});

// ── In-VM MMDS DROP read-back ([[DR-010]]) ─────────────────────────────────────

describe("in-VM MMDS hardening — acceptance #1 ([[DR-010]])", () => {
  it("issues the link-local iptables DROP and PROVES the MMDS no longer answers", async () => {
    const ran: { cmd: string; args: string[]; sudo?: boolean }[] = [];
    const sandbox = {
      runCommand: vi.fn(async (c: { cmd: string; args: string[]; sudo?: boolean }) => {
        ran.push(c);
        // The MMDS probe times out after the DROP — curl exits non-zero, http=000.
        if (c.cmd === "curl") return { exitCode: 28, stdout: async () => "HTTPCODE=000", stderr: async () => "" };
        return { exitCode: 0, stdout: async () => "", stderr: async () => "" };
      }),
    };
    const res = await hardenSandbox(sandbox as never);
    expect(res.mmdsBlocked).toBe(true);
    // The DROP rule targeted the link-local range, applied with sudo.
    const drop = ran.find((c) => c.cmd === "iptables");
    expect(drop?.args).toEqual(["-A", "OUTPUT", "-d", LINK_LOCAL_CIDR, "-j", "DROP"]);
    expect(drop?.sudo).toBe(true);
  });

  it("reports the block did NOT take when the MMDS still answers (e.g. 401) — feeds boot refusal", async () => {
    const sandbox = {
      runCommand: vi.fn(async (c: { cmd: string }) => {
        if (c.cmd === "curl") return { exitCode: 0, stdout: async () => "HTTPCODE=401", stderr: async () => "" };
        return { exitCode: 0, stdout: async () => "", stderr: async () => "" };
      }),
    };
    const res = await hardenSandbox(sandbox as never);
    expect(res.mmdsBlocked).toBe(false);
  });
});

// ── A non-allowlisted connection refuses the launch (fail-closed) ──────────────

describe("egress is a BOOT gate — acceptance #1/#5 fail-closed", () => {
  function fakeSandbox(networkPolicy: unknown) {
    return {
      networkPolicy,
      runCommand: vi.fn(async () => ({ exitCode: 0, stdout: async () => "HTTPCODE=000", stderr: async () => "" })),
      stop: vi.fn(async () => undefined),
    };
  }

  it("REFUSES to boot when the VM booted allow-all (egress not provably default-deny)", async () => {
    const sb = fakeSandbox("allow-all");
    await expect(
      launchSandbox(profile(), {
        loadSandboxImpl: async () => ({ create: async () => sb as never }),
        hardenImpl: async () => ({ mmdsBlocked: true }),
      }),
    ).rejects.toBeInstanceOf(BootRefusedError);
    expect(sb.stop).toHaveBeenCalled();
  });

  it("REFUSES to boot when the MMDS block does not take (the metadata surface stays reachable)", async () => {
    const sb = fakeSandbox(networkPolicyFor(profile()));
    await expect(
      launchSandbox(profile(), {
        loadSandboxImpl: async () => ({ create: async () => sb as never }),
        hardenImpl: async () => ({ mmdsBlocked: false }),
      }),
    ).rejects.toBeInstanceOf(BootRefusedError);
  });

  it("BOOTS only when both the allowlist read-back AND the MMDS block are proven", async () => {
    const sb = fakeSandbox(networkPolicyFor(profile()));
    const res = await launchSandbox(profile(), {
      loadSandboxImpl: async () => ({ create: async () => sb as never }),
      hardenImpl: async () => ({ mmdsBlocked: true }),
    });
    expect(res.evidence.egressEnforced).toBe(true);
  });
});
