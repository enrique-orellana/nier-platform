import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SubtitleCueModal from "./SubtitleCueModal";

describe("SubtitleCueModal", () => {
  const cue = {
    id: "cue-1",
    text: "No,",
    startMs: 2280,
    endMs: 3260,
    captions: [{ text: "No,", startMs: 2280, endMs: 3260 }],
  };

  it("saves subtitle text, cue timing, and word timing edits together", () => {
    const onSave = vi.fn();
    render(<SubtitleCueModal cue={cue} onSave={onSave} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Subtitle text"), {
      target: { value: "Yes!" },
    });
    fireEvent.change(screen.getByLabelText("Subtitle start"), {
      target: { value: "2400" },
    });
    fireEvent.change(screen.getByLabelText("Word 1 end"), {
      target: { value: "3100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save cue" }));

    expect(onSave).toHaveBeenCalledWith({
      ...cue,
      text: "Yes!",
      startMs: 2400,
      captions: [{ text: "No,", startMs: 2280, endMs: 3100 }],
    });
  });

  it("discards edits when closed", () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    render(<SubtitleCueModal cue={cue} onSave={onSave} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("Subtitle text"), {
      target: { value: "Discard me" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close cue editor" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the cue editor focused and does not render a delete action", () => {
    render(
      <SubtitleCueModal
        cue={cue}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog")).toHaveClass(
      "max-w-2xl",
      "rounded-xl",
      "p-5",
    );
    expect(
      screen.queryByRole("button", { name: "Delete subtitle cue" }),
    ).not.toBeInTheDocument();
  });
});
