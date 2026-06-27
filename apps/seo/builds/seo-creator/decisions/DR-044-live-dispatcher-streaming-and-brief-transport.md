# DR-044 — Live dispatcher: lifecycle-only streaming (for now) + WORKER_PROMPT brief transport

**Status:** Accepted · **Date:** 2026-06-27 · **Run:** worker stand-up · **Relates:** [[DR-042]] (host model-proxy), [[DR-016]] (worker env seam), [[DR-011]] (no-shell worker), P0.W.4 (SSE relay)

## Context
`createLiveDispatcher` (`apps/seo/src/app/api/run/live-dispatcher.ts`) wires `launchSandbox` into `/api/run` — the final code piece for the live autonomous worker. Two decisions surfaced in review (judge 5/5·4/5).

## Decision

### 1. Live stream carries run LIFECYCLE only (token/tool deltas deferred)
The worker entry (`entry.ts`) currently emits only `::worker-session-id::` / `::worker-result::` / `::worker-terminal-error::` / `::worker-fatal::` to stdout. So the dispatcher relays the run **lifecycle** (a clean `done`, or a coded `error`) to the canvas — **not** per-token / tool-use / gate deltas. The deliverable ("worker runs → drafts → `persistPiece`") flows over the host-tool path, independent of stdout fidelity, so this is sufficient for the core flow. **Rich live streaming (token/tool markers → SSE) is a deferred UX-fidelity follow-up** (extend `entry.ts`/`emit.ts` to push deltas to stdout). Future PRs MUST NOT assume the live canvas streams deltas yet. The relay's heartbeat/stall ceiling (90s) + synthetic `done` on a marker-less end keep the stream from hanging or going empty.

### 2. The brief flows via `WORKER_PROMPT` (per-command env override)
The run brief is passed to the worker as a `WORKER_PROMPT` env on the `sandbox.runCommand` invocation — deliberately ABSENT from `buildWorkerEnv`'s scrubbed base env (so it doesn't widen the allowlist). The entry reads it. Future worker-input wiring should follow this per-command seam, not argv or the base env.

## Consequences
- The worker is end-to-end runnable; the live canvas shows lifecycle now, deltas later.
- **Untested-until-Tier-3 assumption (judge product 4/5):** the `sandbox.runCommand({cmd,args,env,detached})` + `cmd.logs()` shape is called via `as any` against `@vercel/sandbox` — a real SDK signature drift would only surface in the live e2e. Pin it with a typed wrapper / conformance assertion in the live-e2e pass.
- Tenancy/egress/keyless invariants hold (binding from the verified scope; egress host-only; model via `{host}/api/model`).

## Alternatives considered
- **Emit token/tool markers now** — larger, out of the dispatcher lane's scope; deferred.
- **Brief via argv / base env** — rejected (base-env would widen the scrubbed allowlist; argv less clean than the env override).

## References
`apps/seo/src/app/api/run/live-dispatcher.ts`; `apps/seo/src/app/api/run/route.ts`; `test/run/dispatcher.test.ts`; `apps/seo/src/worker/{entry,emit}.ts`.
