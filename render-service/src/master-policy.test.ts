import { describe, expect, it } from "vitest";
import { buildRenderOptions } from "./master-policy.js";

describe("master policy", () => {
  it("uses the mandatory H.264 contract", () => {
    expect(buildRenderOptions()).toEqual({
      codec: "h264",
      crf: 14,
      x264Preset: "veryslow",
      pixelFormat: "yuv420p",
      colorSpace: "bt709",
      audioCodec: "aac",
      audioBitrate: "320k",
    });
  });
});
