import React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const remotionVideoPropsMock = vi.hoisted(() => vi.fn());
const subtitlesPropsMock = vi.hoisted(() => vi.fn());
const remotionEnvironmentMock = vi.hoisted(() => ({ isRendering: false }));
const timelineContextMock = vi.hoisted(() => ({
  playing: false,
  imperativePlaying: { current: false },
  audioAndVideoTags: { current: [] },
}));

vi.mock("remotion", () => ({
  AbsoluteFill: ({ children }) => <div>{children}</div>,
  useRemotionEnvironment: () => remotionEnvironmentMock,
  useCurrentFrame: () => 0,
  useVideoConfig: () => ({ fps: 30 }),
  Internals: {
    Timeline: {
      useTimelineContext: () => timelineContextMock,
    },
  },
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

vi.mock("./Subtitles", () => ({
  Subtitles: (props) => {
    subtitlesPropsMock(props);
    return null;
  },
}));
vi.mock("./HookOverlay", () => ({ HookOverlay: () => null }));

import { ShortVideo } from "./ShortVideo";
import { getMediaTimeMs } from "./ShortVideo";

describe("ShortVideo media source", () => {
  beforeEach(() => {
    subtitlesPropsMock.mockClear();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  });

  afterEach(() => {
    remotionEnvironmentMock.isRendering = false;
    timelineContextMock.playing = false;
    timelineContextMock.imperativePlaying.current = false;
    timelineContextMock.audioAndVideoTags.current = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("converts the playing media clock to composition time", () => {
    expect(getMediaTimeMs(1043.25, 1042.5)).toBe(750);
  });

  it("passes the native media clock to live subtitles", () => {
    const animationFrames = [];
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    timelineContextMock.playing = true;

    render(
      <ShortVideo
        videoUrl="/videos/master.mp4"
        videoStartSeconds={10}
        subtitles={{ captions: [] }}
      />,
    );

    const video = screen.getByTestId("native-browser-video");
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      value: 10.75,
      writable: true,
    });
    act(() => animationFrames[0]?.());

    expect(subtitlesPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ mediaTimeMs: 750 }),
    );
  });

  it("renders the standard layout with a blurred background and contained foreground", () => {
    remotionVideoPropsMock.mockClear();

    render(
      <ShortVideo
        videoUrl="/videos/master.mp4"
        layout={{ format: "standard" }}
      />,
    );

    expect(screen.queryAllByTestId("remotion-video")).toHaveLength(0);
    expect(screen.getAllByTestId("native-browser-video")).toHaveLength(1);
    expect(screen.getByTestId("native-browser-video")).toHaveStyle({
      position: "absolute",
      inset: "0",
    });
    expect(screen.getByTestId("native-browser-video")).toHaveStyle({
      objectFit: "contain",
    });
  });

  it("uses the browser-compatible video decoder in the Player", () => {
    render(
      <ShortVideo
        videoUrl="/videos/clip.mp4"
        videoStartSeconds={17}
        fps={30}
      />,
    );
    expect(screen.getByTestId("native-browser-video")).toHaveAttribute(
      "src",
      "/videos/clip.mp4",
    );
  });

  it("uses a native browser video without Remotion buffering resync", () => {
    render(<ShortVideo videoUrl="/videos/clip.mp4" />);

    expect(screen.getByTestId("native-browser-video")).toHaveAttribute(
      "preload",
      "auto",
    );
    expect(screen.queryByTestId("html5-video")).not.toBeInTheDocument();
  });

  it("keeps both media layers for the Remotion renderer", () => {
    remotionVideoPropsMock.mockClear();
    remotionEnvironmentMock.isRendering = true;
    render(
      <ShortVideo
        videoUrl="/videos/clip.mp4"
        videoStartSeconds={17}
        fps={30}
        layout={{ format: "standard" }}
      />,
    );
    expect(screen.getAllByTestId("remotion-video")).toHaveLength(2);
    expect(remotionVideoPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({ trimBefore: 510, objectFit: "cover" }),
    );
  });

  it("registers native playback with the Remotion player", () => {
    render(
      <ShortVideo
        videoUrl="/videos/master.mp4"
        videoStartSeconds={17}
        fps={30}
      />,
    );
    expect(screen.getByTestId("native-browser-video")).toHaveAttribute(
      "preload",
      "auto",
    );
    expect(timelineContextMock.audioAndVideoTags.current).toHaveLength(1);
    expect(timelineContextMock.audioAndVideoTags.current[0].play).toEqual(
      expect.any(Function),
    );
  });

  it("uses the native video for autoplay recovery", () => {
    render(<ShortVideo videoUrl="/videos/clip.mp4" />);
    expect(screen.getByTestId("native-browser-video")).toBeInTheDocument();
  });
});
