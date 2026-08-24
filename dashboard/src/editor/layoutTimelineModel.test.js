import { describe, expect, it } from "vitest";
import {
  createLayoutSegments,
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
