import { describe, expect, it } from "vitest";
import { resolveLayoutAtFrame } from "./layoutSegments";

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
});
