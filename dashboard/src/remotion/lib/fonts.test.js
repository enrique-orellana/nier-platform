import { describe, expect, it } from "vitest";
import { getFontStack, getHookFontStack } from "./fonts";

describe("emoji font fallback", () => {
  it("includes browser-native color emoji fonts for subtitles and hooks", () => {
    for (const stack of [getFontStack("Arial"), getHookFontStack()]) {
      expect(stack).toContain("Apple Color Emoji");
      expect(stack).toContain("Segoe UI Emoji");
      expect(stack).toContain("Noto Color Emoji");
    }
  });
});
