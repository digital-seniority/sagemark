# DR-045 — Chat-first foundation conventions (soft tenancy refs · denormalized turn tenancy · WORKER_PROMPT ceiling)

**Status:** Accepted · **Date:** 2026-06-27 · **Run:** Slice 5 (chat-first front door) · **Relates:** [[DR-044]] (WORKER_PROMPT transport), [[DR-026]] (data-access seam), [[DR-003]] (auth placeholder being filled)

## Context
The Slice-5 schema foundation (migrations 0040 conversations/conversation_turns + 0041 operators/workspaces/workspace_members, PRs #96/#97) established three conventions the judge flagged as decision-worthy.

## Decisions

### 1. The tenancy root is SOFT-referenced (app-enforced, not a DB FK)
`operators.id` is the Supabase `auth.users` subject id but carries **no hard cross-schema FK** to `auth.users` (the migration pooled role can't write `auth.*`, and a cross-schema FK couples public→auth). Likewise the existing `*.workspace_id` columns get **no new FK** to the new `workspaces` table (keeping 0041 additive — no ALTER of existing tables). **Consequence:** referential integrity for the tenancy root (operator↔auth user, workspace_id↔workspace) is **app-enforced**, not DB-enforced. Future tables follow "soft ref to the tenancy root." This is deliberate, not an oversight.

### 2. Per-turn child rows denormalize the full tenancy key
`conversation_turns` carries `workspace_id` + `client_id` directly (mirroring `content_piece_versions`), rather than relying on a join to `conversations`. So every future tenant-read RLS policy / explicit `.eq()` filter needs no join. New child tables in this lane follow the denormalized-tenancy pattern.

### 3. `WORKER_PROMPT_CHAR_CEILING = 24,000` chars
The per-turn composed brief travels as a single `WORKER_PROMPT` env var on the Sandbox `runCommand` (DR-044). POSIX `MAX_ARG_STRLEN` caps one string at 128 KiB; 24k chars ≤ ~96 KB even all-4-byte UTF-8, leaving headroom for the rest of the env block. The composer trims OLD transcript first and NEVER the current draft body, with a hard clamp. This **defers** the slice plan's "write brief to workdir + pass a path" fallback — revisit it only if a future payload (e.g. multi-piece cluster context) exceeds the ceiling.

## Consequences
- Fail-closed tenancy holds (all 5 tables RLS-enabled, no anon policy — proven behaviorally: anon sees 0 on seeded rows, postgres sees them).
- Auth (P-B) must enforce operator↔workspace integrity in app code (the soft ref).
- Worker-payload sizing cites the 24k ceiling.

## Alternatives considered
- Hard FK to `auth.users` (blocked by migration-role perms); backfill + ALTER existing `workspace_id`→`workspaces` FK (rejected — non-additive, out of slice scope); path-based brief transport (deferred); higher char ceiling (rejected for multi-byte + env-block headroom).

## References
`packages/schema-flywheel/drizzle/0040_conversations.sql` + `0041_operators_workspaces.sql`; `packages/schema-flywheel/src/content.ts`; `apps/seo/src/lib/conversation/compose-turn-prompt.ts`; `slice-chat-first-front-door.md`.
