import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../RemotionPreview", () => ({
  default: ({ subtitles }) => (
    <div data-testid="subtitle-details-preview">
      {subtitles.captions.map((cue) => cue.text).join(" | ")}
    </div>
  ),
}));

import SubtitleDetailsModal from "./SubtitleDetailsModal";

describe("SubtitleDetailsModal", () => {
  it("shows saved cue text, relative/master timestamps, and a rendered preview", () => {
    render(
      <SubtitleDetailsModal
        isOpen
        onClose={vi.fn()}
        videoUrl="/videos/job-1/clip.mp4"
        clip={{
          start: 120,
          end: 124,
          subtitle_tracks: [
            {
              id: "original",
              language: "en",
              cues: [{ text: "Hello there", startMs: 500, endMs: 1500 }],
            },
          ],
          active_subtitle_track_id: "original",
        }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: /subtitle details/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Hello there")).toHaveLength(2);
    expect(screen.getByText("00:00.500 → 00:01.500")).toBeInTheDocument();
    expect(screen.getByText("02:00.500 → 02:01.500")).toBeInTheDocument();
    expect(screen.getByTestId("subtitle-details-preview")).toHaveTextContent(
      "Hello there",
    );
  });
});
