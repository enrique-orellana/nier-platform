import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import VideoPreview from "./VideoPreview";

describe("VideoPreview", () => {
  it("only preloads video metadata for gallery cards", () => {
    const { container } = render(
      <VideoPreview
        videoRef={{ current: null }}
        currentVideoUrl="https://media.example/video.mp4"
        trueOriginalUrl="https://media.example/video.mp4"
        index={0}
        isEditing={false}
        isConvertingNativeShort={false}
        isQualityImproving={false}
        clip={{ start: 0 }}
      />,
    );

    expect(container.querySelector("video")).toHaveAttribute(
      "preload",
      "metadata",
    );
  });
});
