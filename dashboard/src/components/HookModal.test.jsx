import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./RemotionPreview", () => ({
  default: ({ videoStartSeconds }) => (
    <div
      data-testid="hook-preview"
      data-video-start-seconds={videoStartSeconds}
    />
  ),
}));

import HookModal from "./HookModal";

describe("HookModal", () => {
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

    expect(screen.getByTestId("hook-preview")).toHaveAttribute(
      "data-video-start-seconds",
      "34",
    );
  });
});
