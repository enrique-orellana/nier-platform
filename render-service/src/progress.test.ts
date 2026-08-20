import { describe, expect, it } from "vitest";
import { shouldLogRenderProgress } from "./progress.js";

describe("render progress logging", () => {
  it("logs each tenth-percent milestone once", () => {
    expect(shouldLogRenderProgress(20, -1)).toBe(true);
    expect(shouldLogRenderProgress(20, 20)).toBe(false);
    expect(shouldLogRenderProgress(21, 20)).toBe(false);
    expect(shouldLogRenderProgress(30, 20)).toBe(true);
    expect(shouldLogRenderProgress(100, 90)).toBe(true);
  });
});
