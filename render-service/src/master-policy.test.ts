import { describe, expect, it } from "vitest";
import { buildRenderOptions, loadMasterPolicy, parseMasterPolicy } from "./master-policy.js";

describe("master policy", () => {
  it("uses the mandatory H.264 contract", () => {
    const policy = loadMasterPolicy();
    expect(buildRenderOptions(policy)).toEqual({
      codec: policy.codec,
      crf: policy.crf,
      x264Preset: policy.preset,
      pixelFormat: policy.pixel_format,
      colorSpace: policy.color_space,
      audioCodec: policy.audio_codec,
      audioBitrate: policy.audio_bitrate,
      gopSize: Math.round(30 * policy.gop_seconds),
      everyNthFrame: 1,
      concurrency: null,
      sampleRate: policy.audio_sample_rate,
    });
  });

  it("uses the preset supplied by the shared policy", () => {
    const policy = loadMasterPolicy();
    const customPolicy = parseMasterPolicy({ ...policy, preset: "superfast" });

    expect(buildRenderOptions(customPolicy).x264Preset).toBe("superfast");
  });

  it("uses bitrate-based AMD hardware encoding without x264-only options", () => {
    const options = buildRenderOptions(loadMasterPolicy(), 30, {
      hardwareAcceleration: "required",
      binariesDirectory: "C:/ffmpeg",
      videoBitrate: "20M",
      ffmpegOverride: ({ args }) => args,
    });

    expect(options).toMatchObject({
      hardwareAcceleration: "required",
      binariesDirectory: "C:/ffmpeg",
      videoBitrate: "20M",
    });
    expect(options).not.toHaveProperty("crf");
    expect(options).not.toHaveProperty("x264Preset");
  });
});
