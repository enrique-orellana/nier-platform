import { describe, expect, it } from "vitest";
import {
  getHookBoxStyle,
  getHookPositionCoordinates,
  getHookTextLines,
} from "../../remotion/src/lib/hookVisual";

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

  it("preserves explicit line breaks in rendered hook text", () => {
    expect(getHookBoxStyle({ fontSize: 48 }).whiteSpace).toBe("pre-wrap");
  });

  it("renders headline cards with the configured box colors and separate lines", () => {
    expect(
      getHookBoxStyle({
        boxStyle: "headline_cards",
        color: "#123456",
        background: "#fedcba",
      }),
    ).toMatchObject({
      color: "#123456",
      backgroundColor: "#fedcba",
      borderRadius: "0px",
      boxShadow: "none",
    });
    expect(getHookTextLines("First\n\nSecond", "headline_cards")).toEqual([
      "First",
      "Second",
    ]);
  });
});
