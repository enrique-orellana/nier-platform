import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const remotionVideoPropsMock = vi.hoisted(() => vi.fn());
const html5VideoPropsMock = vi.hoisted(() => vi.fn());
const remotionEnvironmentMock = vi.hoisted(() => ({ isRendering: false }));

vi.mock("remotion", () => ({
  AbsoluteFill: ({ children }) => <div>{children}</div>,
  Html5Video: (props) => {
    html5VideoPropsMock(props);
    return <video data-testid="html5-video" {...props} />;
  },
  useRemotionEnvironment: () => remotionEnvironmentMock,
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
  afterEach(() => {
    remotionEnvironmentMock.isRendering = false;
  });

  it("renders the standard layout with a blurred background and contained foreground", () => {
    remotionVideoPropsMock.mockClear();
    html5VideoPropsMock.mockClear();

    render(
      <ShortVideo
        videoUrl="/videos/master.mp4"
        layout={{ format: "standard" }}
      />,
    );

    expect(screen.queryAllByTestId("remotion-video")).toHaveLength(0);
    expect(screen.getAllByTestId("html5-video")).toHaveLength(1);
    expect(html5VideoPropsMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        style: expect.objectContaining({
          position: "absolute",
          inset: 0,
          objectFit: "contain",
        }),
      }),
    );
    expect(screen.getByTestId("html5-video")).toHaveStyle({
      position: "absolute",
      inset: "0",
    });
    expect(screen.getByTestId("html5-video")).toHaveStyle({
      objectFit: "contain",
    });
  });

  it("uses the browser-compatible video decoder in the Player", () => {
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
    expect(html5VideoPropsMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ trimBefore: 510 }),
    );
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

  it("seeks the browser preview to the master offset when metadata loads", () => {
    html5VideoPropsMock.mockClear();
    render(
      <ShortVideo
        videoUrl="/videos/master.mp4"
        videoStartSeconds={17}
        fps={30}
      />,
    );
    expect(html5VideoPropsMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ trimBefore: 510 }),
    );
    const video = { currentTime: 0 };
    html5VideoPropsMock.mock.calls[0][0].onLoadedMetadata({
      currentTarget: video,
    });
    expect(video.currentTime).toBe(17);
  });

  it("forwards fallback autoplay failures to the preview controller", () => {
    const onAutoPlayError = vi.fn();
    html5VideoPropsMock.mockClear();

    render(
      <ShortVideo
        videoUrl="/videos/clip.mp4"
        onAutoPlayError={onAutoPlayError}
      />,
    );

    expect(html5VideoPropsMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ onAutoPlayError }),
    );
  });
});
