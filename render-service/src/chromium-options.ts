import type { ChromiumOptions } from "@remotion/renderer";

type Environment = Record<string, string | undefined>;

export function getChromiumOptions(
  environment: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
): ChromiumOptions {
  if (environment.RENDER_HARDWARE_ACCELERATION !== "if-possible") {
    return { gl: null };
  }

  if (platform === "win32") {
    return { gl: "angle" };
  }

  if (platform === "linux") {
    return { gl: "egl" };
  }

  return { gl: null };
}
