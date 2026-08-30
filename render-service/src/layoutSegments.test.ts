import { describe, expect, it } from "vitest";
import {
  normalizeLayoutSegments,
  resolveLayoutAtFrame,
} from "../../remotion/src/lib/layoutSegments";

describe("render layout segment resolver", () => {
  it("turns a legacy format into one full-duration segment", () => {
    expect(normalizeLayoutSegments({ format: "standard" }, 300, 30)).toEqual([
      {
        id: "layout-1",
        startMs: 0,
        endMs: 10000,
        format: "standard",
        transition: "cut",
        transitionDurationMs: 250,
      },
    ]);
  });

  it("resolves the active layout on either side of a boundary", () => {
    const layout = {
      format: "standard" as const,
      segments: [
        {
          id: "standard",
          startMs: 0,
          endMs: 5000,
          format: "standard" as const,
          transition: "cut" as const,
        },
        {
          id: "streamer",
          startMs: 5000,
          endMs: 10000,
          format: "streamer_stack" as const,
          transition: "cut" as const,
        },
      ],
    };

    expect(resolveLayoutAtFrame(layout, 149, 300, 30).active.id).toBe(
      "standard",
    );
    expect(resolveLayoutAtFrame(layout, 150, 300, 30).active.id).toBe(
      "streamer",
    );
  });

  it("returns video-only crossfade progress without duplicating overlays", () => {
    const layout = {
      format: "standard" as const,
      segments: [
        {
          id: "standard",
          startMs: 0,
          endMs: 5000,
          format: "standard" as const,
          transition: "cut" as const,
        },
        {
          id: "streamer",
          startMs: 5000,
          endMs: 10000,
          format: "streamer_stack" as const,
          transition: "crossfade" as const,
          transitionDurationMs: 1000,
        },
      ],
    };

    const resolved = resolveLayoutAtFrame(layout, 160, 300, 30);
    expect(resolved.active.id).toBe("streamer");
    expect(resolved.previous?.id).toBe("standard");
    expect(resolved.transitionProgress).toBeCloseTo(1 / 3);
  });

  it("keeps framing overrides on normalized resolved segments", () => {
    const segments = normalizeLayoutSegments(
      {
        format: "standard",
        gameplay_zoom: 1,
        segments: [
          {
            id: "streamer",
            startMs: 0,
            endMs: 5000,
            format: "streamer_stack",
            gameplay_focus: { x: 0.7, y: 0.35 },
            gameplay_zoom: 1.4,
          },
        ],
      },
      150,
      30,
    );

    expect(segments[0]).toMatchObject({
      gameplay_focus: { x: 0.7, y: 0.35 },
      gameplay_zoom: 1.4,
    });
  });

  it("passes valid Standard face tracking data to the renderer", () => {
    const cache = {
      cache_key: "track-1",
      algorithm_version: "yolo-standard-v1",
      source_fingerprint: "source:1:2",
      source_start_seconds: 0,
      source_end_seconds: 10,
      source_width: 1920,
      source_height: 1080,
      track: {
        scenes: [
          {
            start_sec: 0,
            end_sec: 10,
            strategy: "TRACK" as const,
            keyframes: [
              { time_sec: 0, rect: { x: 0.2, y: 0, width: 0.5, height: 1 } },
            ],
          },
        ],
      },
    };

    expect(
      normalizeLayoutSegments(
        {
          format: "standard",
          segments: [
            {
              id: "standard",
              startMs: 0,
              endMs: 10000,
              format: "standard",
              face_tracking_enabled: true,
              face_tracking_cache: cache,
            },
          ],
        },
        300,
        30,
      )[0],
    ).toMatchObject({
      face_tracking_enabled: true,
      face_tracking_cache: cache,
    });
  });

  it("strips face tracking from Streamer Stack sections", () => {
    const segments = normalizeLayoutSegments(
      {
        format: "streamer_stack",
        segments: [
          {
            id: "streamer",
            startMs: 0,
            endMs: 10000,
            format: "streamer_stack",
            face_tracking_enabled: true,
          },
        ],
      },
      300,
      30,
    );

    expect(segments[0]).not.toHaveProperty("face_tracking_enabled");
    expect(segments[0]).not.toHaveProperty("face_tracking_cache");
  });
});
