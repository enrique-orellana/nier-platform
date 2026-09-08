import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SubtitleReactionReviewPanel from "./SubtitleReactionReviewPanel";

const suggestions = [
  {
    id: "r0",
    cueIndex: 0,
    text: "That was close",
    startMs: 0,
    endMs: 900,
    emojis: ["😱"],
    enabled: true,
  },
  {
    id: "r1",
    cueIndex: 1,
    text: "We did it",
    startMs: 900,
    endMs: 1800,
    emojis: ["🎉"],
    enabled: true,
  },
];

describe("SubtitleReactionReviewPanel", () => {
  it("shows cue suggestions and exposes edits and removal as controlled changes", () => {
    const onChange = vi.fn();
    render(
      <SubtitleReactionReviewPanel
        suggestions={suggestions}
        style={{ position: "above", animation: "pop", scale: 1 }}
        onChange={onChange}
        onStyleChange={vi.fn()}
        onRetry={vi.fn()}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByText("That was close")).toBeInTheDocument();
    expect(screen.getByDisplayValue("😱")).toBeInTheDocument();
    fireEvent.change(
      screen.getByLabelText("Emoji reaction for That was close"),
      {
        target: { value: "😱 💥" },
      },
    );
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ emojis: ["😱", "💥"] }),
      suggestions[1],
    ]);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove reaction for That was close",
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ enabled: false }),
      suggestions[1],
    ]);
  });

  it("applies enabled suggestions with shared style controls and supports retry", () => {
    const onApply = vi.fn();
    const onStyleChange = vi.fn();
    const onRetry = vi.fn();
    render(
      <SubtitleReactionReviewPanel
        suggestions={[
          { ...suggestions[0], enabled: true },
          { ...suggestions[1], enabled: false },
        ]}
        style={{ position: "above", animation: "pop", scale: 1 }}
        onChange={vi.fn()}
        onStyleChange={onStyleChange}
        onRetry={onRetry}
        onClose={vi.fn()}
        onApply={onApply}
      />,
    );

    fireEvent.change(screen.getByLabelText("Reaction position"), {
      target: { value: "left" },
    });
    fireEvent.change(screen.getByLabelText("Reaction animation"), {
      target: { value: "shake" },
    });
    fireEvent.change(screen.getByLabelText("Reaction size"), {
      target: { value: "1.5" },
    });
    expect(onStyleChange).toHaveBeenCalledWith(
      expect.objectContaining({ position: "left" }),
    );
    expect(onStyleChange).toHaveBeenCalledWith(
      expect.objectContaining({ animation: "shake" }),
    );
    expect(onStyleChange).toHaveBeenCalledWith(
      expect.objectContaining({ scale: 1.5 }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Apply reactions" }));
    expect(onApply).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "r0", enabled: true })],
      expect.any(Object),
    );
  });

  it("supports an edit-specific title and description", () => {
    render(
      <SubtitleReactionReviewPanel
        title="Edit applied reactions"
        description="Adjust the emoji layer already applied to this subtitle track."
        suggestions={suggestions}
        style={{ position: "above", animation: "pop", scale: 1 }}
        onChange={vi.fn()}
        onStyleChange={vi.fn()}
        onRetry={vi.fn()}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Edit applied reactions" }),
    ).toHaveTextContent(
      "Adjust the emoji layer already applied to this subtitle track.",
    );
  });
});
