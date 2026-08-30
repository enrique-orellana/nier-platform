import { describe, expect, it } from "vitest";
import {
  faceTrackingRectangleAt,
  normalizeFaceTrackingCache,
} from "./faceTracking";

const cache = {
  cache_key: "track-1",
  algorithm_version: "yolo-standard-v1",
  source_fingerprint: "source:1:2",
  source_start_seconds: 4,
  source_end_seconds: 8,
  source_width: 1920,
  source_height: 1080,
  track: {
    scenes: [
      {
        start_sec: 0,
        end_sec: 4,
        strategy: "TRACK" as const,
        keyframes: [
          { time_sec: 0, rect: { x: 0.1, y: 0, width: 0.5, height: 1 } },
          { time_sec: 4, rect: { x: 0.3, y: 0, width: 0.5, height: 1 } },
        ],
      },
    ],
  },
};

describe("face tracking composition helper", () => {
  it("normalizes a cache and interpolates its source rectangle", () => {
    const normalized = normalizeFaceTrackingCache(cache, 4);

    expect(normalized).toEqual(cache);
    expect(faceTrackingRectangleAt(normalized, 2)).toEqual({
      x: 0.2,
      y: 0,
      width: 0.5,
      height: 1,
    });
  });

  it("rejects malformed rectangles and unsupported algorithms", () => {
    expect(
      normalizeFaceTrackingCache({ ...cache, algorithm_version: "old" }, 4),
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
        4,
      ),
    ).toBeUndefined();
  });
});
