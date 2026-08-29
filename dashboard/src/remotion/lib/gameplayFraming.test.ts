import { describe, expect, it } from "vitest";
import { resolveGameplayCrop } from "./gameplayFraming";

const region = { x: 0.2, y: 0.1, width: 0.7, height: 0.8 };

describe("resolveGameplayCrop", () => {
  it("uses the supplied focus and zoom", () => {
    const crop = resolveGameplayCrop({
      region,
      sourceAspect: 16 / 9,
      panelAspect: 1080 / 1192,
      focus: { x: 0.72, y: 0.38 },
      zoom: 1.6,
    });

    expect(crop.x).toBeGreaterThan(region.x);
    expect(crop.y).toBeGreaterThanOrEqual(region.y);
    expect(crop.width).toBeLessThan(region.width);
    expect(crop.height).toBeLessThan(region.height);
  });

  it("clamps focus to the selected gameplay region", () => {
    const crop = resolveGameplayCrop({
      region,
      sourceAspect: 16 / 9,
      panelAspect: 1080 / 1192,
      focus: { x: 2, y: -1 },
      zoom: 1,
    });

    expect(crop.x).toBeGreaterThanOrEqual(region.x);
    expect(crop.y).toBeGreaterThanOrEqual(region.y);
    expect(crop.x + crop.width).toBeLessThanOrEqual(region.x + region.width);
    expect(crop.y + crop.height).toBeLessThanOrEqual(region.y + region.height);
  });
});
