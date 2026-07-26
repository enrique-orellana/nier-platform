import { describe, expect, it } from "vitest";
import { outputFileNameForVersion } from "./version-render.js";

describe("version render output naming", () => {
  it("includes the immutable version id in the output filename", () => {
    expect(outputFileNameForVersion(2, "version-123", 1700000000000)).toBe(
      "master_2_version-123_1700000000000.mp4"
    );
  });

  it("keeps the legacy name when no version is provided", () => {
    expect(outputFileNameForVersion(2, undefined, 1700000000000)).toBe(
      "remotion_2_1700000000000.mp4"
    );
  });
});
