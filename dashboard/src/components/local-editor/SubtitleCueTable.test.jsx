import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SubtitleCueTable from "./SubtitleCueTable";

describe("SubtitleCueTable", () => {
  it("keeps table scrolling and row selection out of the cue editor modal", () => {
    const onSelect = vi.fn();
    const cue = {
      id: "cue-1",
      text: "Current caption",
      startMs: 0,
      endMs: 1000,
    };

    render(
      <SubtitleCueTable
        cues={[cue]}
        playheadMs={500}
        onSelect={onSelect}
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Scroll to current subtitle" }),
    );
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("row", { name: /Current caption/ }));
    expect(onSelect).toHaveBeenCalledWith(cue, "subtitle", {
      openEditor: false,
    });
  });

  it("clearly marks the cue at the current playhead", () => {
    render(
      <SubtitleCueTable
        cues={[
          { id: "cue-1", text: "Previous", startMs: 0, endMs: 1000 },
          { id: "cue-2", text: "Current caption", startMs: 1000, endMs: 2000 },
        ]}
        playheadMs={1500}
        onSelect={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("CURRENT")).toBeInTheDocument();
    const currentRow = screen.getByRole("row", { name: /Current caption/ });
    expect(currentRow).toHaveAttribute("aria-current", "time");
    expect(currentRow).toHaveAttribute("data-current-cue", "true");
  });

  it("displays cue times as frame-accurate timecode", () => {
    render(
      <SubtitleCueTable
        fps={30}
        cues={[{ id: "cue-1", text: "Frame cue", startMs: 1966, endMs: 3000 }]}
        playheadMs={0}
        onSelect={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue("00:00:01:29")).toBeInTheDocument();
    expect(screen.getByDisplayValue("00:00:03:00")).toBeInTheDocument();
  });
});
