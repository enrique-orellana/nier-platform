import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUBTITLE_STYLE,
  HOOK_ENTRANCE_OPTIONS,
  HOOK_SIZE_OPTIONS,
  SUBTITLE_COLOR_PRESETS,
  SUBTITLE_HIGHLIGHT_PRESETS,
  hookPositionClass,
  normalizeSubtitleStyle,
  toClipGeneratorSubtitleStyle,
  subtitlePositionClass,
} from "./localEditorStyles";

describe("local editor overlay styles", () => {
  it("matches the existing hook options", () => {
    expect(HOOK_SIZE_OPTIONS.map((item) => item.value)).toEqual([
      "S",
      "M",
      "L",
    ]);
    expect(HOOK_ENTRANCE_OPTIONS.map((item) => item.value)).toEqual([
      "spring",
      "fade",
      "slide-up",
      "none",
    ]);
  });

  it("normalizes subtitle style defaults without discarding overrides", () => {
    expect(
      normalizeSubtitleStyle({ fontFamily: "Georgia", bgOpacity: 0.5 }),
    ).toEqual({
      ...DEFAULT_SUBTITLE_STYLE,
      fontFamily: "Georgia",
      bgOpacity: 0.5,
    });
  });

  it("normalizes the optional subtitle display mode", () => {
    expect(normalizeSubtitleStyle({}).displayMode).toBe("phrase");
    expect(
      normalizeSubtitleStyle({ displayMode: "single-word" }).displayMode,
    ).toBe("single-word");
    expect(normalizeSubtitleStyle({ displayMode: "invalid" }).displayMode).toBe(
      "phrase",
    );
  });

  it("converts editor subtitle controls to the Clip Generator render scale", () => {
    expect(
      toClipGeneratorSubtitleStyle({
        fontSize: 24,
        borderWidth: 2,
        fontFamily: "Verdana",
        animation: "pop",
      }),
    ).toMatchObject({
      fontSize: 52.8,
      borderWidth: 3,
      fontFamily: "Verdana",
      animation: "pop",
    });
  });

  it("maps subtitle positions to preview classes", () => {
    expect(subtitlePositionClass("top")).toBe("top-[12%]");
    expect(subtitlePositionClass("middle")).toBe("top-[45%]");
    expect(subtitlePositionClass("bottom")).toBe("bottom-[10%]");
  });

  it("matches the existing subtitle color preset values and labels", () => {
    expect(SUBTITLE_COLOR_PRESETS).toEqual([
      { color: "#FFFFFF", label: "White" },
      { color: "#FFFF00", label: "Yellow" },
      { color: "#00FFFF", label: "Cyan" },
      { color: "#00FF00", label: "Green" },
      { color: "#FF0000", label: "Red" },
      { color: "#FF69B4", label: "Pink" },
    ]);
    expect(SUBTITLE_HIGHLIGHT_PRESETS).toEqual([
      { color: "#FFDD00", label: "Gold" },
      { color: "#FF4444", label: "Red" },
      { color: "#00FF88", label: "Green" },
      { color: "#00BBFF", label: "Blue" },
      { color: "#FF69B4", label: "Pink" },
    ]);
  });

  it("maps hook positions without sharing the animation transform", () => {
    expect(hookPositionClass("top")).toContain("top-[8%]");
    expect(hookPositionClass("center")).toContain("top-1/2");
    expect(hookPositionClass("center")).toContain("-translate-y-1/2");
    expect(hookPositionClass("bottom")).toContain("bottom-[18%]");
  });
});
