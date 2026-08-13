import { describe, expect, it } from "vitest";
import { loadMasterPolicy } from "./master-policy.js";
import { validateProbePayload } from "./output-validation.js";

describe("master output validation", () => {
  it("rejects wrong codec and dimensions", () => {
    const policy = loadMasterPolicy();
    expect(() => validateProbePayload({
      streams: [{ codec_type: "video", codec_name: "vp9", pix_fmt: "yuv420p", width: 1080, height: 1920, avg_frame_rate: "30/1" }],
      format: { duration: 2 },
    }, { width: 1080, height: 1920, fps: 30, durationSeconds: 2, requireAudio: false, toneMappedToSdr: false }, policy)).toThrow("H.264");
  });

  it("accepts a valid output payload", () => {
    const policy = loadMasterPolicy();
    expect(() => validateProbePayload({
      streams: [{ codec_type: "video", codec_name: "h264", profile: "High", pix_fmt: "yuv420p", width: 1080, height: 1920, avg_frame_rate: "30/1", sample_aspect_ratio: "1:1", color_range: "tv", color_space: "bt709", color_transfer: "bt709", color_primaries: "bt709" }, { codec_type: "audio", codec_name: "aac", sample_rate: 48000, channels: 2, bit_rate: 192000 }],
      format: { duration: 2 },
    }, { width: 1080, height: 1920, fps: 30, durationSeconds: 2, requireAudio: true, toneMappedToSdr: false }, policy)).not.toThrow();
  });

  it("validates duration against the video timeline, not AAC padding", () => {
    const policy = loadMasterPolicy();
    expect(() => validateProbePayload({
      streams: [
        { codec_type: "video", codec_name: "h264", profile: "High", pix_fmt: "yuv420p", width: 1080, height: 1920, avg_frame_rate: "30/1", sample_aspect_ratio: "1:1", color_range: "tv", color_space: "bt709", color_transfer: "bt709", color_primaries: "bt709", duration: 39.433333 },
        { codec_type: "audio", codec_name: "aac", sample_rate: 48000, channels: 2, bit_rate: 192000, duration: 39.488 },
      ],
      format: { duration: 39.488 },
    }, { width: 1080, height: 1920, fps: 30, durationSeconds: 39.44, requireAudio: false, toneMappedToSdr: false }, policy)).not.toThrow();
  });
});
