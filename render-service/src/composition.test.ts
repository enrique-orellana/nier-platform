import { describe, expect, it } from "vitest";
import { applyRequestedCompositionMetadata } from "./composition.js";

describe("composition metadata", () => {
  it("uses the source-derived render dimensions and frame rate", () => {
    const composition = {
      id: "ShortVideo",
      durationInFrames: 900,
      fps: 30,
      width: 1080,
      height: 1920,
    };

    expect(applyRequestedCompositionMetadata(composition, {
      durationInFrames: 800,
      fps: 25,
      width: 608,
      height: 1080,
    })).toMatchObject({
      durationInFrames: 800,
      fps: 25,
      width: 608,
      height: 1080,
    });
  });
});
