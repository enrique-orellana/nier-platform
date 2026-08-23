import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rendererFontsSource = readFileSync(
  resolve(process.cwd(), "../remotion/src/lib/fonts.ts"),
  "utf8"
);

describe("renderer emoji font policy", () => {
  it("includes a color emoji fallback for hook text", () => {
    expect(rendererFontsSource).toContain("Noto Color Emoji");
    expect(rendererFontsSource).toContain("getHookFontStack");
  });

  it("defines bundled subtitle font families instead of host-only fonts", () => {
    expect(rendererFontsSource).toContain("OpenShortsImpact");
    expect(rendererFontsSource).toContain("OpenShortsSans");
    expect(rendererFontsSource).toContain("OpenShortsSerif");
    expect(rendererFontsSource).toContain("OpenShortsMono");
    expect(rendererFontsSource).toContain("subtitleFontFace");
  });
});
