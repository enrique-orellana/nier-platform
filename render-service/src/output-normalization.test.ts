import { describe, expect, it } from "vitest";
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
});
