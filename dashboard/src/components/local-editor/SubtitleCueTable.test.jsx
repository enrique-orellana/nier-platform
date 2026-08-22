import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SubtitleCueTable from "./SubtitleCueTable";

describe("SubtitleCueTable", () => {
  it("keeps table scrolling and row selection out of the cue editor modal", () => {
    const onSelect = vi.fn();
    const scrollToCurrentRef = { current: null };
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
        followAudio={true}
        onFollowAudioChange={vi.fn()}
        scrollToCurrentRef={scrollToCurrentRef}
      />,
    );

    expect(screen.getByTestId("local-editor-cue-table")).toHaveClass(
      "rounded-none",
    );
    expect(screen.getByRole("table").parentElement).toHaveClass(
      "editor-scrollbar",
    );
    expect(scrollToCurrentRef.current).toEqual(expect.any(Function));
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("row", { name: /Current caption/ }));
    expect(onSelect).toHaveBeenCalledWith(cue, "subtitle", {
      openEditor: false,
    });
  });

  it("does not render general timeline controls inside the cue table", () => {
    render(
      <SubtitleCueTable
        cues={[{ id: "cue-1", text: "Caption", startMs: 0, endMs: 1000 }]}
        onSelect={vi.fn()}
        onChange={vi.fn()}
        followAudio={true}
        onFollowAudioChange={vi.fn()}
        scrollToCurrentRef={{ current: null }}
      />,
    );

    expect(
      screen.queryByTestId("local-editor-playback-controls"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Loop segment")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Follow audio")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Playback speed")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Scroll to current subtitle" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Playback Controls:")).not.toBeInTheDocument();
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

  it("keeps selected and current rows visually distinguishable", () => {
    render(
      <SubtitleCueTable
        cues={[
          { id: "cue-1", text: "Current caption", startMs: 0, endMs: 1000 },
          { id: "cue-2", text: "Selected caption", startMs: 1000, endMs: 2000 },
        ]}
        playheadMs={500}
        selectedId="cue-2"
        onSelect={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    const currentRow = screen.getByRole("row", { name: /Current caption/ });
    const selectedRow = screen.getByRole("row", { name: /Selected caption/ });

    expect(currentRow).toHaveAttribute("data-current-cue", "true");
    expect(currentRow).toHaveAttribute("aria-selected", "false");
    expect(currentRow).toHaveAttribute("data-cue-state", "current");
    expect(selectedRow).toHaveAttribute("data-current-cue", "false");
    expect(selectedRow).toHaveAttribute("aria-selected", "true");
    expect(selectedRow).toHaveAttribute("data-cue-state", "selected");
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

  it("deletes a cue from its table row without selecting the row", () => {
    const onDelete = vi.fn();
    const onSelect = vi.fn();
    const cue = {
      id: "cue-1",
      text: "Delete me",
      startMs: 0,
      endMs: 1000,
    };

    render(
      <SubtitleCueTable
        cues={[cue]}
        onSelect={onSelect}
        onChange={vi.fn()}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Delete subtitle cue cue-1" }),
    );

    expect(onDelete).toHaveBeenCalledWith("cue-1");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
