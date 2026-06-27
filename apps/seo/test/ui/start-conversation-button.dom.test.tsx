// @vitest-environment jsdom

/**
 * studio-ui (Slice 5 / P-I): the "Start a new piece" button interaction suite (jsdom).
 *
 * The home page's new-thread affordance. Via a REAL DOM render + a scripted fetch
 * double + an injected navigate, these prove:
 *
 *   - POST /api/conversations carries EXACTLY { clientId } (the SERVER binds the
 *     workspace + creates the row; the button cannot widen tenancy).
 *   - on { conversationId } it navigates to /canvas?conversation=<id> (encoded).
 *   - it is single-flight (disabled while the POST is in flight).
 *   - a failed create surfaces an inline error and re-enables the button.
 *
 * `next/navigation`'s `useRouter` is mocked so the component renders without the App
 * Router provider; the navigation assertion uses the injected `onNavigate` seam.
 */

import "./setup-dom";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

import { StartConversationButton } from "@/app/(studio)/StartConversationButton";

const CLIENT = "22222222-2222-2222-2222-222222222222";
const CONV = "11111111-1111-1111-1111-111111111111";

describe("StartConversationButton", () => {
  it("POSTs { clientId } only and navigates to the new canvas thread", async () => {
    let postBody: Record<string, unknown> | null = null;
    let postMethod: string | undefined;
    const fetchImpl = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      expect(url).toBe("/api/conversations");
      postMethod = init?.method;
      if (init?.body) postBody = JSON.parse(init.body) as Record<string, unknown>;
      return { ok: true, status: 201, json: async () => ({ conversationId: CONV }) } as unknown as Response;
    });
    const navigated: string[] = [];

    render(
      <StartConversationButton
        clientId={CLIENT}
        fetchImpl={fetchImpl as never}
        onNavigate={(href) => navigated.push(href)}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("start-conversation"));
    });

    await waitFor(() => expect(navigated.length).toBe(1));
    expect(postMethod).toBe("POST");
    // EXACTLY the bound client id — nothing else (no workspaceId, no title required).
    expect(Object.keys(postBody!)).toEqual(["clientId"]);
    expect(postBody).toEqual({ clientId: CLIENT });
    expect(navigated[0]).toBe(`/canvas?conversation=${CONV}`);
  });

  it("surfaces an inline error and re-enables on a failed create", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response));
    const navigated: string[] = [];

    render(
      <StartConversationButton
        clientId={CLIENT}
        fetchImpl={fetchImpl as never}
        onNavigate={(href) => navigated.push(href)}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("start-conversation"));
    });

    await waitFor(() => expect(screen.getByTestId("start-error")).toBeInTheDocument());
    expect(navigated.length).toBe(0);
    // Re-enabled so the operator can retry.
    expect(screen.getByTestId("start-conversation")).not.toBeDisabled();
  });
});
