# DR-010 — egress-hardening-in-vm-mmds-block

**Date:** 2026-06-25
**Run:** manual remediation (post-#004, P0.W.1 live Sandbox run)
**Status:** active
**Build phase:** Phase 0 — Foundations

## Context

The P0.W.1 capability-enforcement spike (PR #3) ran its four adversarial probes on
real Vercel Sandbox (Firecracker) microVMs on the Digital Seniority team. The egress
control (control 1) initially recorded a **FAIL**: every genuine off-VM destination was
correctly refused at the network layer by the SDK `networkPolicy` default-deny allowlist
(RFC-1918 → TCP reset; arbitrary public → DNS denied; allowlisted Gateway host reachable),
but `169.254.169.254` connected and returned `HTTP 401`.

Characterization (5/5 deterministic, recorded in `RESULTS.md`): that address is the
**Firecracker MMDS** (`Server: Firecracker API`), answered **locally by the hypervisor**
in ~0.3 ms — it never leaves the VM, so the SDK `networkPolicy.subnets.deny` (an *egress*
control) cannot refuse it. It is token-gated (`401 "No MMDS token provided"` on both the
metadata root and the IAM-credentials path; **no credentials disclosed**). So it is not a
credential-exfiltration path, but it IS a reachable-but-locked metadata surface, and the
worker safety model (RFC §2/§3.4-layer-5) requires the worker reach ONLY the metered
Gateway + the grounding host.

## Options considered

- **Option A (chosen): in-VM `iptables` DROP on the link-local range at boot.**
  `iptables -A OUTPUT -d 169.254.0.0/16 -j DROP` (sudo), applied by `sandbox-launch` before
  the loop starts, with a read-back proof (MMDS curl must time out, not 401). Proven on the
  live run: `iptables` is present in the base image, the rule applies (even as the non-root
  `vercel-sandbox` run user, via sudo), and the MMDS reach goes `401` → `curl (28) timeout`.
  - Pros: closes the only residual; pure in-VM, no platform dependency; verifiable at boot
    (fail-closed — the launcher refuses to start if the block did not take).
  - Cons: relies on `iptables` being present + sudo working in the worker image (both
    confirmed); a defense-in-depth layer on top of the platform's token gate.
- **Option B: rely on the MMDS token gate alone (accept reachable-but-locked).** Rejected:
  leaves a metadata surface reachable from the same process tree as the model; the safety
  model wants network-layer denial, and the cost of Option A is trivial.
- **Option C: only block the IP literal in the domain allowlist.** Rejected: a domain
  allowlist cannot express a hypervisor-local link-local responder; `subnets.deny` already
  fails to cover it, which is the whole finding.

Also note: the in-VM DROP is scoped to `169.254.0.0/16` ONLY — NOT the RFC-1918 ranges.
The `networkPolicy` already refuses those at the platform layer, and an in-VM `/8` DROP
risks the DNS resolver / gateway if either sits in a private range. (A separate spike bug
— `DENY_CIDRS` listing the unaligned `192.168.0.0/8`, which the API rejects with `400` —
was fixed to `192.168.0.0/16` in the same PR.)

## Decision

The worker egress control = **SDK `networkPolicy` default-deny allowlist (Gateway + DDG)
+ an in-VM `iptables` DROP on `169.254.0.0/16` applied at boot, verified before the loop
starts.** `sandbox-launch` (PR 006) implements `hardenSandbox` (reference impl landed in
`apps/seo/spike/capability-enforcement/_harness.ts`) and treats a failed/unverifiable block
as a **boot refusal** (control 4). Re-run verdict: egress **PASS** (all six forbidden
refused, allowlist reachable).

## Consequences

- **PR 006 (P0.W.2 worker host)** must run the MMDS block in `sandbox-launch` preflight and
  feed its read-back result into the boot-refusal `egressEnforced` evidence.
- If a future base image lacks `iptables` or disallows sudo, the launcher fails closed
  (refuses boot) rather than running with a reachable MMDS — surface as a Tier-3 follow-up.
- Cleaner alternative if Vercel later exposes an MMDS-disable create option: prefer it and
  drop the iptables step; revisit then.

Links: [[DR-002]] (spike held open / human-gated), [[DR-011]] (no-shell worker — control 3).
