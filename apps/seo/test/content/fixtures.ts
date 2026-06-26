/**
 * Shared test fixtures + a spying mock `ContentDataAccess` for the kernel-route
 * tests (PR 005). The mock counts every WRITE so the audit-read-only test can
 * assert zero mutations occurred (criterion 1).
 */

import { vi } from "vitest";
import type { Workspace } from "@/lib/auth";
import type {
  ContentDataAccess,
  ContentPieceRow,
  ApprovedVoiceSpec,
  PersistedRelease,
  PersistedAuthorization,
  PersistedGateResult,
  PersistedBriefSnapshot,
} from "@/lib/content/context";
import type { AuthorityClass } from "@/lib/content/contract";

// Valid RFC-4122 v4 UUIDs (version nibble = 4, variant nibble in 8-b).
export const WORKSPACE_A = "11111111-1111-4111-8111-111111111111";
export const WORKSPACE_B = "22222222-2222-4222-8222-222222222222";
export const CLIENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const CLIENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const PIECE_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const AUTHOR_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const AUTH_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

export function workspace(id: string = WORKSPACE_A): Workspace {
  return { id, ownerType: "user", ownerId: "owner", name: "Test WS" };
}

export function approvedVoiceSpec(
  over: Partial<ApprovedVoiceSpec> = {},
): ApprovedVoiceSpec {
  return {
    id: "spec-1",
    clientId: CLIENT_A,
    approvedAt: "2026-01-01T00:00:00.000Z",
    spec: {
      bannedLexicon: [],
      authors: [{ id: AUTHOR_A, name: "Dr. Jane Roe", credentials: "RN, CDP" }],
      attributionSources: ["myclinicblog.example"],
      ...over.spec,
    },
    ...over,
  };
}

export function gradedSource(
  url: string,
  authorityClass: AuthorityClass,
  snippet: string,
): PersistedBriefSnapshot["sources"][number] {
  let domain = "";
  try {
    domain = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    domain = url;
  }
  return {
    url,
    domain,
    title: `Title for ${domain}`,
    snippet,
    fetchedAt: "2026-01-02T00:00:00.000Z",
    authorityClass,
  };
}

export function pieceRow(over: Partial<ContentPieceRow> = {}): ContentPieceRow {
  return {
    id: PIECE_A,
    clientId: CLIENT_A,
    slug: "test-piece",
    title: "Test Piece",
    body: "## Heading\n\nSome grounded body content about a topic.\n\n[cta:]\n",
    status: "draft",
    version: 1,
    isYmyl: false,
    authorId: AUTHOR_A,
    verdict: null,
    evalScore: null,
    faqData: null,
    briefSnapshot: { keyword: "test", isYmyl: false, sources: [] },
    ...over,
  };
}

export function gateResult(
  over: Partial<PersistedGateResult> = {},
): PersistedGateResult {
  return {
    evalRan: true,
    stageBScore: 90,
    verdict: "PUBLISH",
    sourcingBlocked: false,
    ...over,
  };
}

/** A spying data-access mock. `writes` counts every mutation call. */
export interface MockDataAccess extends ContentDataAccess {
  writes: { insertDraftPiece: number; transitionPieceStatus: number };
}

export function makeData(over: Partial<ContentDataAccess> = {}): MockDataAccess {
  const writes = { insertDraftPiece: 0, transitionPieceStatus: 0 };
  const base: ContentDataAccess = {
    clientBelongsToWorkspace: vi.fn(async (clientId: string, workspaceId: string) => {
      // CLIENT_A belongs to WORKSPACE_A only.
      return clientId === CLIENT_A && workspaceId === WORKSPACE_A;
    }),
    getApprovedVoiceSpec: vi.fn(async () => approvedVoiceSpec()),
    loadPiece: vi.fn(async (pieceId: string, clientId: string) =>
      pieceId === PIECE_A && clientId === CLIENT_A ? pieceRow() : null,
    ),
    getRelease: vi.fn(async (): Promise<PersistedRelease | null> => null),
    getAuthorization: vi.fn(async (): Promise<PersistedAuthorization | null> => null),
    getGateResult: vi.fn(async (): Promise<PersistedGateResult | null> => gateResult()),
    insertDraftPiece: vi.fn(async () => {
      writes.insertDraftPiece += 1;
      return { id: PIECE_A, slug: "test-piece" };
    }),
    transitionPieceStatus: vi.fn(async () => {
      writes.transitionPieceStatus += 1;
    }),
    ...over,
  };
  return { ...base, writes };
}

/** Build a Request with a JSON body for a route handler. */
export function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/content/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
