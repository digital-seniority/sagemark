/**
 * Project data-access composition (Slice 5b, creds-gated + safe-default).
 *
 * Returns the LIVE service-role `ProjectDataAccess` when host creds are present,
 * else the fail-closed `NOT_WIRED_PROJECT_ACCESS` default. Mirrors
 * `../conversation/resolve-conversation-access.ts`.
 *
 * `server-only`: composing the live adapter touches service-role creds. Importing
 * is network-free + cred-free (the adapter imports Supabase dynamically).
 */

import "server-only";

import { NOT_WIRED_PROJECT_ACCESS, type ProjectDataAccess } from "./context";
import { makeLiveProjectDataAccess } from "./live-project-data-access";

export async function resolveProjectDataAccess(): Promise<ProjectDataAccess> {
  const live = await makeLiveProjectDataAccess();
  if (!live) return NOT_WIRED_PROJECT_ACCESS;
  return live;
}
