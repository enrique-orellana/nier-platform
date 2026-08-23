import { describe, expect, it, vi } from "vitest";

import {
  getMediaUrlExpiration,
  isSignedMediaUrl,
  refreshMediaUrl,
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

describe("renewable media URLs", () => {
  it("recognizes AWS signed media URLs and reads their expiration", () => {
    const url =
      "https://s3.example.test/media/clip.mp4?X-Amz-Date=20260822T223514Z&X-Amz-Expires=7200&X-Amz-Signature=abc";

    expect(isSignedMediaUrl(url)).toBe(true);
    expect(getMediaUrlExpiration(url)).toBe(
      Date.parse("2026-08-23T00:35:14.000Z"),
    );
  });

  it("requests a fresh direct URL from the media URL endpoint", async () => {
    const originalUrl =
      "https://s3.example.test/media/clip.mp4?X-Amz-Signature=expired";
    const freshUrl =
      "https://s3.example.test/media/clip.mp4?X-Amz-Signature=fresh";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          url: freshUrl,
          expiresAt: "2026-08-23T01:35:14.000Z",
        }),
      }),
    );

    await expect(
      refreshMediaUrl(originalUrl, { force: true }),
    ).resolves.toEqual({
      url: freshUrl,
      expiresAt: Date.parse("2026-08-23T01:35:14.000Z"),
    });
    expect(fetch).toHaveBeenCalledWith(
      `/api/media-url?url=${encodeURIComponent(originalUrl)}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
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

  it("keeps the master offset when the master is exposed as a source preview", () => {
    expect(
      resolvePreviewStartSeconds({
        video_url: "https://s3.test/master.mp4",
        source_video_url: "https://s3.test/master.mp4",
        source_preview: true,
        start: 34.2,
      }),
    ).toBe(34.2);
  });
});
