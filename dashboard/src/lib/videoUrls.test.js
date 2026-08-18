import { describe, expect, it } from "vitest";

import { resolveClipVideoUrl } from "./videoUrls";

describe("resolveClipVideoUrl", () => {
  it("does not recreate the removed local video route", () => {
    expect(
      resolveClipVideoUrl({ video_filename: "source_clip_1.mp4" }, "job-123"),
    ).toBe("");
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

describe("toProxiedVideoUrl", () => {
  it("keeps presigned S3 URLs direct", async () => {
    const { toProxiedVideoUrl } = await import("./videoUrls");
    const url = "https://s3.example.test/media/clip.mp4?signature=abc";

    expect(toProxiedVideoUrl(url)).toBe(url);
  });
});
