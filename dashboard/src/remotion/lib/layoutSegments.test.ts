import { describe, expect, it } from "vitest";
import {
  normalizeLayoutSegments,
  resolveLayoutAtFrame,
  resolveLayoutAtNormalizedSegments,
} from "./layoutSegments";

describe("dashboard layout segment resolver", () => {
  it("falls back to the legacy layout format", () => {
    expect(
      resolveLayoutAtFrame({ format: "streamer_stack" }, 0, 300, 30).active,
    ).toMatchObject({
      startMs: 0,
      endMs: 10000,
      format: "streamer_stack",
      transition: "cut",
    });
  });

  it("resolves a crossfade between video layouts at the current frame", () => {
    const resolved = resolveLayoutAtFrame(
      {
        format: "standard",
        segments: [
          {
            id: "standard",
            startMs: 0,
            endMs: 5000,
            format: "standard",
            transition: "cut",
          },
          {
            id: "streamer",
            startMs: 5000,
            endMs: 10000,
            format: "streamer_stack",
            transition: "crossfade",
            transitionDurationMs: 1000,
          },
        ],
      },
      160,
      300,
      30,
    );
    expect(resolved.active.format).toBe("streamer_stack");
    expect(resolved.previous?.format).toBe("standard");
    expect(resolved.transitionProgress).toBeCloseTo(1 / 3);
  });

  it("resolves cached normalized segments without changing the result", () => {
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
    const normalized = normalizeLayoutSegments(layout, 300, 30);

    expect(resolveLayoutAtNormalizedSegments(normalized, 160, 30)).toEqual(
      resolveLayoutAtFrame(layout, 160, 300, 30),
    );
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
});
