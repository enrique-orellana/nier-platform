import { describe, expect, it } from "vitest";
import {
  getChromiumOptions,
  getRenderBrowserOptions,
} from "./chromium-options.js";

describe("Chromium acceleration options", () => {
  it("lets Chrome choose the native GPU backend on Windows", () => {
    expect(
      getChromiumOptions(
        { RENDER_HARDWARE_ACCELERATION: "if-possible" },
        "win32",
      ),
    ).toEqual({ gl: null });
  });

  it("lets Chrome choose the native GPU backend on Linux", () => {
    expect(
      getChromiumOptions(
        { RENDER_HARDWARE_ACCELERATION: "if-possible" },
        "linux",
      ),
    ).toEqual({ gl: null });
  });

  it("lets disabled acceleration use Chromium defaults", () => {
    expect(
      getChromiumOptions(
        { RENDER_HARDWARE_ACCELERATION: "disabled" },
        "win32",
      ),
    ).toEqual({ gl: null });
  });

  it("uses Chrome for Testing for GPU-enabled browser sessions", () => {
    expect(
      getRenderBrowserOptions(
        { RENDER_HARDWARE_ACCELERATION: "if-possible" },
        "win32",
      ),
    ).toEqual({
      chromeMode: "chrome-for-testing",
      chromiumOptions: { gl: null },
    });
  });

  it("keeps the existing headless shell when acceleration is disabled", () => {
    expect(
      getRenderBrowserOptions(
        { RENDER_HARDWARE_ACCELERATION: "disabled" },
        "win32",
      ),
    ).toEqual({
      chromeMode: "headless-shell",
      chromiumOptions: { gl: null },
    });
  });
});
