import { describe, expect, it } from "vitest";
import {
  getSubtitlePositionCoordinates,
  getSubtitlePositionStyle,
} from "./subtitlePosition";

describe("subtitle position resolver", () => {
  it("maps legacy presets to the 1080x1920 canvas", () => {
    expect(getSubtitlePositionCoordinates({ position: "top" })).toEqual({
      x: 540,
      y: 230,
    });
    expect(getSubtitlePositionCoordinates({ position: "middle" })).toEqual({
      x: 540,
      y: 864,
    });
    expect(getSubtitlePositionCoordinates({ position: "bottom" })).toEqual({
      x: 540,
      y: 1728,
    });
  });

  it("rounds and clamps custom coordinates to the output frame", () => {
    expect(
      getSubtitlePositionCoordinates({
        position: "custom",
        positionX: 1200.8,
        positionY: -10,
      }),
    ).toEqual({ x: 1080, y: 0 });
  });

  it("returns a centered percentage anchor for CSS previews", () => {
    expect(
      getSubtitlePositionStyle(
        { position: "custom", positionX: 270, positionY: 480 },
        1080,
        1920,
      ),
    ).toEqual({
      left: "25%",
      top: "25%",
      bottom: "auto",
      transform: "translate(-50%, -50%)",
    });
  });
});
