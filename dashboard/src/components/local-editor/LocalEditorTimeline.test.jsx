import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LocalEditorTimeline from "./LocalEditorTimeline";

vi.mock("./AudioWaveform", () => ({
  default: ({ videoUrl }) => (
    <div data-testid="audio-waveform" data-video-url={videoUrl}>
      {videoUrl ? null : "No audio source"}
    </div>
  ),
}));

describe("LocalEditorTimeline", () => {
  it("extends the timeline canvas for precise subtitle timing", () => {
    render(
      <LocalEditorTimeline
        durationMs={30000}
        subtitleCues={[
          { id: "cue-1", text: "Caption", startMs: 1000, endMs: 2000 },
        ]}
        onSeek={vi.fn()}
      />,
    );

    expect(screen.getByTestId("local-editor-timeline")).toHaveClass(
      "flex",
      "h-full",
      "min-h-0",
      "flex-col",
    );
    expect(screen.getByTestId("local-editor-timeline-scroll")).toHaveClass(
      "min-h-0",
      "flex-1",
      "editor-scrollbar",
      "overflow-x-auto",
    );
    expect(screen.getByTestId("local-editor-timeline-canvas")).toHaveStyle({
      width: "2544px",
    });
    expect(screen.getByRole("button", { name: "Caption" })).toBeInTheDocument();
    expect(screen.getByText("00:00:30:00")).toBeInTheDocument();
  });

  it("brings a selected overlapping cue to the front for editing", () => {
    render(
      <LocalEditorTimeline
        durationMs={10000}
        subtitleCues={[
          { id: "cue-back", text: "Back", startMs: 1000, endMs: 5000 },
          { id: "cue-front", text: "Front", startMs: 2000, endMs: 4000 },
        ]}
        selectedId="cue-front"
      />,
    );

    expect(screen.getByRole("button", { name: "Front" })).toHaveStyle({
      zIndex: "10",
    });
  });

  it("opens a cue editor only on double click", () => {
    const onSelect = vi.fn();
    const onDoubleClick = vi.fn();

    render(
      <LocalEditorTimeline
        durationMs={10000}
        subtitleCues={[
          { id: "cue-1", text: "Caption", startMs: 1000, endMs: 2000 },
        ]}
        onSelect={onSelect}
        onDoubleClick={onDoubleClick}
      />,
    );

    const cue = screen.getByRole("button", { name: "Caption" });
    fireEvent.click(cue);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cue-1" }),
      "subtitle",
    );
    expect(onDoubleClick).not.toHaveBeenCalled();

    fireEvent.doubleClick(cue);
    expect(onDoubleClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cue-1" }),
      "subtitle",
    );
  });

  it("keeps short adjacent subtitle cues at their actual timeline widths", () => {
    render(
      <LocalEditorTimeline
        durationMs={10000}
        subtitleCues={[
          { id: "cue-1", text: "One", startMs: 1000, endMs: 1050 },
          { id: "cue-2", text: "Two", startMs: 1050, endMs: 1100 },
        ]}
        onSeek={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "One" })).not.toHaveStyle({
      minWidth: "18px",
    });
    expect(screen.getByRole("button", { name: "Two" })).not.toHaveStyle({
      minWidth: "18px",
    });
    expect(screen.getByRole("button", { name: "One" })).toHaveStyle({
      width: "0.5%",
    });
    expect(screen.getByRole("button", { name: "Two" })).toHaveStyle({
      width: "0.5%",
    });
  });

  it("allows high zoom levels for uninterrupted cue inspection", () => {
    render(<LocalEditorTimeline durationMs={10000} timelineZoom={4} />);

    expect(screen.getByTestId("local-editor-timeline-canvas")).toHaveStyle({
      width: "3344px",
    });
  });

  it("uses a compact CapCut-style timeline toolbar", () => {
    render(<LocalEditorTimeline durationMs={10000} />);

    expect(
      screen.queryByTestId("local-editor-timeline-toolbar"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Scroll horizontally for precise subtitle timing"),
    ).not.toBeInTheDocument();
  });

  it("renders the audio lane after every cue lane", () => {
    render(
      <LocalEditorTimeline
        durationMs={10000}
        videoUrl="blob:demo"
        hook={{ id: "hook", text: "Hook", startMs: 0, endMs: 1000 }}
        subtitleCues={[
          { id: "cue-1", text: "Caption", startMs: 1000, endMs: 2000 },
        ]}
      />,
    );

    const canvas = screen.getByTestId("local-editor-timeline-canvas");
    const lanes = [...canvas.querySelectorAll('[data-testid$="-track"]')];
    expect(lanes.map((lane) => lane.dataset.testid)).toEqual([
      "local-editor-hook-track",
      "local-editor-subtitles-track",
      "local-editor-audio-track",
    ]);
    expect(screen.getByText("Audio")).toBeInTheDocument();
  });

  it("keeps the audio lane present without a video URL", () => {
    render(<LocalEditorTimeline durationMs={10000} />);

    expect(screen.getByTestId("local-editor-audio-track")).toBeInTheDocument();
    expect(screen.getByText("No audio source")).toBeInTheDocument();
  });
});
