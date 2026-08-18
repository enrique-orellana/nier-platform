import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./RemotionPreview", () => ({
  default: ({ hook, videoStartSeconds }) => (
    <div
      data-testid="remotion-preview"
      data-layout={hook?.layoutFormat}
      data-facecam-size={hook?.facecamSize}
      data-video-start-seconds={videoStartSeconds}
    />
  ),
}));

import HookModal from "./HookModal";
import { hookConfigSchema } from "../remotion/lib/types";

describe("HookModal", () => {
  it("includes clip layout metadata in the Remotion hook config", () => {
    const onGenerate = vi.fn();
    render(
      <HookModal
        isOpen
        onClose={vi.fn()}
        onGenerate={onGenerate}
        isProcessing={false}
        videoUrl="/videos/job/clip.mp4"
        initialText="Watch this"
        durationInSeconds={30}
        existingSubtitles={null}
        layoutFormat="streamer_stack"
        facecamSize="large"
      />,
    );

    expect(screen.getByTestId("remotion-preview")).toHaveAttribute(
      "data-layout",
      "streamer_stack",
    );
    expect(screen.getByTestId("remotion-preview")).toHaveAttribute(
      "data-facecam-size",
      "large",
    );

    fireEvent.click(screen.getByRole("button", { name: /add hook/i }));

    expect(onGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        remotion: expect.objectContaining({
          layoutFormat: "streamer_stack",
          facecamSize: "large",
        }),
      }),
    );
    expect(
      hookConfigSchema.parse(onGenerate.mock.calls[0][0].remotion),
    ).toMatchObject({
      layoutFormat: "streamer_stack",
      facecamSize: "large",
    });
  });

  it("starts the viral hook preview at the selected clip start", () => {
    render(
      <HookModal
        isOpen
        onClose={vi.fn()}
        onGenerate={vi.fn()}
        isProcessing={false}
        videoUrl="/videos/job-1/clip.mp4"
        videoStartSeconds={34}
        durationInSeconds={17}
      />,
    );

    expect(screen.getByTestId("remotion-preview")).toHaveAttribute(
      "data-video-start-seconds",
      "34",
    );
  });
});
