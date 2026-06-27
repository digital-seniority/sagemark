/**
 * Conversation data-access composition (Slice 5, creds-gated + safe-default).
 *
 * THE DI SEAM the chat-front-door route layer (P-F) resolves at activation. The
 * live service-role adapter (`makeLiveConversationDataAccess`) is built in
 * `live-conversation-data-access.ts`; this helper is the thin composition that
 * returns either the LIVE `ConversationDataAccess` (when service-role creds are
 * present) or the fail-closed `NOT_WIRED_CONVERSATION_ACCESS` default. Mirrors
 * `../content/resolve-data-access.ts` / `../content/resolve-public-data-access.ts`.
 *
 * SAFE DEFAULT (the hard rule): with NO env set, the factory returns null, so
 * `resolveConversationDataAccess()` returns `NOT_WIRED_CONVERSATION_ACCESS` — every
 * method throws loudly (fail-closed). A merge changes nothing live.
 *
 * TENANCY PRESERVED. The live adapter already enforces the bound `workspace_id`/
 * `client_id` on every query (service-role bypasses RLS — the app filter is the
 * boundary). This helper only swaps the impl; the route layer still passes the
 * BOUND tenancy, never request input.
 *
 * `server-only`: composing the live adapter touches the service-role creds.
 * Importing this module is network-free + cred-free (the adapter imports
 * `@supabase/supabase-js` dynamically and returns null without creds).
 *
 * Clean ASCII / UTF-8. No `console.*`.
 */

import "server-only";

import {
  NOT_WIRED_CONVERSATION_ACCESS,
  type ConversationDataAccess,
} from "./context";
import { makeLiveConversationDataAccess } from "./live-conversation-data-access";

/**
 * Resolve the `ConversationDataAccess` for the chat-front-door routes, creds-gated
 * + safe-default.
 *
 *   - service-role creds PRESENT → the LIVE service-role adapter (every query
 *     scoped by the bound workspace_id + client_id).
 *   - creds ABSENT               → `NOT_WIRED_CONVERSATION_ACCESS` (fail-closed —
 *     every method throws loudly).
 *
 * Async because building the live adapter dynamically imports the Supabase client
 * (network-free import; a real connection only on first query).
 */
export async function resolveConversationDataAccess(): Promise<ConversationDataAccess> {
  const live = await makeLiveConversationDataAccess();
  // No service-role creds → leave the seam on its fail-closed default (unchanged).
  if (!live) return NOT_WIRED_CONVERSATION_ACCESS;
  return live;
}
