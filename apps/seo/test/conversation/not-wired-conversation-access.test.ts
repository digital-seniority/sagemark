/**
 * not-wired-conversation-access.test.ts — the fail-closed default + the creds-gated
 * resolver safe-default (Slice 5, lane schema-tenancy).
 *
 * Proves:
 *   (a) every `NOT_WIRED_CONVERSATION_ACCESS` method THROWS a clear
 *       `ConversationAccessNotWiredError` (never silently succeeds / fabricates);
 *   (b) the live adapter factory returns null without service-role creds, so
 *       `resolveConversationDataAccess()` returns the fail-closed NOT_WIRED default
 *       (the SAFE DEFAULT: a merge with no env set changes nothing live).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  NOT_WIRED_CONVERSATION_ACCESS,
  ConversationAccessNotWiredError,
} from "@/lib/conversation/context";
import { makeLiveConversationDataAccess } from "@/lib/conversation/live-conversation-data-access";
import { resolveConversationDataAccess } from "@/lib/conversation/resolve-conversation-access";

// Capture + clear the creds env so the "no creds" path is deterministic.
const CRED_ENV = [
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_ROLE",
] as const;

describe("NOT_WIRED_CONVERSATION_ACCESS: every method fails closed (throws)", () => {
  // The stub methods throw SYNCHRONOUSLY (the throw happens at the call site, not
  // as a rejected promise) — so each assertion wraps the call in a thunk. This is
  // the same form the content-kernel NOT_WIRED tests use (activation/resolve-data-access).

  it("createConversation throws ConversationAccessNotWiredError", () => {
    expect(() =>
      NOT_WIRED_CONVERSATION_ACCESS.createConversation({ workspaceId: "w", clientId: "c" }),
    ).toThrow(ConversationAccessNotWiredError);
  });

  it("getConversation throws", () => {
    expect(() =>
      NOT_WIRED_CONVERSATION_ACCESS.getConversation("conv", "w", "c"),
    ).toThrow(ConversationAccessNotWiredError);
  });

  it("listConversations throws", () => {
    expect(() =>
      NOT_WIRED_CONVERSATION_ACCESS.listConversations("w", "c"),
    ).toThrow(ConversationAccessNotWiredError);
  });

  it("listTurns throws", () => {
    expect(() =>
      NOT_WIRED_CONVERSATION_ACCESS.listTurns("conv", "w", "c"),
    ).toThrow(ConversationAccessNotWiredError);
  });

  it("appendTurn throws", () => {
    expect(() =>
      NOT_WIRED_CONVERSATION_ACCESS.appendTurn({
        conversationId: "conv",
        workspaceId: "w",
        clientId: "c",
        seq: 0,
        role: "user",
        content: "x",
      }),
    ).toThrow(ConversationAccessNotWiredError);
  });

  it("nextSeq throws", () => {
    expect(() =>
      NOT_WIRED_CONVERSATION_ACCESS.nextSeq("conv", "w", "c"),
    ).toThrow(ConversationAccessNotWiredError);
  });

  it("setConversationPiece throws", () => {
    expect(() =>
      NOT_WIRED_CONVERSATION_ACCESS.setConversationPiece("conv", "piece", "w", "c"),
    ).toThrow(ConversationAccessNotWiredError);
  });

  it("the error carries the CONVERSATION_ACCESS_NOT_WIRED code + names the op", () => {
    try {
      NOT_WIRED_CONVERSATION_ACCESS.createConversation({ workspaceId: "w", clientId: "c" });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConversationAccessNotWiredError);
      expect((e as ConversationAccessNotWiredError).code).toBe("CONVERSATION_ACCESS_NOT_WIRED");
      expect((e as Error).message).toContain("createConversation");
    }
  });
});

describe("resolver: creds-gated safe-default", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of CRED_ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of CRED_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("the live factory returns null without service-role creds", async () => {
    expect(await makeLiveConversationDataAccess()).toBeNull();
  });

  it("resolveConversationDataAccess returns the fail-closed NOT_WIRED default without creds", async () => {
    const resolved = await resolveConversationDataAccess();
    expect(resolved).toBe(NOT_WIRED_CONVERSATION_ACCESS);
    // And it actually fails closed when called (the stub throws synchronously).
    expect(() =>
      resolved.createConversation({ workspaceId: "w", clientId: "c" }),
    ).toThrow(ConversationAccessNotWiredError);
  });
});
