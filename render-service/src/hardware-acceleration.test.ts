import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createAmfFfmpegOverride,
  resolveRenderAcceleration,
} from "./hardware-acceleration.js";

describe("Windows AMD hardware acceleration", () => {
  it("rewrites Remotion's Windows NVENC command to AMD AMF", () => {
    const override = createAmfFfmpegOverride();

    expect(
      override({
        type: "stitcher",
        args: [
          "-c:v",
          "h264_nvenc",
          "-c:a",
          "libfdk_aac",
          "-preset",
          "fast",
          "-b:v",
          "20M",
        ],
      }),
    ).toEqual(["-c:v", "h264_amf", "-c:a", "aac", "-b:v", "20M"]);
  });

  it("uses the GPU only after the real AMF probe succeeds", async () => {
    await expect(
      resolveRenderAcceleration(
        {
          RENDER_HARDWARE_ACCELERATION: "if-possible",
          RENDER_FFMPEG_PATH: "C:/ffmpeg/ffmpeg.exe",
          RENDER_FFMPEG_DIRECTORY: "C:/ffmpeg",
          RENDER_HARDWARE_VIDEO_BITRATE: "20M",
        },
        "win32",
        async () => true,
      ),
    ).resolves.toEqual({
      mode: "gpu",
      hardwareAcceleration: "required",
      binariesDirectory: path.normalize("C:/ffmpeg"),
      videoBitrate: "20M",
    });
  });

  it("falls back to CPU when the real AMF probe fails", async () => {
    await expect(
      resolveRenderAcceleration(
        {
          RENDER_HARDWARE_ACCELERATION: "if-possible",
          RENDER_FFMPEG_PATH: "C:/ffmpeg/ffmpeg.exe",
          RENDER_FFMPEG_DIRECTORY: "C:/ffmpeg",
          RENDER_HARDWARE_VIDEO_BITRATE: "20M",
        },
        "win32",
        async () => false,
      ),
    ).resolves.toEqual({ mode: "cpu", reason: "amf-probe-failed" });
  });
});
