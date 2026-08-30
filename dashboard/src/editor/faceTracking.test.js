import { afterEach, describe, expect, it, vi } from "vitest";
import {
  faceTrackingRectangleAt,
  normalizeFaceTrackingCache,
  requestFaceTracking,
} from "./faceTracking";

const cache = {
  cache_key: "track-1",
  algorithm_version: "yolo-standard-v1",
  source_fingerprint: "source:1:2",
  source_start_seconds: 10,
  source_end_seconds: 12,
  source_width: 1920,
  source_height: 1080,
  track: {
    scenes: [
      {
        start_sec: 0,
        end_sec: 2,
        strategy: "TRACK",
        keyframes: [
          { time_sec: 0, rect: { x: 0.1, y: 0, width: 0.5, height: 1 } },
          { time_sec: 2, rect: { x: 0.3, y: 0, width: 0.5, height: 1 } },
        ],
      },
    ],
  },
};

describe("faceTracking", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes valid cache payloads and interpolates rectangles", () => {
    const normalized = normalizeFaceTrackingCache(cache, 2000);
    expect(normalized).toEqual(cache);
    expect(faceTrackingRectangleAt(normalized, 1)).toEqual({
      x: 0.2,
      y: 0,
      width: 0.5,
      height: 1,
    });
  });

  it("rejects invalid cache payloads", () => {
    expect(
      normalizeFaceTrackingCache(
        {
          ...cache,
          algorithm_version: "old",
        },
        2000,
      ),
    ).toBeUndefined();
    expect(
      normalizeFaceTrackingCache(
        {
          ...cache,
          track: {
            scenes: [
              {
                ...cache.track.scenes[0],
                keyframes: [
                  {
                    time_sec: 0,
                    rect: { x: 0.8, y: 0, width: 0.5, height: 1 },
                  },
                ],
              },
            ],
          },
        },
        2000,
      ),
    ).toBeUndefined();
  });

  it("requests and validates a server cache response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => cache,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestFaceTracking({
      jobId: "job-1",
      clipIndex: 0,
      startSeconds: 10,
      endSeconds: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
    });

    expect(result).toEqual(cache);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/clip/job-1/0/face-tracking"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"algorithm_version":"yolo-standard-v1"'),
      }),
    );
  });
});
