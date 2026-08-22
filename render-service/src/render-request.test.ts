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

    if (!("props" in parsed)) throw new Error("expected generic render request");
    expect(parsed.props.videoStartSeconds).toBe(42.5);
  });

  it("accepts a persisted-manifest version request", () => {
    const parsed = renderRequestSchema.parse({
      jobId: "job",
      clipIndex: 0,
      versionId: "v4",
      manifestRevision: "rev-4",
      manifest: { render_spec: { duration_in_frames: 150 } },
    });

    expect(parsed).toMatchObject({
      versionId: "v4",
      manifestRevision: "rev-4",
      manifest: { render_spec: { duration_in_frames: 150 } },
    });
  });

  it("rejects a version request without a persisted manifest", () => {
    expect(() =>
      renderRequestSchema.parse({
        jobId: "job",
        clipIndex: 0,
        versionId: "v4",
        manifestRevision: "rev-4",
      }),
    ).toThrow();
  });
});
