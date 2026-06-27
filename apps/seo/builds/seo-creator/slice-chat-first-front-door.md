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

## Decisions still needing James
1. **Sign-in method:** email magic-link (OTP) vs email+password. *(Rec: magic-link — simplest, no password handling.)*
2. **Rich live streaming (P-J) in-slice or fast-follow?** The chat-first "feel" (article types in live, tools tick) needs it; the consumer side already exists — the gap is one hop (worker pushes `::worker-token/tool/gate::` to stdout + dispatcher parses). Core flow works WITHOUT it (lifecycle-only + "drafting…"). *(Rec: in-slice.)*
3. Confirm defaults: operator id = `auth.users.id`; one workspace per operator (v1); on-`done` agent-turn recorded lazily from the persisted version (option b); trivial revisions MAY route to `/api/edit` (no Sandbox) while substantive turns go through the agent.

## Risks (Plan agent)
- **P-B is the tenancy-boundary flip** — review like the publish path. **Multi-turn cost/latency** — every turn = a fresh microVM boot + full SKILL run (~90s ceiling); current draft injected so no re-research, but heavy for "make it warmer" (hence the `/api/edit` hedge). **`WORKER_PROMPT` env-size** — a big composed prompt (transcript+draft) may hit a Sandbox env limit; fall back to writing the brief to the workdir + passing a path. **Live e2e still pending** (DR-044 / the `runCommand` `as any`).

## HUMAN/infra steps
Enable Supabase Auth (email provider + `/auth/callback` redirect) on the project; `pnpm --filter @sagemark/seo add @supabase/ssr`; ensure `NEXT_PUBLIC_SUPABASE_URL`+publishable key+`SUPABASE_SERVICE_ROLE_KEY` on host; seed the pilot `operators`/`workspaces`/`workspace_members` linked to the existing WW `content_clients.workspace_id`.
