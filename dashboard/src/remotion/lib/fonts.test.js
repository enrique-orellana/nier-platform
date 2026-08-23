import { describe, expect, it } from "vitest";
import { getFontStack, getHookFontStack, subtitleFontFace } from "./fonts";

describe("emoji font fallback", () => {
  it("includes browser-native color emoji fonts for subtitles and hooks", () => {
    for (const stack of [getFontStack("Arial"), getHookFontStack()]) {
      expect(stack).toContain("Apple Color Emoji");
      expect(stack).toContain("Segoe UI Emoji");
      expect(stack).toContain("Noto Color Emoji");
    }
  });

  it("uses bundled subtitle font families for stable preview and render output", () => {
    expect(getFontStack("Impact")).toContain("OpenShortsImpact");
    expect(getFontStack("Verdana")).toContain("OpenShortsSans");
    expect(getFontStack("Georgia")).toContain("OpenShortsSerif");
    expect(getFontStack("Courier New")).toContain("OpenShortsMono");
    expect(subtitleFontFace).toContain("OpenShortsImpact");
    expect(subtitleFontFace).toContain("/fonts/OpenShortsImpact.ttf");
  });
});
