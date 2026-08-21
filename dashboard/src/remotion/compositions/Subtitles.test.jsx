import { describe, expect, it } from "vitest";
import {
  getSubtitleFrameRange,
  getSubtitleTimeMs,
  isSubtitleBlockActiveAt,
  normalizeSubtitleConfig,
} from "./Subtitles";

describe("subtitle rendering defaults", () => {
  it("fills missing style data before rendering legacy subtitle configs", () => {
    const normalized = normalizeSubtitleConfig({
      captions: [{ text: "Ciao", startMs: 0, endMs: 500 }],
    });
    expect(normalized.position).toBe("bottom");
    expect(normalized.style).toMatchObject({
      fontFamily: "Arial",
      fontSize: 52,
      animation: "none",
    });
    expect(normalized.style.fontColor).toBe("#FFFFFF");
  });

  it("uses one consistent absolute frame range for subtitle sequences", () => {
    expect(getSubtitleFrameRange({ startMs: 340, endMs: 720 }, 30)).toEqual({
      startFrame: 10,
      endFrame: 22,
      durationFrames: 12,
    });
    expect(getSubtitleTimeMs(10, 0, 30)).toBeCloseTo(333.333, 2);
  });

  it("checks subtitle block visibility against the live media clock", () => {
    const block = { startMs: 500, endMs: 1000 };

    expect(isSubtitleBlockActiveAt(block, 750)).toBe(true);
    expect(isSubtitleBlockActiveAt(block, 1000)).toBe(false);
  });
});
