import { describe, expect, it } from "vitest";
import {
  createLayoutSegments,
  clearLayoutSegmentFraming,
  getLayoutSegmentAt,
  normalizeLayoutSegments,
  splitLayoutSegment,
  updateLayoutSegment,
} from "./layoutTimelineModel";

describe("layoutTimelineModel", () => {
  it("creates one standard segment for the full clip", () => {
    expect(createLayoutSegments(12000)).toEqual([
      {
        id: "layout-1",
        startMs: 0,
        endMs: 12000,
        format: "standard",
        transition: "cut",
        transitionDurationMs: 250,
      },
    ]);
  });

  it("splits an interior segment while inheriting its layout settings", () => {
    const source = [
      {
        id: "layout-1",
        startMs: 0,
        endMs: 12000,
        format: "streamer_stack",
        transition: "crossfade",
        transitionDurationMs: 400,
      },
    ];

    expect(splitLayoutSegment(source, "layout-1", 5000)).toEqual([
      { ...source[0], endMs: 5000 },
      { ...source[0], id: "layout-1-split-1", startMs: 5000 },
    ]);
  });

  it("preserves and clears per-segment gameplay framing", () => {
    const source = [
      {
        id: "layout-1",
        startMs: 0,
        endMs: 12000,
        format: "streamer_stack",
        gameplay_focus: { x: 0.62, y: 0.44 },
        gameplay_zoom: 1.18,
      },
    ];

    expect(normalizeLayoutSegments(source, 12000)[0]).toMatchObject({
      gameplay_focus: { x: 0.62, y: 0.44 },
      gameplay_zoom: 1.18,
    });

    const cleared = clearLayoutSegmentFraming(source, "layout-1");
    expect(cleared[0]).not.toHaveProperty("gameplay_focus");
    expect(cleared[0]).not.toHaveProperty("gameplay_zoom");
  });

  it("keeps face tracking off by default and preserves a valid cache", () => {
    const cache = {
      cache_key: "abc123",
      algorithm_version: "yolo-standard-v1",
      source_fingerprint: "source:1:2",
      source_start_seconds: 10,
      source_end_seconds: 22,
      source_width: 1920,
      source_height: 1080,
      track: {
        scenes: [
          {
            start_sec: 0,
            end_sec: 12,
            strategy: "TRACK",
            keyframes: [
              {
                time_sec: 0,
                rect: { x: 0, y: 0, width: 0.5, height: 1 },
              },
            ],
          },
        ],
      },
    };
    const [standard] = normalizeLayoutSegments(
      [
        {
          id: "standard",
          startMs: 0,
          endMs: 12000,
          format: "standard",
          face_tracking_cache: cache,
        },
      ],
      12000,
    );
    expect(standard.face_tracking_enabled).toBeUndefined();
    expect(standard.face_tracking_cache).toEqual(cache);
  });

  it("drops invalid or Streamer Stack face tracking data", () => {
    const source = [
      {
        id: "streamer",
        startMs: 0,
        endMs: 1000,
        format: "streamer_stack",
        face_tracking_enabled: true,
        face_tracking_cache: { cache_key: "invalid" },
      },
    ];
    const [segment] = normalizeLayoutSegments(source, 1000);
    expect(segment.face_tracking_enabled).toBeUndefined();
    expect(segment.face_tracking_cache).toBeUndefined();
  });

  it("clears face tracking cache when a tracked segment is split", () => {
    const source = [
      {
        id: "standard",
        startMs: 0,
        endMs: 12000,
        format: "standard",
        face_tracking_enabled: true,
        face_tracking_cache: { cache_key: "cached" },
      },
    ];
    const [left, right] = splitLayoutSegment(source, "standard", 5000);
    expect(left.face_tracking_cache).toBeUndefined();
    expect(right.face_tracking_cache).toBeUndefined();
    expect(left.face_tracking_enabled).toBe(true);
    expect(right.face_tracking_enabled).toBe(true);
  });

  it("clears face tracking cache only when the source range changes", () => {
    const source = [
      {
        id: "standard",
        startMs: 0,
        endMs: 12000,
        format: "standard",
        face_tracking_enabled: true,
        face_tracking_cache: { cache_key: "cached" },
      },
    ];
    expect(
      updateLayoutSegment(source, "standard", { transition: "crossfade" })[0],
    ).toHaveProperty("face_tracking_cache");
    expect(
      updateLayoutSegment(source, "standard", { endMs: 11000 })[0],
    ).not.toHaveProperty("face_tracking_cache");
  });

  it("rejects splits at segment boundaries or for an unknown segment", () => {
    const source = createLayoutSegments(12000);

    expect(splitLayoutSegment(source, "layout-1", 0)).toBeNull();
    expect(splitLayoutSegment(source, "layout-1", 12000)).toBeNull();
    expect(splitLayoutSegment(source, "missing", 5000)).toBeNull();
  });

  it("normalizes formats, transitions, bounds, ordering, and gaps", () => {
    expect(
      normalizeLayoutSegments(
        [
          {
            id: "second",
            startMs: 7000,
            endMs: 15000,
            format: "invalid",
            transition: "invalid",
            transitionDurationMs: -10,
          },
          {
            id: "first",
            startMs: -100,
            endMs: 5000,
            format: "streamer_stack",
            transition: "crossfade",
            transitionDurationMs: 1000,
          },
          { id: "empty", startMs: 5000, endMs: 5000 },
        ],
        10000,
      ),
    ).toEqual([
      {
        id: "first",
        startMs: 0,
        endMs: 5000,
        format: "streamer_stack",
        transition: "crossfade",
        transitionDurationMs: 1000,
      },
      {
        id: "second",
        startMs: 5000,
        endMs: 10000,
        format: "standard",
        transition: "cut",
        transitionDurationMs: 250,
      },
    ]);
  });

  it("uses the containing segment at the playhead", () => {
    const source = [
      { id: "first", startMs: 0, endMs: 5000, format: "standard" },
      { id: "second", startMs: 5000, endMs: 12000, format: "streamer_stack" },
    ];

    expect(getLayoutSegmentAt(source, 4999).id).toBe("first");
    expect(getLayoutSegmentAt(source, 5000).id).toBe("second");
    expect(getLayoutSegmentAt(source, 12000).id).toBe("second");
    expect(getLayoutSegmentAt(source, 13000)).toBeNull();
  });

  it("updates only the selected segment and clamps crossfade duration", () => {
    const source = [
      { id: "first", startMs: 0, endMs: 5000, format: "standard" },
      { id: "second", startMs: 5000, endMs: 12000, format: "standard" },
    ];

    expect(
      updateLayoutSegment(source, "second", {
        format: "streamer_stack",
        transition: "crossfade",
        transitionDurationMs: 10000,
      }),
    ).toEqual([
      { id: "first", startMs: 0, endMs: 5000, format: "standard" },
      {
        id: "second",
        startMs: 5000,
        endMs: 12000,
        format: "streamer_stack",
        transition: "crossfade",
        transitionDurationMs: 7000,
      },
    ]);
  });
});
