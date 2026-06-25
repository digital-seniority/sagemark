# Capability-enforcement spike (PR 000)

De-risking spike for the SEO Creator worker runtime. **Ships no production
runtime.** Its deliverable is this set of adversarial probes plus the decision
doc [`RESULTS.md`](./RESULTS.md).

It exists to **prove or falsify, on real Vercel Sandbox infra**, that the
Sandbox + Claude Agent SDK combination can enforce the four runtime controls the
worker safety model (RFC §2 / §3.4) depends on, **before** PR 006/006b lock the
worker topology.

## Files

| File | Control | What it attacks |
|---|---|---|
| `egress-probe.ts` | network egress allowlist | egress to metadata IP, private ranges, arbitrary public hosts from inside the sandbox |
| `env-scrub-probe.ts` | env scrub | dumps the worker env and scans for secret-shaped values beyond the run JWT |
| `fs-constraint-probe.ts` | constrained shell/file | reads host secrets / a sibling run's path / traverses out of the workdir |
| `boot-refusal-probe.ts` | boot refusal | drives the launch preflight with broken control profiles; asserts it refuses to start |
| `_harness.ts` | — | shared Sandbox SDK shim + run profile + PASS/FAIL reporter |

## Verdict contract (all probes)

- **PASS** — control enforced (the hostile action was refused). Exit `0`.
- **FAIL** — control bypassed (the hostile action succeeded). Exit `1`.
- **ERROR / INCONCLUSIVE** — the probe could not run (no infra, missing dep).
  Exit `2`. **Never** counted as a pass.

Each probe also prints a machine-readable `::probe-result:: {json}` line that CI
collects into `RESULTS.md`.

## Running

See [`RESULTS.md` → "How to run the live adversarial run"](./RESULTS.md) for the
exact commands, required env, and dependency install. In short:

```bash
pnpm --filter @sagemark/seo add @vercel/sandbox      # not installed by default
pnpm dlx tsx boot-refusal-probe.ts                   # runs with no infra
VERCEL_TOKEN=… VERCEL_TEAM_ID=… VERCEL_PROJECT_ID=… \
  pnpm dlx tsx egress-probe.ts                        # needs real Sandbox infra
```

> `boot-refusal-probe.ts` needs **no** Sandbox infra (it tests the launcher's
> fail-closed decision logic) and runs anywhere. The other three require a live
> Sandbox target.

## Status

The live adversarial run is **PENDING** — see the STATUS banner at the top of
`RESULTS.md`. The probes are written and type-clean; `boot-refusal-probe.ts` has
been executed locally and passes. The remaining three are gated on real Sandbox
infra access.
