# DR-046 — Auth client separation + requireOperator contract + ConversationDataAccess house-style

**Status:** Accepted · **Date:** 2026-06-27 · **Run:** Slice 5 (chat-first front door) · **Relates:** [[DR-003]] (auth placeholder filled), [[DR-026]] (data-access seam), [[DR-040]] (activation), [[DR-045]] (foundation conventions)

## Context
P-B (auth, #99) + P-D (conversation adapter, #100) established three conventions the judge flagged as decision-worthy.

## Decisions

### 1. Two physically-separate Supabase clients: session-read vs tenancy-read
`getCurrentOperator()` uses the **cookie-bound anon client** (`@supabase/ssr`, `auth.getUser()`) to identify the operator. `getCurrentWorkspace()` then uses a **separate service-role client** to read `workspace_members ⋈ workspaces` — because the tenancy-root tables are RLS-enabled with **no anon/auth policy** (DR-045), so only the service role can read them. **Convention:** the session-read client and the tenancy-read client are distinct; tenancy-root tables are service-role-only; operator-scoped reads derive the operator id from `getUser()` (server-authenticated), never from request input. The service-role key is server-only — never shipped to the browser/sign-in client.

### 2. `requireOperator()` contract: non-null or redirect
`requireOperator()` return type is narrowed `Promise<Operator | null>` → **`Promise<Operator>`** — it either returns a real operator or `redirect('/sign-in')` (throws, never returns null). Callers may rely on a non-null operator after `await requireOperator()`. This is the canonical studio chokepoint; every studio surface gates through it. (Making it redirect is THE gate flip — production studio surfaces require sign-in once deployed.)

### 3. `ConversationDataAccess` follows the `ContentDataAccess` house-style
Second instance of the fail-closed persistence pattern, now cemented as house style for all tenancy-scoped data access: a seam interface + a `NOT_WIRED_*` default that throws on every method + a creds-gated resolver (returns NOT_WIRED without service-role creds → a merge changes nothing live) + a live service-role adapter where EVERY query carries the explicit `.eq("workspace_id", …)` (+ `.eq("client_id", …)` where the table has it) from BOUND args, never request input. Future tenancy-scoped data access copies this shape.

## Consequences
- Operator↔workspace integrity is app-enforced via the service-role read (soft refs, DR-045); the link must be SEEDED (operators/workspaces/workspace_members) after the operator's first sign-in, or `getCurrentWorkspace` returns null → 401 (fail-closed by design).
- Any new persistence lane uses the seam + NOT_WIRED + creds-gated-resolver pattern.

## References
`apps/seo/src/lib/auth.ts` + `lib/auth/*`; `apps/seo/src/lib/conversation/*`; `apps/seo/test/auth/*` + `test/conversation/*`; PRs #99/#100.
