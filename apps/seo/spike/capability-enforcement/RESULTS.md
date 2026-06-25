# PR 000 — Capability-enforcement spike · RESULTS & decision

> **Architecture gate** for the SEO Creator worker runtime (engineering-rfc.md →
> "### PR 000"). This is a **de-risking spike**: it ships no production runtime.
> Its job is to prove or falsify, *on real Vercel Sandbox infra*, that the
> Sandbox + Claude Agent SDK can enforce the four runtime controls the worker
> safety model (RFC §2 / §3.4) rests on — **before** PR 006/006b lock the worker
> topology.

---

## ⛔ STATUS: PENDING LIVE RUN — Tier-3 NEEDS-INPUT

**The four per-control verdicts below are NOT YET RECORDED because the real
adversarial run on Vercel Sandbox has not been executed.** This spike was
authored in an environment with **no access to provision or run a live Vercel
Sandbox** (no Sandbox project, no infra credentials). Per the spec's own Tier-3
path, the honest outcome is: the probes are **written, type-clean, and runnable**,
the **decision framework + fallback tree are fixed**, and the **live execution is
explicitly deferred** to whoever runs them on real infra. **No control verdict
has been fabricated. A control is "confirmed" only after the live run records it
here.**

What IS done (✅):
- All four probe scripts written as real, runnable adversarial probes.
- `boot-refusal-probe.ts` executed locally (needs no infra) → **PASS** (refuses
  every broken-control profile, allows the valid one).
- All five spike `.ts` files typecheck clean under the project's strict tsconfig
  (`strict` + `noUncheckedIndexedAccess`, `moduleResolution: Bundler`).
- The fallback-runtime decision tree (below) is fixed, so PR 006/006b have the
  contingency even before the live run.

What is NEEDS-INPUT (the live run):
- Controls **1 (egress)**, **2 (env scrub)**, **3 (fs constraint)** require a
  live Sandbox target to record PASS/FAIL. Their verdict cells read
  `PENDING LIVE RUN`.
- Control **4 (boot refusal)** logic passes locally, but its **live wiring** to
  the real `sandbox-launch` preflight (re-running the broken profiles against the
  actual launcher) is part of the live run.

**This gate is not closed until the table below is filled by a real run.**

---

## Verdict table (to be completed by the live run)

| # | Control | Probe | Verdict | Recorded by / when |
|---|---------|-------|---------|--------------------|
| 1 | Network egress allowlist | `egress-probe.ts` | `PENDING LIVE RUN` | — |
| 2 | Env scrub | `env-scrub-probe.ts` | `PENDING LIVE RUN` | — |
| 3 | Constrained shell/file | `fs-constraint-probe.ts` | `PENDING LIVE RUN` | — |
| 4 | Boot refusal (fail-closed launch) | `boot-refusal-probe.ts` | `PASS (logic, local)` · live wiring `PENDING` | local run, this PR |

> Decision rule (from the spec):
> - If **all four** record PASS → write **"Vercel Sandbox confirmed"** in the
>   "Final decision" section and PR 006/006b proceed as written.
> - If **any** records FAIL → record the specific failure here **and** adopt the
>   matching fallback from the decision tree; PR 006/006b are re-scoped against
>   that fallback **before** the worker is built.

---

## Per-control: what the probe asserts and how to read PASS/FAIL

### Control 1 — Network egress allowlist (`egress-probe.ts`)

**Claim under test (RFC §2 / §3.4-layer-5):** the worker can reach **only** the
metered AI Gateway + the DuckDuckGo grounding host; every other destination is
refused **at the network layer**, not merely unused. This is the control that
stops credential exfiltration and SSRF.

**What it does (hostile):** from inside the running sandbox (same place the
`claude` subprocess runs) it `curl`s each forbidden destination —
- `169.254.169.254` cloud metadata (AWS IMDS + GCP `computeMetadata` variant),
- RFC-1918 private ranges (`10.0.0.1`, `192.168.0.1`),
- an arbitrary public host (`example.com`),
- an egress-IP echo canary (`api.ipify.org`) —

then `curl`s one allowlisted host as a sanity control.

**Read it:**
- **PASS** — every forbidden `curl` is refused (non-zero exit / `http_code=000` /
  DNS denied / timeout) **and** the allowlisted host connects.
- **FAIL** — any forbidden destination returns a real HTTP code. The metadata
  endpoint succeeding is the worst case (credential path). → adopt the
  **egress-proxy** fallback.
