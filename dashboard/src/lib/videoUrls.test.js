import { describe, expect, it } from "vitest";

import { resolveClipVideoUrl } from "./videoUrls";

describe("resolveClipVideoUrl", () => {
  it("builds a generated clip URL from its filename and job id", () => {
    expect(
      resolveClipVideoUrl({ video_filename: "source_clip_1.mp4" }, "job-123"),
    ).toBe("/videos/job-123/source_clip_1.mp4");
  });

  it("keeps an explicit clip URL when one is already present", () => {
    expect(
      resolveClipVideoUrl(
        {
          video_url: "/videos/job-123/clip.mp4",
          video_filename: "source_clip_1.mp4",
        },
        "job-123",
      ),
    ).toBe("/videos/job-123/clip.mp4");
  });
});
