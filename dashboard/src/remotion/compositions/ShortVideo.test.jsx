import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const useRemotionEnvironmentMock = vi.hoisted(() => vi.fn());
const html5VideoPropsMock = vi.hoisted(() => vi.fn());
const remotionVideoPropsMock = vi.hoisted(() => vi.fn());

vi.mock("remotion", () => ({
  AbsoluteFill: ({ children }) => <div>{children}</div>,
  Html5Video: (props) => {
    html5VideoPropsMock(props);
    return <video data-testid="html5-video" {...props} />;
  },
  useRemotionEnvironment: useRemotionEnvironmentMock,
  useCurrentFrame: () => 0,
  useVideoConfig: () => ({ fps: 30 }),
  interpolate: (value) => value,
  Sequence: ({ children }) => <>{children}</>,
  spring: () => 1,
}));

vi.mock("@remotion/media", () => ({
  Video: (props) => {
    remotionVideoPropsMock(props);
    return <video data-testid="remotion-video" {...props} />;
  },
}));

vi.mock("./Subtitles", () => ({ Subtitles: () => null }));
vi.mock("./HookOverlay", () => ({ HookOverlay: () => null }));

import { ShortVideo } from "./ShortVideo";

describe("ShortVideo media source", () => {
  it("uses native HTML5 playback in the Remotion Player", () => {
    useRemotionEnvironmentMock.mockReturnValue({ isRendering: false });
    html5VideoPropsMock.mockClear();
    render(
      <ShortVideo
        videoUrl="/videos/clip.mp4"
        videoStartSeconds={17}
        fps={30}
      />,
    );
    expect(screen.getByTestId("html5-video")).toHaveAttribute(
      "src",
      "/videos/clip.mp4",
    );
    expect(html5VideoPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({ startFrom: 510 }),
    );
  });

  it("uses the browser-compatible Remotion Video for rendering", () => {
    useRemotionEnvironmentMock.mockReturnValue({ isRendering: true });
    remotionVideoPropsMock.mockClear();
    render(
      <ShortVideo
        videoUrl="/videos/clip.mp4"
        videoStartSeconds={17}
        fps={30}
      />,
    );
    expect(screen.getByTestId("remotion-video")).toHaveAttribute(
      "src",
      "/videos/clip.mp4",
    );
    expect(remotionVideoPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({ startFrom: 510 }),
    );
  });

  it("seeks the browser preview to the master offset when metadata loads", () => {
    useRemotionEnvironmentMock.mockReturnValue({ isRendering: false });
    render(
      <ShortVideo
        videoUrl="/videos/master.mp4"
        videoStartSeconds={17}
        fps={30}
      />,
    );
    const video = screen.getByTestId("html5-video");
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      value: 0,
      writable: true,
    });

    fireEvent.loadedMetadata(video);

    expect(video.currentTime).toBe(17);
  });

  it("forwards browser autoplay failures to the preview controller", () => {
    useRemotionEnvironmentMock.mockReturnValue({ isRendering: false });
    const onAutoPlayError = vi.fn();
    html5VideoPropsMock.mockClear();

    render(
      <ShortVideo
        videoUrl="/videos/clip.mp4"
        onAutoPlayError={onAutoPlayError}
      />,
    );

    expect(html5VideoPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({ onAutoPlayError }),
    );
  });
});
