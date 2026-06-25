/**
 * Server-side auth guard for `apps/seo` (PR 001).
 *
 * The RFC specifies this file as "a re-export of `apps/agents/src/lib/auth`".
 * In the sagemark monorepo there is **no `apps/agents` and no Supabase wiring
 * yet** (the flywheel-main agents auth is deeply coupled to Supabase +
 * anonymous-session + the videogen credits/onboarding packages, none of which
 * exist here). So this PR stands up the **guard SEAM** with the same SHAPE the
 * agents convention exposes — `getCurrentUser()`, a `Workspace` type, and a
 * `requireOperator()` page guard — as a documented, no-op-by-default
 * placeholder. A later schema/tenancy PR (PR 004+) swaps the bodies for the
 * real cookie-bound Supabase session + workspace resolution behind this exact
 * signature, so studio surfaces wired against it today need no change then.
 *
 * Invariant established now (so it can't be retrofitted): every studio surface
 * resolves its operator/workspace through THIS module before rendering or
 * mutating — multi-tenant queries derive `workspace_id` from here (RFC §3.4
 * layer 2), never from request input.
 */

import "server-only";

/** The authenticated operator. Mirrors the agents-app `User` shape (subset). */
export interface Operator {
  id: string;
  email: string | null;
}

/**
 * The single authoritative workspace for the current operator. All multi-tenant
 * queries MUST derive `workspace_id` from this (RFC §3.4 layer 2). Shape mirrors
 * the agents-app `Workspace` so the real impl drops in without call-site churn.
 */
export interface Workspace {
  id: string;
  ownerType: "user" | "team";
  ownerId: string | null;
  name: string;
}

/**
 * Return the currently signed-in operator, or `null` if unauthenticated.
 *
 * PLACEHOLDER (PR 001): no session backend is wired yet, so this returns `null`.
 * Replaced by the cookie-bound Supabase session read in a later PR — same
 * signature.
 */
export async function getCurrentOperator(): Promise<Operator | null> {
  return null;
}

/**
 * Resolve the workspace the current operator owns, or `null` if unauthenticated.
 *
 * PLACEHOLDER (PR 001): returns `null` until the Supabase workspace resolution
 * lands. Callers that need bootstrap-on-miss semantics will use a dedicated
 * `ensureOperatorWorkspace()` helper added with the real impl.
 */
export async function getCurrentWorkspace(): Promise<Workspace | null> {
  return null;
}

/**
 * Page/route guard: ensure the request is from an authenticated operator and
 * return them. In this PR it is a **pass-through seam** — it does not yet block
 * (no auth backend), but it is the single chokepoint every studio surface calls,
 * so enabling real enforcement later is a one-file change.
 */
export async function requireOperator(): Promise<Operator | null> {
  return getCurrentOperator();
}