- **ERROR** — allowlisted host unreachable too (allowlist misconfigured to block
  everything) or `curl` missing from the image. Not a pass.

> Note recorded for the live run: the harness passes the allowlist to
> `Sandbox.create()` under the field name `egressAllowlist`. Confirm against the
> installed `@vercel/sandbox` version's network-policy field name; if it differs,
> update `_harness.ts:createProbeSandbox` and **re-run** — a silently-ignored
> field would let everything through and must surface as a FAIL, not a skip.

### Control 2 — Env scrub (`env-scrub-probe.ts`)

**Claim under test (RFC §2 key-decisions / §3.4):** the worker process env
carries **no secret-shaped value beyond a placeholder run JWT** — no raw
Anthropic key, Supabase service-role key, Vercel token, AWS creds, PEM, etc. The
worker's only model credential is the run-scoped Gateway base URL + bridge JWT.

**What it does (hostile):** dumps the full env (`env`) the way a compromised tool
call would, then (a) checks for forbidden variable **names**
(`ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VERCEL_TOKEN`, …) and (b)
scans every **value** against secret-shape regexes (provider keys, AWS key ids,
JWTs, PEM blocks, bearer tokens, Slack/GitHub tokens). The run-JWT placeholder is
exempted by identity.

**Read it:**
- **PASS** — the only secret-shaped value is the run-JWT placeholder; no
  forbidden name present.
- **FAIL** — any other secret-shaped value or forbidden name leaked into the
  worker env. → the launcher leaks credentials; fix the provision step (this is
  primarily a **launcher-config** failure, not a Sandbox-platform one — see the
  decision tree).
- **ERROR** — the run-JWT placeholder is missing (worker didn't get its one
  credential) or env couldn't be read. Not a pass.

### Control 3 — Constrained shell/file (`fs-constraint-probe.ts`)

**Claim under test (RFC §3.4-layer-5):** the loop runs in an ephemeral working
dir; a shell/file read **outside** it — host secrets, system config, or a sibling
run's path (compute-side voice bleed, the #1 agency-ending risk) — must **fail**.

**What it does (hostile):** plants a "sibling run" secret outside the workdir on
the same VM, then attempts to read: host secrets (`/etc/shadow`, `~/.ssh/id_rsa`,
`~/.aws/credentials`, `/proc/1/environ`), the planted sibling path, and a
`../../../` traversal out of the workdir. Then it confirms the run's **own**
workdir is readable (positive control).

**Read it:**
- **PASS** — every out-of-jail read fails **and** the own-workdir read succeeds.
- **FAIL** — any out-of-jail read succeeds. **Important nuance for the decision:**
  a single Sandbox microVM is already a hard tenant boundary (one run = one VM;
  *other live runs are different VMs and physically unreachable*). So on a stock
  VM with an unconstrained shell, the **host-secret** reads should already fail
  (OS perms), but the **planted-sibling / workdir-escape** reads **will succeed**
  because they are just same-user reads on the same VM. If only those succeed,
  the finding maps specifically to the **no-shell-capable worker in v1** fallback
  (or a chroot/bind-mount jail), *not* to a Sandbox-platform defect. Record which
  reads succeeded.
- **ERROR** — own workdir unreadable (jail misconfigured). Not a pass.

### Control 4 — Boot refusal (`boot-refusal-probe.ts`)

**Claim under test (RFC §3.4 / PR 000 scope):** if any control fails to apply,
`sandbox-launch` **refuses to start** the loop rather than running degraded
(fail-closed).

