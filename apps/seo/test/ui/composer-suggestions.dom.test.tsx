// @vitest-environment jsdom

/**
 * S1 — ChatComposer next-best-action chips. The composer always offers the
 * operator a next step: a "send" chip dispatches immediately, a "fill" chip
 * populates the textarea to finish, and chips hide while a turn is in flight.
 */

import "./setup-dom";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ChatComposer } from "@/app/(studio)/agent/ChatComposer";

describe("ChatComposer suggestions (S1)", () => {
  it("a send-chip dispatches the turn immediately", () => {
    const onSend = vi.fn();
    render(
      <ChatComposer
        onSend={onSend}
        inFlight={false}
        suggestions={[{ label: "Author hub pages", prompt: "Author hub pages" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Author hub pages/ }));
    expect(onSend).toHaveBeenCalledWith("Author hub pages");
  });

  it("a fill-chip populates the textarea instead of sending", () => {
    const onSend = vi.fn();
    render(
      <ChatComposer
        onSend={onSend}
        inFlight={false}
        suggestions={[{ label: "Revise this draft", prompt: "Revise the current draft: ", fill: true }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Revise this draft/ }));
    expect(onSend).not.toHaveBeenCalled();
    const input = screen.getByTestId("chat-composer-input") as HTMLTextAreaElement;
    expect(input.value).toBe("Revise the current draft: ");
  });

  it("hides chips while a turn is in flight", () => {
    render(
      <ChatComposer
        onSend={vi.fn()}
        inFlight
        suggestions={[{ label: "Author hub pages", prompt: "Author hub pages" }]}
      />,
    );
    expect(screen.queryByTestId("composer-suggestions")).not.toBeInTheDocument();
  });
});
