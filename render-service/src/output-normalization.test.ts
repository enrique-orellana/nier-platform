import { describe, expect, it } from "vitest";
import { loadMasterPolicy, parseMasterPolicy } from "./master-policy.js";
import { buildNormalizationArgs } from "./output-normalization.js";

describe("publishable MP4 normalization", () => {
  it("builds a canonical social-video FFmpeg command", () => {
    const args = buildNormalizationArgs("rendered.mp4", "normalized.mp4", {
      fps: 30,
      hasAudio: true,
    });

    expect(args).toEqual(expect.arrayContaining([
      "-map", "0:v:0",
      "-map", "0:a:0",
      "-c:v", "libx264",
      "-profile:v", "high",
      "-level:v", "4.2",
      "-pix_fmt", "yuv420p",
      "-vf", "setsar=1,colorspace=all=bt709:iall=bt709:range=tv:irange=tv",
      "-g", "60",
      "-keyint_min", "60",
      "-sc_threshold", "0",
      "-flags:v", "+cgop",
      "-colorspace", "bt709",
      "-color_range", "tv",
      "-color_trc", "bt709",
      "-color_primaries", "bt709",
      "-c:a", "aac",
      "-ar", "48000",
      "-ac", "2",
      "-b:a", "192k",
      "-movflags", "+faststart",
      "-map_metadata", "-1",
      "-video_track_timescale", "90000",
      "normalized.mp4",
    ]));
  });

  it("omits audio encoding while retaining a valid silent-video contract", () => {
    const args = buildNormalizationArgs("rendered.mp4", "normalized.mp4", {
      fps: 60,
      hasAudio: false,
    });

    expect(args).toContain("-g");
    expect(args[args.indexOf("-g") + 1]).toBe("120");
    expect(args).not.toContain("-c:a");
  });

  it("uses the shared policy for normalization settings", () => {
    const basePolicy = loadMasterPolicy();
    const policy = parseMasterPolicy({
      ...basePolicy,
      profile: "baseline",
      h264_level: "5.1",
      pixel_format: "yuv444p",
      color_range: "pc",
      color_space: "bt2020nc",
      color_transfer: "smpte2084",
      color_primaries: "bt2020",
      audio_codec: "libopus",
      audio_sample_rate: 44100,
      audio_channels: 1,
      audio_bitrate: "128k",
      gop_seconds: 1,
      faststart: false,
    });
    const args = buildNormalizationArgs("rendered.mp4", "normalized.mp4", { fps: 30, hasAudio: true }, policy);

    expect(args).toEqual(expect.arrayContaining([
      "-profile:v", "baseline",
      "-level:v", "5.1",
      "-pix_fmt", "yuv444p",
      "-vf", "setsar=1,colorspace=all=bt2020nc:iall=bt2020nc:range=pc:irange=pc",
      "-colorspace", "bt2020nc",
      "-color_range", "pc",
      "-color_trc", "smpte2084",
      "-color_primaries", "bt2020",
      "-c:a", "libopus",
      "-ar", "44100",
      "-ac", "1",
      "-b:a", "128k",
      "-g", "30",
    ]));
    expect(args).not.toContain("-movflags");
  });
});
