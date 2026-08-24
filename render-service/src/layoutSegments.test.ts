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
});