**What it does:** unlike probes 1–3 it attacks the **launcher's decision**, not a
running VM. It drives the reference preflight gate `assertControlsOrRefuse()`
(the contract PR 006/006b's launcher must satisfy) with one broken-control
profile per control, plus an all-broken profile, plus a fully-valid profile.

**Read it:**
- **PASS** — every broken profile throws `BootRefusedError` and the valid profile
  is allowed. (Verified locally — see status banner.)
- **FAIL** — a broken profile is allowed to boot (launcher ran degraded) **or**
  the valid profile is refused (launcher is broken-closed, not fail-closed).
- **Live wiring (NEEDS-INPUT):** the live run must point the same broken profiles
  at the **real** `sandbox-launch` preflight (PR 006/006b) — i.e. provision a
  Sandbox with each control deliberately disabled and assert the launcher refuses
  to spawn the `claude` subprocess.

---

## How to run the live adversarial run

> Producing the filled verdict table above is **Tier 2** of the spec's test plan
> (a CI/manual adversarial run on real Vercel Sandbox infra). Until it runs, the
> table stays `PENDING LIVE RUN`.

### Prerequisites

1. **Sandbox credentials** (local/CI; on a Vercel deployment OIDC is automatic):
   ```bash
   export VERCEL_TOKEN=…        # personal access token
   export VERCEL_TEAM_ID=…
   export VERCEL_PROJECT_ID=…
   ```
2. **Install the run-time deps** (intentionally absent from this spike workspace —
   it ships nothing):
   ```bash
   pnpm --filter @sagemark/seo add @vercel/sandbox
   pnpm --filter @sagemark/seo add -D tsx        # or use `pnpm dlx tsx`
   ```
3. **(Recommended) a probe snapshot** with `curl` + a shell preinstalled, for
   fast, deterministic boots:
   ```bash
   export SPIKE_SANDBOX_SNAPSHOT_ID=snap_xxxxxxxx
   ```
   If unset, the harness boots a fresh `node24` VM; ensure `curl` is present
   (the egress probe asserts this and ERRORs if it is missing rather than
   silently passing).

### Optional env knobs (defaults in `_harness.ts`)

| Var | Default | Meaning |
|---|---|---|
| `SPIKE_EGRESS_ALLOWLIST` | `ai-gateway.vercel.sh,duckduckgo.com,html.duckduckgo.com` | allowlisted hosts |
| `SPIKE_RUN_JWT_PLACEHOLDER` | `PLACEHOLDER_RUN_JWT_not_a_real_secret` | the one permitted secret-shaped env value |
| `SPIKE_WORKDIR` | `/vercel/sandbox/run` | the run's ephemeral workdir |
| `SPIKE_SIBLING_WORKDIR` | `/vercel/sandbox/sibling-run` | planted sibling path (must be unreadable when jailed) |
| `SPIKE_SANDBOX_TIMEOUT_MS` | `120000` | VM timeout |

### Commands

```bash
cd apps/seo/spike/capability-enforcement

# No infra needed — runs anywhere (already PASSing):
pnpm dlx tsx boot-refusal-probe.ts

# Real Sandbox infra (records controls 1–3):
pnpm dlx tsx egress-probe.ts        # control 1
pnpm dlx tsx env-scrub-probe.ts     # control 2
pnpm dlx tsx fs-constraint-probe.ts # control 3

# Or all four in sequence:
pnpm dlx tsx boot-refusal-probe.ts && \
pnpm dlx tsx egress-probe.ts && \
pnpm dlx tsx env-scrub-probe.ts && \
pnpm dlx tsx fs-constraint-probe.ts
```

Each probe exits **0 = PASS**, **1 = FAIL (control bypassed)**, **2 =
ERROR/inconclusive**, and prints a `::probe-result:: {json}` line. A CI job
collects those four JSON lines, writes them into the verdict table above, and
flips this doc's STATUS banner. **A FAIL or ERROR must block PR 006 from merging
until the fallback is adopted.**

### Recording the result

After the run, replace each `PENDING LIVE RUN` cell with the recorded verdict +
date + runner, paste the four `::probe-result::` JSON blobs into an appendix, and
fill the **Final decision** section with either "Vercel Sandbox confirmed" or the
adopted fallback(s).

---

## Fallback-runtime decision tree

This is fixed **now** so PR 006/006b have the contingency before the live run.
For each control that records **FAIL**, adopt the mapped fallback and re-scope
PR 006/006b against it before building the worker.

```
Run the four probes on real Vercel Sandbox.
│
├─ ALL FOUR PASS ────────────────────────────────────────────────────────────
│     → Decision: "Vercel Sandbox confirmed."
│       PR 006 (worker host) + PR 006b (capability-denial profile) proceed
│       AS WRITTEN. sandbox-launch enforces all four controls natively.
│
├─ Control 1 (EGRESS) FAILs ─────────────────────────────────────────────────
│     The Sandbox cannot deny non-allowlisted egress at the network layer.
│     → Fallback A — EGRESS PROXY in front of the Sandbox:
│         • Worker gets NO direct network route; all egress is forced through a
│           host-controlled forward proxy that enforces the allowlist (Gateway +
│           DDG only) and rejects metadata/private/arbitrary hosts.
│         • The worker env carries only the proxy URL + bridge JWT; the metadata
│           IP and private ranges are unroutable from the VM's perspective.
│         • PR 006b re-scoped: its "egress allowlist" control is implemented at
│           the proxy, and the egress probe is re-pointed at the proxied VM.
│       If even a proxy cannot be guaranteed in front of every VM →
│       escalate to Fallback C (isolated container service).
│
├─ Control 2 (ENV SCRUB) FAILs ──────────────────────────────────────────────
│     A secret-shaped value beyond the run JWT reached the worker env.
│     → This is almost always a LAUNCHER-CONFIG defect, not a platform one:
│         • Fix the provision step to pass ONLY { RUN_JWT, gateway base URL };
│           never spread the host env into Sandbox.create({ env }).
│         • Add the PR 001 CI assertion ("no worker env/config carries a raw
│           Anthropic endpoint + provider key") as a launch-time gate too.
│       If the platform injects unavoidable secret-shaped values into every VM
│       env that cannot be scrubbed → treat as a platform FAIL and escalate to
│       Fallback C (isolated container service that controls the base env).
│
├─ Control 3 (FS CONSTRAINT) FAILs ──────────────────────────────────────────
│     The shell can read outside the run's workdir (sibling path / host secret).
│     Recall: cross-VM reads are already impossible (one run = one VM). The
│     realistic FAIL is the in-VM unconstrained shell escaping the workdir.
│     → Fallback B — NO-SHELL-CAPABLE AGENT-SDK WORKER IN v1 (preferred):
│         • Disable the general-purpose shell entirely; run the loop with ONLY
│           the typed host tools (runScorers/runGate/serpFetch/persistPiece/
│           heroImage). With no arbitrary shell, there is no out-of-workdir read
│           surface — the control becomes structurally true, not policy-enforced.
│         • PR 006/006b re-scoped: the SDK is configured with the shell tool
│           removed; the fs probe then asserts "no shell tool is exposed."
│       Alternative if a shell is genuinely required: a chroot / bind-mount jail
│       (Fallback C's container service) that confines the FS to the workdir.
│
├─ Control 4 (BOOT REFUSAL) FAILs ───────────────────────────────────────────
│     sandbox-launch ran degraded instead of refusing when a control was absent.
│     → This is OUR code, not the platform: make the launch preflight fail-closed
│       (the reference `assertControlsOrRefuse()` contract in
│       boot-refusal-probe.ts). The launcher MUST probe egress+env+fs on the
│       fresh VM and refuse to spawn the `claude` subprocess unless all pass.
│       No external fallback needed; it is a required fix in PR 006b.
│
└─ TWO OR MORE platform controls FAIL ───────────────────────────────────────
      → Fallback C — ISOLATED CONTAINER SERVICE (Firecracker/microVM host that
        exposes the controls): move the worker off Vercel Sandbox onto a runtime
        where egress allowlisting, env control, and FS jailing are all
        first-class (e.g. a self-hosted Firecracker host, gVisor, or a container
        platform with network policies + read-only rootfs). Highest cost; chosen
        only if Sandbox cannot provide the denial primitives even with a proxy +
        no-shell worker. PR 006/006b are re-pointed at this host's launch API.
```

**Default posture if the live run is delayed past PR 006's start:** adopt
**Fallback B (no-shell-capable worker) + the boot-refusal fix** pre-emptively —
they are pure wins (smaller attack surface, our own code) and do not depend on a
Sandbox platform capability. That keeps the worker buildable fail-closed while
the egress/env platform verdicts (controls 1–2) are confirmed on real infra.

---

## Final decision

> **NOT YET RECORDED — awaiting the live run.** Fill this in after the verdict
> table is complete:
>
> - If all four PASS → write **"Vercel Sandbox confirmed"** and note PR 006/006b
>   proceed as written.
> - If any FAIL → name the control(s), the recorded failure, and the adopted
>   fallback(s) from the tree above, and note that PR 006/006b are re-scoped
>   accordingly **before** the worker is built.

---

## Notes / deviations

- **Live-run criterion is NEEDS-INPUT, by the spec's own Tier-3 path.** This
  spike was produced without access to live Vercel Sandbox infra; fabricating a
  pass would defeat the entire point of an architecture gate. The probes are real
  and runnable; the verdicts are deferred to the human/CI run documented above.
- **Run-time deps not installed.** `@vercel/sandbox` (and a `tsx` runner) are
  intentionally absent — this is a spike that ships nothing. `_harness.ts` loads
  the SDK via a guarded dynamic import that fails fast with a `[NEEDS-DEP]`
  message, never a broken import; the four probes typecheck clean without it.
- **Rollback:** n/a — this PR produces a decision and ships no runtime.
