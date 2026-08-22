import { describe, expect, it } from "vitest";
import { outputFileNameForVersion } from "./version-render.js";

describe("version render output naming", () => {
  it("uses a clip-scoped version filename instead of the master prefix", () => {
    expect(outputFileNameForVersion(2, "version-123", 1700000000000)).toBe(
      "version_2_version-123_1700000000000.mp4"
    );
  });

  it("keeps the legacy name when no version is provided", () => {
    expect(outputFileNameForVersion(2, undefined, 1700000000000)).toBe(
      "remotion_2_1700000000000.mp4"
    );
  });
});
