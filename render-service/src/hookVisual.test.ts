import { describe, expect, it } from "vitest";
import { getHookPositionCoordinates } from "../../remotion/src/lib/hookVisual";

describe("renderer hook pixel positioning", () => {
  it("resolves preset and custom coordinates consistently with the dashboard", () => {
    expect(getHookPositionCoordinates({ position: "top" }, 1080, 1920)).toEqual(
      {
        x: 540,
        y: 154,
      },
    );
    expect(
      getHookPositionCoordinates(
        { position: "custom", positionX: 700, positionY: 420 },
        1080,
        1920,
      ),
    ).toEqual({ x: 700, y: 420 });
  });

  it("clamps renderer coordinates to the output canvas", () => {
    expect(
      getHookPositionCoordinates(
        { position: "custom", positionX: 1200.8, positionY: -10 },
        1080,
        1920,
      ),
    ).toEqual({ x: 1080, y: 0 });
  });
});
