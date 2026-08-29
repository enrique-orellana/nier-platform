import React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const remotionVideoPropsMock = vi.hoisted(() => vi.fn());
const subtitlesPropsMock = vi.hoisted(() => vi.fn());
const remotionEnvironmentMock = vi.hoisted(() => ({ isRendering: false }));
const currentFrameMock = vi.hoisted(() => ({ value: 0 }));
const playerMutedMock = vi.hoisted(() => ({ value: false }));
const timelineContextMock = vi.hoisted(() => ({
  playing: false,
  imperativePlaying: { current: false },
  audioAndVideoTags: { current: [] },
}));

vi.mock("remotion", () => ({
  AbsoluteFill: ({ children }) => <div>{children}</div>,
  useRemotionEnvironment: () => remotionEnvironmentMock,
  useCurrentFrame: () => currentFrameMock.value,
  useVideoConfig: () => ({ fps: 30, durationInFrames: 300 }),
  Internals: {
    usePlayerMutedState: () => [playerMutedMock.value, vi.fn()],
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
    currentFrameMock.value = 0;
    playerMutedMock.value = false;
    timelineContextMock.playing = false;
    timelineContextMock.imperativePlaying.current = false;
    timelineContextMock.audioAndVideoTags.current = [];
    vi.useRealTimers();
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

    const video = screen.getByTestId("native-browser-audio");
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

  it("forwards the native media clock to the editor", () => {
    const animationFrames = [];
    const onMediaTimeChange = vi.fn();
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
        onMediaTimeChange={onMediaTimeChange}
      />,
    );

    const video = screen.getByTestId("native-browser-audio");
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      value: 10.75,
      writable: true,
    });
    act(() => animationFrames[0]?.());

    expect(onMediaTimeChange).toHaveBeenCalledWith(750);
  });

  it("switches preview layouts from the uninterrupted native media clock", () => {
    const animationFrames = [];
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    timelineContextMock.playing = true;
    currentFrameMock.value = 0;

    render(
      <ShortVideo
        videoUrl="/videos/master.mp4"
        fps={30}
        layout={{
          format: "streamer_stack",
          segments: [
            {
              id: "streamer",
              startMs: 0,
              endMs: 5000,
              format: "streamer_stack",
              transition: "cut",
            },
            {
              id: "standard",
              startMs: 5000,
              endMs: 10000,
              format: "standard",
              transition: "cut",
            },
          ],
        }}
      />,
    );

    const audio = screen.getByTestId("native-browser-audio");
    Object.defineProperty(audio, "currentTime", {
      configurable: true,
      value: 5.25,
      writable: true,
    });
    act(() => animationFrames[0]?.());

    expect(screen.getAllByTestId("native-browser-video")).toHaveLength(1);
    expect(screen.getByTestId("native-browser-video")).toHaveStyle({
      objectFit: "contain",
    });
  });

  it("keeps the active native video mounted when a cut layout segment starts", () => {
    currentFrameMock.value = 149;
    const props = {
      videoUrl: "/videos/master.mp4",
      fps: 30,
      layout: {
        format: "standard",
        segments: [
          {
            id: "standard",
            startMs: 0,
            endMs: 5000,
            format: "standard",
            transition: "cut",
          },
          {
            id: "streamer",
            startMs: 5000,
            endMs: 10000,
            format: "streamer_stack",
            transition: "cut",
          },
        ],
      },
    };

    const { rerender } = render(<ShortVideo {...props} />);
    const videoBeforeBoundary = screen.getAllByTestId(
      "native-browser-video",
    )[0];

    currentFrameMock.value = 150;
    rerender(<ShortVideo {...props} />);

    expect(screen.getAllByTestId("native-browser-video")[0]).toBe(
      videoBeforeBoundary,
    );
  });

  it("keeps one persistent audio clock when switching from streamer to standard", () => {
    timelineContextMock.playing = true;
    currentFrameMock.value = 149;
    const props = {
      videoUrl: "/videos/master.mp4",
      fps: 30,
      layout: {
        format: "streamer_stack",
        segments: [
          {
            id: "streamer",
            startMs: 0,
            endMs: 5000,
            format: "streamer_stack",
            transition: "cut",
          },
          {
            id: "standard",
            startMs: 5000,
            endMs: 10000,
            format: "standard",
            transition: "cut",
          },
        ],
      },
    };

    const { rerender } = render(<ShortVideo {...props} />);
    const audioBeforeBoundary = screen.getByTestId("native-browser-audio");

    currentFrameMock.value = 150;
    rerender(<ShortVideo {...props} />);

    expect(screen.getByTestId("native-browser-audio")).toBe(
      audioBeforeBoundary,
    );
    expect(
      screen
        .getAllByTestId("native-browser-video")
        .every((video) => video.muted),
    ).toBe(true);
    expect(screen.getAllByTestId("native-browser-video")[0]).toHaveStyle({
      objectFit: "contain",
    });
  });

  it("applies the player mute state to the persistent audio clock", () => {
    const props = { videoUrl: "/videos/master.mp4", fps: 30 };
    const { rerender } = render(<ShortVideo {...props} />);
    const audio = screen.getByTestId("native-browser-audio");

    expect(audio.muted).toBe(false);

    playerMutedMock.value = true;
    rerender(<ShortVideo {...props} />);

    expect(audio.muted).toBe(true);
  });

  it("does not seek the persistent audio clock to a delayed frame while playing", () => {
    timelineContextMock.playing = true;
    currentFrameMock.value = 100;
    const props = { videoUrl: "/videos/master.mp4", fps: 30 };
    const { rerender } = render(<ShortVideo {...props} />);
    const audio = screen.getByTestId("native-browser-audio");

    Object.defineProperty(audio, "currentTime", {
      configurable: true,
      value: 10,
      writable: true,
    });

    currentFrameMock.value = 120;
    rerender(<ShortVideo {...props} />);

    expect(audio.currentTime).toBe(10);
  });

  it("does not seek visual layout clocks to a delayed frame while playing", () => {
    timelineContextMock.playing = true;
    currentFrameMock.value = 149;
    const props = {
      videoUrl: "/videos/master.mp4",
      fps: 30,
      layout: {
        format: "standard",
        segments: [
          {
            id: "standard",
            startMs: 0,
            endMs: 5000,
            format: "standard",
            transition: "cut",
          },
          {
            id: "streamer",
            startMs: 5000,
            endMs: 10000,
            format: "streamer_stack",
            transition: "cut",
          },
        ],
      },
    };
    const { rerender } = render(<ShortVideo {...props} />);
    const video = screen.getByTestId("native-browser-video");
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      value: 10,
      writable: true,
    });

    currentFrameMock.value = 180;
    rerender(<ShortVideo {...props} />);

    expect(video.currentTime).toBe(10);
  });

  it("keeps the outgoing native video mounted when a crossfade starts", () => {
    currentFrameMock.value = 149;
    const props = {
      videoUrl: "/videos/master.mp4",
      fps: 30,
      layout: {
        format: "standard",
        segments: [
          {
            id: "standard",
            startMs: 0,
            endMs: 5000,
            format: "standard",
            transition: "cut",
          },
          {
            id: "streamer",
            startMs: 5000,
            endMs: 10000,
            format: "streamer_stack",
            transition: "crossfade",
            transitionDurationMs: 1000,
          },
        ],
      },
    };

    const { rerender } = render(<ShortVideo {...props} />);
    const videoBeforeTransition = screen.getByTestId("native-browser-video");

    currentFrameMock.value = 150;
    rerender(<ShortVideo {...props} />);

    expect(screen.getAllByTestId("native-browser-video")).toContain(
      videoBeforeTransition,
    );
    expect(videoBeforeTransition).toHaveStyle({ objectFit: "contain" });
  });

  it("lets only the active crossfade layer publish the native media clock", () => {
    const animationFrames = [];
    const onMediaTimeChange = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    timelineContextMock.playing = true;
    currentFrameMock.value = 150;

    render(
      <ShortVideo
        videoUrl="/videos/master.mp4"
        fps={30}
        onMediaTimeChange={onMediaTimeChange}
        layout={{
          format: "standard",
          segments: [
            {
              id: "standard",
              startMs: 0,
              endMs: 5000,
              format: "standard",
              transition: "cut",
            },
            {
              id: "streamer",
              startMs: 5000,
              endMs: 10000,
              format: "streamer_stack",
              transition: "crossfade",
              transitionDurationMs: 1000,
            },
          ],
        }}
      />,
    );

    expect(screen.getAllByTestId("native-browser-video")).toHaveLength(3);
    expect(animationFrames).toHaveLength(1);
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

  it("renders the selected webcam and gameplay regions in a streamer stack", () => {
    remotionEnvironmentMock.isRendering = true;
    remotionVideoPropsMock.mockClear();

    render(
      <ShortVideo
        videoUrl="/videos/master.mp4"
        fps={60}
        width={1080}
        height={1920}
        layout={{
          format: "streamer_stack",
          facecam_size: "medium",
          source_width: 1920,
          source_height: 1080,
          webcam_region: { x: 0.05, y: 0.1, width: 0.25, height: 0.3 },
          gameplay_region: { x: 0.3, y: 0.05, width: 0.65, height: 0.9 },
          gameplay_zoom: 1,
        }}
      />,
    );

    expect(screen.queryAllByTestId("remotion-video")).toHaveLength(2);
    expect(remotionVideoPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        style: expect.objectContaining({
          width: expect.stringContaining("%"),
          height: expect.stringContaining("%"),
          maxWidth: "none",
          maxHeight: "none",
        }),
      }),
    );
    expect(
      remotionVideoPropsMock.mock.calls.some(
        ([props]) => props.style?.left !== "0%" || props.style?.top !== "0%",
      ),
    ).toBe(true);
  });

  it("uses the active segment framing instead of the clip-level gameplay defaults", () => {
    remotionEnvironmentMock.isRendering = true;
    remotionVideoPropsMock.mockClear();

    const layout = {
      format: "streamer_stack",
      facecam_size: "medium",
      source_width: 1920,
      source_height: 1080,
      webcam_region: { x: 0.05, y: 0.1, width: 0.25, height: 0.3 },
      gameplay_region: { x: 0.3, y: 0.05, width: 0.65, height: 0.9 },
      gameplay_focus: { x: 0.45, y: 0.5 },
      gameplay_zoom: 1,
      segments: [
        {
          id: "streamer",
          startMs: 0,
          endMs: 10000,
          format: "streamer_stack",
          gameplay_focus: { x: 0.8, y: 0.35 },
          gameplay_zoom: 1.6,
        },
      ],
    };

    render(
      <ShortVideo
        videoUrl="/videos/master.mp4"
        fps={60}
        width={1080}
        height={1920}
        layout={layout}
      />,
    );

    const gameplayVideo = remotionVideoPropsMock.mock.calls
      .map(([props]) => props)
      .find((props) => Number.parseFloat(props.style?.height) < 200);
    expect(gameplayVideo.style.left).not.toBe("0%");
    expect(gameplayVideo.style.width).toContain("%");
  });

  it("shows the crop editor over the active streamer gameplay panel without another video", () => {
    remotionEnvironmentMock.isRendering = false;
    remotionVideoPropsMock.mockClear();

    render(
      <ShortVideo
        videoUrl="/videos/master.mp4"
        fps={30}
        width={1080}
        height={1920}
        gameplayCropEditing
        layout={{
          format: "streamer_stack",
          source_width: 1920,
          source_height: 1080,
          gameplay_region: { x: 0.1, y: 0.05, width: 0.8, height: 0.9 },
          segments: [
            {
              id: "streamer",
              startMs: 0,
              endMs: 10000,
              format: "streamer_stack",
            },
          ],
        }}
      />,
    );

    expect(
      screen.getByTestId("gameplay-crop-editor-stage"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("native-browser-video")).toHaveLength(2);
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

  it("applies the controlled playback rate to the browser video", () => {
    const { rerender } = render(
      <ShortVideo videoUrl="/videos/clip.mp4" playbackRate={1} />,
    );

    const video = screen.getByTestId("native-browser-video");
    expect(video.playbackRate).toBe(1);

    rerender(<ShortVideo videoUrl="/videos/clip.mp4" playbackRate={1.5} />);

    expect(video.playbackRate).toBe(1.5);
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
    expect(
      timelineContextMock.audioAndVideoTags.current.length,
    ).toBeGreaterThan(0);
    expect(timelineContextMock.audioAndVideoTags.current[0].play).toEqual(
      expect.any(Function),
    );
  });

  it("uses the native video for autoplay recovery", () => {
    render(<ShortVideo videoUrl="/videos/clip.mp4" />);
    expect(screen.getByTestId("native-browser-video")).toBeInTheDocument();
  });
});
