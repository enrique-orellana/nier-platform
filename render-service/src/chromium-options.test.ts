import { describe, expect, it } from "vitest";
import { getChromiumOptions } from "./chromium-options.js";

describe("Chromium acceleration options", () => {
  it("prefers a hardware-backed ANGLE backend on Windows", () => {
    expect(
      getChromiumOptions(
        { RENDER_HARDWARE_ACCELERATION: "if-possible" },
        "win32",
      ),
    ).toEqual({ gl: "angle" });
  });

  it("prefers EGL on Linux when GPU acceleration is enabled", () => {
    expect(
      getChromiumOptions(
        { RENDER_HARDWARE_ACCELERATION: "if-possible" },
        "linux",
      ),
    ).toEqual({ gl: "egl" });
  });

  it("lets disabled acceleration use Chromium defaults", () => {
    expect(
      getChromiumOptions(
        { RENDER_HARDWARE_ACCELERATION: "disabled" },
        "win32",
      ),
    ).toEqual({ gl: null });
  });
});
