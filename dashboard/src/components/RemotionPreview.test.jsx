import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RemotionPreview from "./RemotionPreview";

const playMock = vi.hoisted(() => vi.fn());
const pauseMock = vi.hoisted(() => vi.fn());
const seekToMock = vi.hoisted(() => vi.fn());
const unmuteMock = vi.hoisted(() => vi.fn());
const playerPropsMock = vi.hoisted(() => vi.fn());
const playerEmitMock = vi.hoisted(() => vi.fn());

vi.mock("@remotion/player", () => ({
  Player: forwardRef(({ children, ...props }, ref) => {
    playerPropsMock(props);
    const listeners = useRef({}).current;
    useImperativeHandle(
      ref,
      () => ({
        addEventListener: (name, callback) => {
          listeners[name] = callback;
        },
        removeEventListener: vi.fn(),
        seekTo: seekToMock,
        play: playMock,
        pause: pauseMock,
        unmute: unmuteMock,
        emit: playerEmitMock,
      }),
      [listeners],
    );
    playerEmitMock.mockImplementation((name, detail) =>
      listeners[name]?.({ detail }),
    );
    return (
      <button
        type="button"
        onClick={() => listeners.frameupdate?.({ detail: { frame: 180 } })}
      >
        player{children}
      </button>
    );
  }),
}));

describe("RemotionPreview", () => {
  it("forwards player frame events to the shared editor clock", () => {
    const onFrameChange = vi.fn();
    render(
      <RemotionPreview videoUrl="/video.mp4" onFrameChange={onFrameChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /player/i }));
    expect(onFrameChange).toHaveBeenCalledWith(180);
  });

  it("plays immediately when the editor transport requests playback", () => {
    render(<RemotionPreview videoUrl="/video.mp4" playing={false} />);
    window.dispatchEvent(
      new CustomEvent("openshorts:playback-request", { detail: true }),
    );
    expect(playMock).toHaveBeenCalled();
  });

  it("passes the master-video offset into the Remotion composition", () => {
    playerPropsMock.mockClear();
    render(
      <RemotionPreview videoUrl="/master.mp4" videoStartSeconds={1042.5} />,
    );
    expect(playerPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        inputProps: expect.objectContaining({ videoStartSeconds: 1042.5 }),
      }),
    );
  });

  it("forwards the controlled playback rate to Remotion Player", () => {
    playerPropsMock.mockClear();
    const { rerender } = render(
      <RemotionPreview videoUrl="/video.mp4" playbackRate={1} />,
    );
    expect(playerPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ playbackRate: 1 }),
    );

    rerender(<RemotionPreview videoUrl="/video.mp4" playbackRate={1.5} />);
    expect(playerPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ playbackRate: 1.5 }),
    );
  });

  it("forwards the native media clock callback to the composition", () => {
    playerPropsMock.mockClear();
    const onMediaTimeChange = vi.fn();
    render(
      <RemotionPreview
        videoUrl="/video.mp4"
        onMediaTimeChange={onMediaTimeChange}
      />,
    );

    const playerProps = playerPropsMock.mock.lastCall[0];
    act(() => playerProps.inputProps.onMediaTimeChange(750));

    expect(onMediaTimeChange).toHaveBeenCalledWith(750);
  });

  it("does not seek backward from a delayed editor clock while playing", () => {
    seekToMock.mockClear();
    const { rerender } = render(
      <RemotionPreview
        videoUrl="/video.mp4"
        currentFrame={0}
        playing={false}
      />,
    );

    seekToMock.mockClear();
    rerender(
      <RemotionPreview
        videoUrl="/video.mp4"
        currentFrame={12}
        playing={false}
      />,
    );

    expect(seekToMock).toHaveBeenCalledWith(12);
  });

  it("does not seek to a stale frame when playback pauses during buffering", () => {
    seekToMock.mockClear();
    playerEmitMock.mockClear();
    const { rerender } = render(
      <RemotionPreview videoUrl="/video.mp4" currentFrame={0} playing={true} />,
    );

    act(() => playerEmitMock("pause"));
    rerender(
      <RemotionPreview
        videoUrl="/video.mp4"
        currentFrame={0}
        playing={false}
      />,
    );

    expect(seekToMock).not.toHaveBeenCalled();

    rerender(
      <RemotionPreview
        videoUrl="/video.mp4"
        currentFrame={12}
        playing={false}
      />,
    );
    expect(seekToMock).toHaveBeenCalledWith(12);
  });

  it("passes the standard layout into the Remotion composition", () => {
    playerPropsMock.mockClear();
    render(
      <RemotionPreview
        videoUrl="/master.mp4"
        layout={{ format: "standard", facecam_size: "medium" }}
      />,
    );
    expect(playerPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        inputProps: expect.objectContaining({
          layout: { format: "standard", facecam_size: "medium" },
        }),
      }),
    );
  });

  it("does not render an audio recovery overlay", () => {
    playerPropsMock.mockClear();
    render(<RemotionPreview videoUrl="/video.mp4" />);

    const playerProps = playerPropsMock.mock.lastCall[0];
    act(() => playerProps.inputProps.onAutoPlayError?.());

    expect(
      screen.queryByRole("button", { name: /play with sound/i }),
    ).not.toBeInTheDocument();
  });
});
