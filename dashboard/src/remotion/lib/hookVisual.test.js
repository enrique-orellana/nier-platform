import { describe, expect, it } from "vitest";
import { getHookPositionCoordinates, getHookPositionStyle } from "./hookVisual";

describe("hook pixel positioning", () => {
  it("resolves preset and custom hook center points in output pixels", () => {
    expect(getHookPositionCoordinates({ position: "top" }, 1080, 1920)).toEqual(
      {
        x: 540,
        y: 154,
      },
    );
    expect(
      getHookPositionCoordinates({ position: "center" }, 1080, 1920),
    ).toEqual({ x: 540, y: 960 });
    expect(
      getHookPositionCoordinates({ position: "bottom" }, 1080, 1920),
    ).toEqual({ x: 540, y: 1574 });
    expect(
      getHookPositionCoordinates(
        { position: "custom", positionX: 700, positionY: 420 },
        1080,
        1920,
      ),
    ).toEqual({ x: 700, y: 420 });
  });

  it("rounds and clamps custom coordinates to the render canvas", () => {
    expect(
      getHookPositionCoordinates(
        { position: "custom", positionX: 1200.8, positionY: -10 },
        1080,
        1920,
      ),
    ).toEqual({ x: 1080, y: 0 });
  });

  it("resolves the streamer stack top preset at the facecam boundary", () => {
    expect(
      getHookPositionCoordinates(
        {
          position: "top",
          layoutFormat: "streamer_stack",
          facecamSize: "large",
        },
        1080,
        1920,
      ),
    ).toEqual({ x: 540, y: 883 });
  });

  it("converts custom output pixels to a centered CSS anchor", () => {
    expect(
      getHookPositionStyle(
        { position: "custom", positionX: 270, positionY: 480 },
        "standard",
        "medium",
        540,
        960,
      ),
    ).toEqual({
      left: "50%",
      top: "50%",
      bottom: "auto",
      transform: "translate(-50%, -50%)",
    });
  });
});
