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
  PersistedPieceVersion,
  PersistedCommentThread,
  PersistedApprovalEvent,
} from "@/lib/content/context";
import { SignoffImmutableError } from "@/lib/content/context";
import type { AuthorityClass } from "@/lib/content/contract";

// Valid RFC-4122 v4 UUIDs (version nibble = 4, variant nibble in 8-b).
export const WORKSPACE_A = "11111111-1111-4111-8111-111111111111";
export const WORKSPACE_B = "22222222-2222-4222-8222-222222222222";
export const CLIENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const CLIENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const PIECE_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const AUTHOR_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const AUTH_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
export const COMMENT_A = "ffffffff-ffff-4fff-8fff-ffffffffffff";

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

/** A persisted version-row fixture (PR 012 — content_piece_versions projection). */
export function pieceVersion(
  over: Partial<PersistedPieceVersion> = {},
): PersistedPieceVersion {
  return {
    id: "ver-1",
    pieceId: PIECE_A,
    clientId: CLIENT_A,
    version: 1,
    body: "## Heading\n\nSome grounded body content about a topic.\n",
    verdict: "REVIEW",
    snapshotAt: "2026-01-03T00:00:00.000Z",
    // P1.U.4 / PR 013 seam metadata (deferred-migration columns; default unnamed).
    name: null,
    isActive: false,
    isSignoff: false,
    ...over,
  };
}

/** A `request-changes` comment-thread fixture (PR 019 — routing input). The
 * default elementHint uses the `heading:` convention so it self-addresses a
 * section; pass `anchor: null` to force the operator-region-required path. */
export function commentThread(
  over: Partial<PersistedCommentThread> = {},
): PersistedCommentThread {
  return {
    id: COMMENT_A,
    pieceId: PIECE_A,
    clientId: CLIENT_A,
    version: 3,
    kind: "request-changes",
    anchor: { x: 0.4, y: 0.6, elementHint: "heading:Costs" },
    body: "Please soften the pricing claim in this section.",
    author: "client:kate",
    status: "open",
    createdAt: "2026-01-04T00:00:00.000Z",
    ...over,
  };
}

/** A spying data-access mock. `writes` counts every mutation call. */
export interface MockDataAccess extends ContentDataAccess {
  writes: {
    insertDraftPiece: number;
    transitionPieceStatus: number;
    insertPieceVersion: number;
    nameVersion: number;
    setActiveVersion: number;
    insertClientSignoff: number;
    insertCredentialedRelease: number;
    resolveCommentThread: number;
  };
}

export function makeData(over: Partial<ContentDataAccess> = {}): MockDataAccess {
  const writes = {
    insertDraftPiece: 0,
    transitionPieceStatus: 0,
    insertPieceVersion: 0,
    nameVersion: 0,
    setActiveVersion: 0,
    insertClientSignoff: 0,
    insertCredentialedRelease: 0,
    resolveCommentThread: 0,
  };
  // Versions already marked as an (immutable) sign-off. A test can pre-seed this
  // by passing a `nameVersion` override; by default version 2 is the sign-off
  // marker so the undeletable-named-sign-off test can target it.
  const signoffVersions = new Set<number>([2]);
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
    loadLatestVersion: vi.fn(async (pieceId: string, clientId: string) =>
      pieceId === PIECE_A && clientId === CLIENT_A ? pieceVersion() : null,
    ),
    listPieceVersions: vi.fn(async (pieceId: string, clientId: string) =>
      pieceId === PIECE_A && clientId === CLIENT_A
        ? [
            pieceVersion({ id: "ver-1", version: 1, verdict: "REVISE" }),
            pieceVersion({ id: "ver-2", version: 2, verdict: "REVIEW", isActive: true }),
          ]
        : [],
    ),
    insertDraftPiece: vi.fn(async () => {
      writes.insertDraftPiece += 1;
      return { id: PIECE_A, slug: "test-piece" };
    }),
    transitionPieceStatus: vi.fn(async () => {
      writes.transitionPieceStatus += 1;
    }),
    insertPieceVersion: vi.fn(async (insert: { version: number }) => {
      writes.insertPieceVersion += 1;
      return { id: `ver-${insert.version}`, version: insert.version };
    }),
    nameVersion: vi.fn(
      async (input: {
        pieceId: string;
        clientId: string;
        version: number;
        name: string;
        asSignoff?: boolean;
      }) => {
        // A NAMED sign-off is immutable: naming/overwriting it is rejected. The
        // version-2 fixture is treated as the existing sign-off marker when the
        // test points at it.
        if (signoffVersions.has(input.version)) {
          throw new SignoffImmutableError(input.version);
        }
        if (input.asSignoff) signoffVersions.add(input.version);
        writes.nameVersion += 1;
        return pieceVersion({
          version: input.version,
          name: input.name,
          isSignoff: Boolean(input.asSignoff) || signoffVersions.has(input.version),
        });
      },
    ),
    setActiveVersion: vi.fn(
      async (input: { pieceId: string; clientId: string; version: number }) => {
        writes.setActiveVersion += 1;
        return pieceVersion({ version: input.version, isActive: true });
      },
    ),
    // PR 019 / P1.C.2 — client-review routing + dual sign-off + approval-debt.
    loadCommentThread: vi.fn(
      async (): Promise<PersistedCommentThread | null> => null,
    ),
    listCommentThreads: vi.fn(
      async (): Promise<PersistedCommentThread[]> => [],
    ),
    resolveCommentThread: vi.fn(
      async (input: {
        commentId: string;
        clientId: string;
        addressedInVersion: number;
      }) => {
        writes.resolveCommentThread += 1;
        return commentThread({
          id: input.commentId,
          clientId: input.clientId,
          status: "resolved",
        });
      },
    ),
    insertClientSignoff: vi.fn(async () => {
      writes.insertClientSignoff += 1;
      return { id: "signoff-1" };
    }),
    insertCredentialedRelease: vi.fn(async () => {
      writes.insertCredentialedRelease += 1;
      return { id: "release-1" };
    }),
    listApprovalEvents: vi.fn(
      async (): Promise<PersistedApprovalEvent[]> => [],
    ),
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
