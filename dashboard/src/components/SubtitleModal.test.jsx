import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./RemotionPreview", () => ({
  default: ({ videoStartSeconds }) => (
    <div
      data-testid="subtitle-preview"
      data-video-start-seconds={videoStartSeconds}
    />
  ),
}));

import SubtitleModal from "./SubtitleModal";

describe("SubtitleModal", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          captions: [{ text: "Hello", startMs: 0, endMs: 500 }],
          durationSec: 17,
        }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts the subtitle preview at the selected clip start", async () => {
    render(
      <SubtitleModal
        isOpen
        onClose={vi.fn()}
        onGenerate={vi.fn()}
        isProcessing={false}
        videoUrl="/videos/job-1/clip.mp4"
        jobId="job-1"
        clipIndex={0}
        videoStartSeconds={34}
      />,
    );

    expect(await screen.findByTestId("subtitle-preview")).toHaveAttribute(
      "data-video-start-seconds",
      "34",
    );
  });
});
