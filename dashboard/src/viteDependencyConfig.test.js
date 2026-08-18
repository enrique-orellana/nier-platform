// @vitest-environment node

import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config.js";

describe("Vite dependency configuration", () => {
  it("prevents Mediabunny from being bundled separately inside Remotion packages", () => {
    const config = viteConfig({ mode: "development", command: "serve" });

    expect(config.optimizeDeps?.exclude).toContain("mediabunny");
  });
});
