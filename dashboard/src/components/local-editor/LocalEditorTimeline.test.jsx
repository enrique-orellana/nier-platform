import React, { createRef } from "react";
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

  it("distinguishes the current cue from the selected cue and exposes full text", () => {
    render(
      <LocalEditorTimeline
        durationMs={10000}
        playheadMs={1500}
        selectedId="cue-2"
        subtitleCues={[
          {
            id: "cue-1",
            text: "A long caption that needs a useful hover label",
            startMs: 1000,
            endMs: 2000,
          },
          { id: "cue-2", text: "Selected", startMs: 3000, endMs: 4000 },
        ]}
      />,
    );

    const currentCue = screen.getByRole("button", {
      name: "A long caption that needs a useful hover label",
    });
    const selectedCue = screen.getByRole("button", { name: "Selected" });

    expect(currentCue).toHaveAttribute("data-current-cue", "true");
    expect(currentCue).toHaveAttribute(
      "title",
      "A long caption that needs a useful hover label",
    );
    expect(selectedCue).toHaveAttribute("aria-pressed", "true");
    expect(selectedCue).toHaveAttribute("data-current-cue", "false");
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

  it("updates word timings when a subtitle cue is resized", () => {
    const onChange = vi.fn();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1000,
      height: 100,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 100,
    });
    render(
      <LocalEditorTimeline
        durationMs={10000}
        subtitleCues={[
          {
            id: "cue-1",
            text: "first second",
            startMs: 1000,
            endMs: 3000,
            captions: [
              { text: "first", startMs: 1000, endMs: 1500 },
              { text: "second", startMs: 1500, endMs: 3000 },
            ],
          },
        ]}
        onChange={onChange}
      />,
    );

    screen
      .getByRole("button", { name: "Resize cue end" })
      .dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientX: 0 }),
      );
    window.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: 100 }),
    );

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        endMs: 4000,
        captions: [
          { text: "first", startMs: 1000, endMs: 1750 },
          { text: "second", startMs: 1750, endMs: 4000 },
        ],
      }),
      "subtitle",
    );

    window.dispatchEvent(
      new MouseEvent("pointerup", { bubbles: true, clientX: 100 }),
    );
  });

  it("allows high zoom levels for uninterrupted cue inspection", () => {
    render(<LocalEditorTimeline durationMs={10000} timelineZoom={4} />);

    expect(screen.getByTestId("local-editor-timeline-canvas")).toHaveStyle({
      width: "3344px",
    });
  });

  it("exposes a zoom-to-fit action for the visible timeline viewport", () => {
    const timelineApiRef = createRef();
    const onTimelineZoomChange = vi.fn();

    render(
      <LocalEditorTimeline
        ref={timelineApiRef}
        durationMs={10000}
        onTimelineZoomChange={onTimelineZoomChange}
      />,
    );

    const scroll = screen.getByTestId("local-editor-timeline-scroll");
    Object.defineProperty(scroll, "clientWidth", {
      configurable: true,
      value: 1200,
    });

    timelineApiRef.current.zoomToFit();

    expect(onTimelineZoomChange).toHaveBeenCalledWith(1.3);
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

  it("renders markers at their playhead positions", () => {
    render(
      <LocalEditorTimeline
        durationMs={10000}
        markers={[{ id: "marker-1", timeMs: 2500 }]}
      />,
    );

    expect(screen.getByTestId("local-editor-marker").parentElement).toHaveStyle(
      {
        left: "25%",
      },
    );
  });

  it("selects a marker when its pin is clicked", () => {
    const onMarkerSelect = vi.fn();
    render(
      <LocalEditorTimeline
        durationMs={10000}
        markers={[{ id: "marker-1", timeMs: 2500 }]}
        onMarkerSelect={onMarkerSelect}
      />,
    );

    fireEvent.click(screen.getByTestId("local-editor-marker"));

    expect(onMarkerSelect).toHaveBeenCalledWith("marker-1", 2500);
  });

  it("moves a marker while dragging and commits its new time on release", () => {
    const onMarkerMove = vi.fn();
    render(
      <LocalEditorTimeline
        durationMs={10000}
        markers={[{ id: "marker-1", timeMs: 2500 }]}
        onMarkerMove={onMarkerMove}
      />,
    );

    const marker = screen.getByTestId("local-editor-marker");
    const canvas = screen.getByTestId("local-editor-timeline-canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 944,
      bottom: 200,
      width: 944,
      height: 200,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.mouseDown(marker, { clientX: 344 });
    fireEvent.mouseMove(window, { clientX: 544 });
    fireEvent.mouseUp(window, { clientX: 544 });

    expect(onMarkerMove).toHaveBeenCalledWith("marker-1", 5000);
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
