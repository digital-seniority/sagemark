# DR-011 — no-shell-worker-workdir-scoped-file-tool

**Date:** 2026-06-25
**Run:** manual remediation (post-#004, P0.W.1 live Sandbox run)
**Status:** active
**Build phase:** Phase 0 — Foundations

## Context

The P0.W.1 spike's fs-constraint probe (control 3) initially recorded a **FAIL** on real
Sandbox infra: from inside the VM, raw shell read `/etc/shadow`, `/proc/1/environ`, an
absolute path, a `../` traversal out of the workdir, and a planted same-VM "sibling-run"
marker — all readable.

Two facts from the live run (`RESULTS.md`):
1. **This is NOT a cross-tenant bleed.** Each run is its own Firecracker microVM; the
   "sibling" marker was planted by the probe on the *same* VM (real siblings are different,
   physically unreachable VMs). The reads hit the VM's *own* ephemeral filesystem.
2. **A VM-level shell jail is unachievable on a stock Sandbox VM.** The run executes as a
   non-root user (`uid=1000(vercel-sandbox)`), but the base image is permissive
   (`/etc/shadow` is readable by that uid) and there is no chroot/bind-mount available to an
   unprivileged run. So "deny out-of-workdir reads at the VM" cannot be the control.

The threat is real nonetheless: if the worker handed the model a general `bash`/`cat`
tool, the model (or a prompt-injection through ingested content) could read anything on the
VM — including a future run's secrets staged on the same VM. The RFC §3.4-layer-5 control
("the loop runs jailed to its ephemeral workdir; out-of-jail reads must fail") must
therefore be enforced at the **tool layer**, not the VM layer.

## Options considered

- **Option A (chosen): no-shell-capable worker + workdir-scoped file tool.** The Agent-SDK
  worker exposes NO general shell/arbitrary-file tool to the model. The only filesystem
  read is a workdir-scoped tool (`readViaWorkdirTool`) that resolves the requested path
  (handling `..`/absolute via `pathWithinWorkdir`) and **refuses anything outside the run's
  ephemeral workdir before touching the filesystem.** Proven on the live run: all 7
  out-of-jail paths refused at the tool layer; the in-jail file still reads → control 3
  **PASS**. Reference impl landed in the spike `_harness.ts`.
  - Pros: enforceable on a stock Sandbox VM with no privileged ops; deterministic; the
    raw-shell threat is removed by construction (no shell tool exists for the model to call).
  - Cons: the worker's internal code still has shell access (it uses `runCommand`
    internally) — so the control depends on the tool allowlist being correct and on the
    worker never proxying arbitrary model-supplied commands to a shell. Enforced by the
    boot-refusal `fsJailed` evidence (below) + code review of the tool surface.
- **Option B: OS-level jail (chroot / drop to a locked-down user / bind-mount).** Rejected
  for v1: not achievable for an unprivileged run on the stock image; would require a custom
  snapshot and privileged boot. Revisit if a hardened base image is adopted.
- **Option C: accept the unconstrained shell (per-VM isolation "is enough").** Rejected:
  within a single run/VM the model could still read anything staged there, and the safety
  model's #1 agency-ending risk (voice/spec bleed) is a same-VM concern when multiple
  artifacts share a run.

## Decision

The v1 worker is **no-shell-capable**: the model's tool surface contains **no raw
shell / arbitrary-file tool**; filesystem access is mediated by a **workdir-scoped read
(and write) tool** that refuses out-of-jail paths at the tool layer. The boot-refusal
launcher's `fsJailed` evidence = "the worker tool allowlist exposes no raw shell AND the
workdir-scoped tool refuses an out-of-jail probe path"; a worker that fails this is
**refused at boot** (control 4). Reference impl: `readViaWorkdirTool` + `pathWithinWorkdir`
in `apps/seo/spike/capability-enforcement/_harness.ts`.

## Consequences

- **PR 006 / PR 006b** build the worker's Agent-SDK tool surface from this contract: a
  curated allowlist (Gateway calls, the grounding search, the workdir-scoped file tool, the
  bridge/JWT) and explicitly NO `bash`/exec tool exposed to the model. 006b's adversarial
  confinement tests re-run the fs-constraint probe's Phase B against the real worker tools.
- The workdir-scoped tool is the single chokepoint for file I/O; any feature needing broader
  access is a deliberate, reviewed change (not an ambient capability).
- Carries a residual: the worker process retains shell access for its own orchestration —
  it must never execute model-authored command strings. Flag for PR 006b review + a lint/
  test that no model-reachable tool shells out.

Links: [[DR-010]] (egress hardening — control 1), [[DR-002]] (spike held open / human-gated),
[[DR-003]] (auth placeholder seam — tenancy not yet enforced).
