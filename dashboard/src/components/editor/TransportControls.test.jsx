import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TransportControls from "./TransportControls";

describe("TransportControls", () => {
  it("requests playback synchronously with the play click", () => {
    const onPlayingChange = vi.fn();
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    render(
      <TransportControls
        currentFrame={0}
        durationFrames={300}
        fps={30}
        playing={false}
        onPlayingChange={onPlayingChange}
        onFrameChange={vi.fn()}
        zoom={1}
        onZoomChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "play" }));
    expect(onPlayingChange).toHaveBeenCalledWith(true);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "openshorts:playback-request",
        detail: true,
      }),
    );
    dispatchSpy.mockRestore();
  });

  it("offers high zoom levels for uninterrupted cue timeline inspection", () => {
    const onZoomChange = vi.fn();
    render(
      <TransportControls
        currentFrame={0}
        durationFrames={300}
        fps={30}
        playing={false}
        onPlayingChange={vi.fn()}
        onFrameChange={vi.fn()}
        zoom={1}
        onZoomChange={onZoomChange}
      />,
    );

    const zoom = screen.getByRole("combobox", { name: "Timeline zoom" });
    expect(screen.getByRole("option", { name: "400%" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "800%" })).toBeInTheDocument();
    fireEvent.change(zoom, { target: { value: "8" } });

    expect(onZoomChange).toHaveBeenCalledWith(8);
  });

  it("shows the current frame as frame-accurate timecode", () => {
    render(
      <TransportControls
        currentFrame={59}
        durationFrames={300}
        fps={30}
        playing={false}
        onPlayingChange={vi.fn()}
        onFrameChange={vi.fn()}
        zoom={1}
        onZoomChange={vi.fn()}
      />,
    );

    expect(screen.getByText("00:00:01:29")).toBeInTheDocument();
  });
});
