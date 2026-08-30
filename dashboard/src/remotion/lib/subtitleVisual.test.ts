import { describe, expect, it } from "vitest";
import {
  clampSubtitleCoordinate,
  getSubtitlePositionCoordinates,
  getSubtitlePositionStyle,
} from "./subtitleVisual";

describe("subtitle pixel positioning", () => {
  it("resolves preset and custom subtitle center points", () => {
    expect(
      getSubtitlePositionCoordinates({ position: "bottom" }, 1080, 1920),
    ).toEqual({ x: 540, y: 1498 });
    expect(
      getSubtitlePositionCoordinates(
        { position: "custom", positionX: 700, positionY: 420 },
        1080,
        1920,
      ),
    ).toEqual({ x: 700, y: 420 });
  });

  it("clamps custom subtitle coordinates to the render frame", () => {
    expect(clampSubtitleCoordinate(-10, 1080, 540)).toBe(0);
    expect(clampSubtitleCoordinate(2000, 1920, 960)).toBe(1920);
    expect(clampSubtitleCoordinate("invalid", 1920, 960)).toBe(960);
  });

  it("maps custom subtitle coordinates to centered percentage styles", () => {
    expect(
      getSubtitlePositionStyle(
        { position: "custom", positionX: 90, positionY: 128 },
        360,
        640,
      ),
    ).toEqual({
      left: "25%",
      right: "auto",
      top: "20%",
      bottom: "auto",
      transform: "translate(-50%, -50%)",
    });
  });
});
