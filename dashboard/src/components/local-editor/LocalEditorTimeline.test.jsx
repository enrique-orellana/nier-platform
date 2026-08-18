import React from "react";
import { render, screen } from "@testing-library/react";
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

    expect(screen.getByTestId("local-editor-timeline-scroll")).toHaveClass(
      "overflow-x-auto",
    );
    expect(screen.getByTestId("local-editor-timeline-canvas")).toHaveStyle({
      width: "2544px",
    });
    expect(screen.getByRole("button", { name: "Caption" })).toBeInTheDocument();
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
