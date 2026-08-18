import { describe, expect, it } from "vitest";
import { getApiUrl } from "./config";

describe("getApiUrl", () => {
  it("returns an empty URL when the path is missing", () => {
    expect(getApiUrl()).toBe("");
    expect(getApiUrl(null)).toBe("");
  });

  it("normalizes relative paths and preserves absolute URLs", () => {
    expect(getApiUrl("api/health")).toBe("/api/health");
    expect(getApiUrl("/api/health")).toBe("/api/health");
    expect(getApiUrl("https://example.com/video.mp4")).toBe(
      "https://example.com/video.mp4",
    );
  });
});
