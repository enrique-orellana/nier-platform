import type { ChromiumOptions } from "@remotion/renderer";

type Environment = Record<string, string | undefined>;

export interface RenderBrowserOptions {
  chromeMode: "chrome-for-testing" | "headless-shell";
  chromiumOptions: ChromiumOptions;
}

export function getChromiumOptions(
  environment: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
): ChromiumOptions {
  void environment;
  void platform;
  // Chrome for Testing selects its native GPU backend when gl is unset.
  // Forcing ANGLE/EGL breaks media frame extraction on some headless builds.
  return { gl: null };
}

export function getRenderBrowserOptions(
  environment: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
): RenderBrowserOptions {
  return {
    // Chrome Headless Shell is the render-safe browser for @remotion/media.
    // Hardware encoding is still selected independently by the AMF/NVENC probe.
    chromeMode: "headless-shell",
    chromiumOptions: getChromiumOptions(environment, platform),
  };
}
