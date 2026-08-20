import { describe, expect, it } from "vitest";
import { renderRequestSchema } from "./render-request.js";

describe("render request", () => {
  it("preserves the source offset needed for clip rendering", () => {
    const parsed = renderRequestSchema.parse({
      jobId: "job",
      clipIndex: 0,
      props: {
        videoUrl: "/videos/job/source.mp4",
        videoStartSeconds: 42.5,
        durationInFrames: 150,
        fps: 30,
        width: 1080,
        height: 1920,
        subtitles: null,
        hook: null,
        effects: null,
      },
    });

    expect(parsed.props.videoStartSeconds).toBe(42.5);
  });
});
