import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const remotionVideoPropsMock = vi.hoisted(() => vi.fn());

vi.mock("remotion", () => ({
  AbsoluteFill: ({ children }) => <div>{children}</div>,
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
  it("renders the standard layout with a blurred background and contained foreground", () => {
    remotionVideoPropsMock.mockClear();

    render(
      <ShortVideo
        videoUrl="/videos/master.mp4"
        layout={{ format: "standard" }}
      />,
    );

    expect(screen.getAllByTestId("remotion-video")).toHaveLength(2);
    expect(remotionVideoPropsMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        objectFit: "cover",
        muted: true,
        style: expect.objectContaining({
          position: "absolute",
          inset: 0,
          filter: expect.stringContaining("blur"),
        }),
      }),
    );
    expect(screen.getAllByTestId("remotion-video")[1]).toHaveStyle({
      position: "absolute",
      inset: "0",
    });
    expect(screen.getAllByTestId("remotion-video")[1]).toHaveAttribute(
      "objectfit",
      "contain",
    );
  });

  it("uses the Remotion media decoder in the Player", () => {
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
      expect.objectContaining({ trimBefore: 510 }),
    );
  });

  it("uses the browser-compatible Remotion Video for rendering", () => {
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
      expect.objectContaining({ trimBefore: 510, objectFit: "cover" }),
    );
  });

  it("seeks the browser preview to the master offset when metadata loads", () => {
    render(
      <ShortVideo
        videoUrl="/videos/master.mp4"
        videoStartSeconds={17}
        fps={30}
      />,
    );
    expect(remotionVideoPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({ trimBefore: 510 }),
    );
  });

  it("forwards fallback autoplay failures to the preview controller", () => {
    const onAutoPlayError = vi.fn();
    remotionVideoPropsMock.mockClear();

    render(
      <ShortVideo
        videoUrl="/videos/clip.mp4"
        onAutoPlayError={onAutoPlayError}
      />,
    );

    expect(remotionVideoPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbackOffthreadVideoProps: expect.objectContaining({
          onAutoPlayError,
        }),
      }),
    );
  });
});
