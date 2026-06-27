# Slice 5 — Chat-first studio front door (build plan)

**Status:** APPROVED to build (James, 2026-06-27). New scope beyond the v1 map — turns the idle three-zone canvas into a working chat-driven article generator. Design by the Plan agent; this is the build spec.

## The vision (locked)
Chat-first / agent-driven (Claude-Code-like): the user's message IS the brief → the Agent-SDK worker runs the real `seo-blog-writer` SKILL → article streams into the artifact zone → gate fills the inspector → operator (credentialed reviewer) releases → publish. Structured controls (dropdowns) come LATER as chips that compose a chat turn (progressive disclosure).

## Locked decisions
- **Per-turn run-session model:** each user turn dispatches a FRESH agent run that re-hydrates the conversation + current draft from persisted state (Supabase = system of record, D9). Conversation lives in the DB, not a long-lived worker.
- **Unify generate + fine-tune** in the chat loop; keep deterministic `/api/edit` as the precise-span tool behind a structured control.
- Clarifying questions: ask ONE tight question max when vague, else draft. v1 = ONE piece per conversation (cluster later as a chip). Inspector docked-open while drafting (✅ toggle shipped #94).
- **Conversation context → worker via `WORKER_PROMPT`** (host composes the turn brief incl. transcript digest + current draft body), NOT a new host tool — no capability-profile change, fits DR-044.
- **`/api/run` becomes turn-aware** (optional `conversationId`), NOT a forked `/api/chat` — one-shot path stays back-compat.

## PR breakdown (ordered by dependency)
| # | Title | Lane | Migration | Deps | Type |
|---|---|---|---|---|---|
| **I0** | Supabase Auth + creds enablement (+ `@supabase/ssr`) | infra | — | — | **HUMAN** |
| **P-A** | `operators`/`workspaces`/`workspace_members` schema | schema | 0041 | — | code |
| **P-B** | Real Supabase auth in `auth.ts` + sign-in page/callback/middleware | auth | — | I0,P-A | code (**high-stakes**) |
| **P-C** | `conversations`/`conversation_turns` schema | schema | 0040 | — | code |
| **P-D** | `ConversationDataAccess` seam + live adapter | schema | — | P-C,I0 | code |
| **P-E** | Turn-prompt composer (pure fn) | worker | — | — | code |
| **P-F** | `/api/run` turn-aware + record turns + wire live data deps | worker | — | P-D,P-E,P-B | code (**high-stakes**) |
| **P-G** | `/api/conversations` + `/[id]` routes | worker/ui | — | P-D,P-B | code |
| **P-H** | Chat composer + transcript UI (AgentPanel recompose) | studio-ui | — | P-G,P-F | code |
| **P-I** | Home + canvas wiring (mount chat-first, not idle) | studio-ui | — | P-H,P-B,P-G | code |
| **P-J** | Rich token/tool/gate streaming (worker stdout markers → SSE) | worker | — | P-F | code (DR-044 follow-up) |

**Sequence:** I0 → (P-A ∥ P-C ∥ P-E) → P-B → P-D → P-F → P-G → P-H → P-I. P-J independent after P-F.

## Decisions (DECIDED — James, 2026-06-27)
1. **Sign-in = email magic-link** (OTP, passwordless).
2. **Rich live streaming (P-J) = IN this slice** (worker pushes `::worker-token/tool/gate::` to stdout + dispatcher parses; closes the DR-044 gap).
3. Defaults confirmed: operator id = `auth.users.id`; one workspace per operator (v1); on-`done` agent-turn recorded lazily from the persisted version; trivial revisions MAY route to `/api/edit` while substantive turns go through the agent.

## Progress
- ✅ **Inspector toggle** ([#94](https://github.com/digital-seniority/sagemark/pull/94)) — collapsible gate rail (shipped).
- ✅ **P-A + P-C schema** ([#96](https://github.com/digital-seniority/sagemark/pull/96)) — 0040/0041 MERGED + **APPLIED to Supabase + RLS fail-closed proven behaviorally** (anon=0 on seeded rows). Judge 5/5·5/5. [[DR-045]].
- ✅ **P-E composer** ([#97](https://github.com/digital-seniority/sagemark/pull/97)) — pure `composeTurnPrompt`, injection-fenced, 24k ceiling. Judge 5/5·5/5.
- ✅ **I0 (HUMAN):** James enabled Supabase Auth (email magic-link + `/auth/callback`) — 2026-06-27.
- ✅ **P-B auth** ([#99](https://github.com/digital-seniority/sagemark/pull/99)) — Supabase magic-link; `getCurrentWorkspace` fail-closed (service-role member read, server-derived); `requireOperator` now redirects (THE gate flip); Next 16 `proxy.ts`. Judge 5/5·5/5. Inert until deployed.
- ✅ **P-D conversation adapter** ([#100](https://github.com/digital-seniority/sagemark/pull/100)) — `ConversationDataAccess` seam + live adapter, tenancy-filtered, NOT_WIRED fail-closed. Judge 5/5·5/5. [[DR-046]].
- ✅ **P-F turn-aware `/api/run`** ([#102](https://github.com/digital-seniority/sagemark/pull/102)) — conversation persistence + composer + record turns; one-shot path unchanged; agent-turn-on-done idempotent. Judge 5/5·5/5.
- ✅ **P-G conversation routes** ([#103](https://github.com/digital-seniority/sagemark/pull/103)) — `/api/conversations` create/list/[id], tenancy-scoped (404 cross-tenant). Judge 5/5·5/5.
- ✅ **P-H chat composer + transcript UI** ([#104](https://github.com/digital-seniority/sagemark/pull/104)) — POST-fetch-stream (shared reducer), persisted-is-truth reconcile, idle path intact. Judge 5/5·5/5.
- ✅ **P-J rich streaming** ([#105](https://github.com/digital-seniority/sagemark/pull/105)) — worker base64(JSON) delta markers → taxonomy SSE; injection-safe, no raw-prose leak. Judge 5/5·5/5.
- ✅ **P-I home + canvas wiring** ([#106](https://github.com/digital-seniority/sagemark/pull/106)) — chat-first mount (not idle), workspace→client bridge, cross-tenant redirect. Judge 5/5·5/5. [[DR-047]].

## 🎉 SLICE COMPLETE — 10/10 PRs merged (code-complete on preview)
Conventions: [[DR-044]]/[[DR-045]]/[[DR-046]]/[[DR-047]]. **RUNTIME / GO-LIVE steps remaining (not code):**
1. **Deploy** preview→main (James's go — the production release).
2. **James first magic-link sign-in** on the deployed `/sign-in` → creates his `auth.users.id`.
3. **Orchestrator seeds** `operators` (his auth id) + `workspaces` + `workspace_members` linking him to the WW workspace (`81815c0a…`); ensure the WW `content_clients` row (`e84acf0f…`) is in that workspace. **WARNING:** an authed operator with NO seeded membership → null workspace → 401/redirect on every studio surface — seed promptly after the gate deploys.
4. **Tier-3 live e2e:** sign-in → start a conversation → chat → the worker (Sandbox) drafts a real WW piece → gate → release → publish. (Also the live Sandbox dispatch e2e from the worker stand-up — still Tier-3.)

## Risks (Plan agent)
- **P-B is the tenancy-boundary flip** — review like the publish path. **Multi-turn cost/latency** — every turn = a fresh microVM boot + full SKILL run (~90s ceiling); current draft injected so no re-research, but heavy for "make it warmer" (hence the `/api/edit` hedge). **`WORKER_PROMPT` env-size** — a big composed prompt (transcript+draft) may hit a Sandbox env limit; fall back to writing the brief to the workdir + passing a path. **Live e2e still pending** (DR-044 / the `runCommand` `as any`).

## HUMAN/infra steps
Enable Supabase Auth (email provider + `/auth/callback` redirect) on the project; `pnpm --filter @sagemark/seo add @supabase/ssr`; ensure `NEXT_PUBLIC_SUPABASE_URL`+publishable key+`SUPABASE_SERVICE_ROLE_KEY` on host; seed the pilot `operators`/`workspaces`/`workspace_members` linked to the existing WW `content_clients.workspace_id`.
