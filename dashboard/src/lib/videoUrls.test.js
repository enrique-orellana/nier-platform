import { describe, expect, it } from "vitest";

import {
  resolveClipVideoUrl,
  resolveMasterVideoUrl,
  resolvePreviewStartSeconds,
} from "./videoUrls";

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

describe("resolveMasterVideoUrl", () => {
  it("prefers the master source over an already-trimmed clip", () => {
    expect(
      resolveMasterVideoUrl({
        source_video_url: "https://s3.test/master.mp4",
        video_url: "https://s3.test/source_clip_1.mp4",
      }),
    ).toBe("https://s3.test/master.mp4");
  });
});

describe("resolvePreviewStartSeconds", () => {
  it("starts an already-trimmed clip at zero", () => {
    expect(
      resolvePreviewStartSeconds({
        video_url: "https://s3.test/clip.mp4",
        start: 34.2,
      }),
    ).toBe(0);
  });

  it("keeps the master offset when no trimmed clip exists", () => {
    expect(
      resolvePreviewStartSeconds({
        source_video_url: "https://s3.test/master.mp4",
        start: 34.2,
      }),
    ).toBe(34.2);
  });
});
