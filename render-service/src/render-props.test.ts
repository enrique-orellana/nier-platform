import { describe, expect, it } from "vitest";
import { buildRenderProps } from "./render-props.js";

describe("render props", () => {
  it("forwards clip timing and subtitle track selection to Remotion", () => {
    const props = buildRenderProps(
      {
        videoUrl: "/videos/job/master.mp4",
        videoStartSeconds: 380,
        durationInFrames: 2100,
        fps: 30,
        width: 1080,
        height: 1920,
        videoFit: "cover",
        subtitles: { captions: [] },
        subtitleTracks: [
          { id: "original", language: "es", label: "Original", origin: "original", captions: [] },
        ],
        activeSubtitleTrackId: "original",
        hook: { text: "Hook" },
        effects: null,
      },
      "http://renderer:3100/output/job/master.mp4",
    );

    expect(props).toMatchObject({
      videoUrl: "http://renderer:3100/output/job/master.mp4",
      videoStartSeconds: 380,
      subtitleTracks: [{ id: "original" }],
      activeSubtitleTrackId: "original",
      hook: { text: "Hook" },
    });
  });
});
