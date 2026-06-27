# DR-047 — Chat-first slice conventions (workspace→client bridge · POST-fetch-stream · base64 markers · source-wrap turn-record)

**Status:** Accepted · **Date:** 2026-06-27 · **Run:** Slice 5 (chat-first front door, COMPLETE 10/10) · **Relates:** [[DR-044]] (WORKER_PROMPT/streaming), [[DR-045]] (foundation), [[DR-046]] (auth/conversation house-style)

## Context
The chat-first front door (PRs #94/#96/#97/#99/#100/#102/#103/#104/#105/#106) established several patterns the judges flagged as decision-worthy. Consolidated here so future studio work cites them rather than re-deriving.

## Decisions

### 1. Studio "workspace → single client" tenancy bridge (read side)
`resolveWorkspaceClient(workspaceId)` (service-role read, `.eq("workspace_id", …)`, oldest-first, take-first) is the read-side counterpart to the route layer's `bindRequestContext`. Where a route VALIDATES a supplied clientId, a studio PAGE must DISCOVER the bound client from the operator's workspace. v1 assumes **one client per workspace** (take-first, deterministic oldest tie-break) — multi-client is deferred. Fail-closed (no creds/no row → null) + fail-loud (read error rethrows).

### 2. POST-fetch-stream consumer (UI streaming over a POST endpoint)
The browser can't `EventSource` a POST. `/api/run` is POST-returns-SSE, so the composer reads the streaming Response via `fetch` + `ReadableStream` (`post-turn-stream.ts`) and folds frames through the **shared** `streamReducer` (extracted from `use-ui-message-stream.ts` — one taxonomy fold, two transports). Future POST-returns-a-stream studio surfaces copy `parseSseFrames` + `runTurnStream`. (Rejected: GET-with-query EventSource — leaks prompt/tenancy in the URL; a second SSE GET after POST — extra round-trip + run-id leak.)

### 3. base64(JSON) worker→host wire markers
Every rich-delta marker is `::worker-<kind>:: base64(JSON(payload))`. Base64's alphabet has no `:`/space/newline, so a model token can never forge a lifecycle marker or break line framing; the host re-validates code/stage against the taxonomy and drops anything malformed (no raw-prose leak). All future worker→host marker kinds follow this encode + host-revalidate discipline.

### 4. Agent-turn-on-done via source-wrap (+ first-draft deferred link)
The relay consumes the worker source internally and returns a streaming Response — no post-stream callback. So the agent turn is recorded by **wrapping the `WorkerEventSource`** (observe the terminal frame, record once, fire-and-forget, idempotent via once-latch + runId re-check + `unique(conversation_id,seq)`). A terminal `error` records NO turn. **Known tradeoff:** on a first draft where the worker creates a piece but doesn't link it during the run, the agent turn may record with `pieceVersion=null` and the conversation→piece link defers to a lazy reconciliation (because `content_pieces` has no `run_id` column to resolve a brand-new piece by run alone). Future worker-completion side-effects (cost reconciliation, notifications) replicate the source-wrap.

## Consequences
- The studio is usable end-to-end in code; the chat loop unifies generate + revise (substantive turns through the agent; `/api/edit` remains the precise-span tool).
- Runtime go-live still requires: deploy → operator first sign-in → seed `operators`/`workspaces`/`workspace_members` (+ ensure the WW `content_clients` row is in that workspace) → the Tier-3 live click-through + Sandbox e2e.

## References
`apps/seo/src/lib/content/resolve-workspace-client.ts`; `apps/seo/src/lib/stream/post-turn-stream.ts`; `apps/seo/src/worker/emit.ts` + `live-dispatcher.ts`; `apps/seo/src/app/api/run/turn.ts`; `slice-chat-first-front-door.md`.
