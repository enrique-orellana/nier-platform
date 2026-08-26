import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createAmfFfmpegOverride,
  createVaapiFfmpegOverride,
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
      vendor: "amd",
      encoder: "h264_amf",
      binariesDirectory: path.normalize("C:/ffmpeg"),
      videoBitrate: "20M",
      ffmpegOverride: expect.any(Function),
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

describe("cross-platform hardware acceleration", () => {
  const baseEnvironment = {
    RENDER_HARDWARE_ACCELERATION: "if-possible",
    RENDER_FFMPEG_PATH: "/usr/bin/ffmpeg",
    RENDER_FFMPEG_DIRECTORY: "/usr/bin",
    RENDER_HARDWARE_VIDEO_BITRATE: "20M",
  };

  it("selects NVIDIA NVENC on Linux", async () => {
    const probedEncoders: string[] = [];
    const result = await resolveRenderAcceleration(
      { ...baseEnvironment, RENDER_ACCELERATOR: "nvidia", NVIDIA_VISIBLE_DEVICES: "0" },
      "linux",
      async (_path, _bitrate, encoder) => {
        probedEncoders.push(encoder);
        return true;
      },
      () => false,
    );

    expect(result).toMatchObject({
      mode: "gpu",
      vendor: "nvidia",
      encoder: "h264_nvenc",
      hardwareAcceleration: "required",
      videoBitrate: "20M",
    });
    expect(probedEncoders).toEqual(["h264_nvenc"]);
  });

  it("rewrites VAAPI arguments once and removes x264-only flags", () => {
    const override = createVaapiFfmpegOverride("/dev/dri/renderD128");

    expect(
      override({
        type: "stitcher",
        args: [
          "-c:v", "h264_nvenc",
          "-crf", "18",
          "-preset", "fast",
          "-vf", "scale=1280:720",
        ],
      }),
    ).toEqual([
      "-vaapi_device", "/dev/dri/renderD128",
      "-c:v", "h264_vaapi",
      "-vf", "scale=1280:720,format=nv12,hwupload",
    ]);
  });

  it("selects NVIDIA NVENC on Windows", async () => {
    await expect(
      resolveRenderAcceleration(
        { ...baseEnvironment, RENDER_ACCELERATOR: "nvidia" },
        "win32",
        async (_path, _bitrate, encoder) => encoder === "h264_nvenc",
        () => false,
      ),
    ).resolves.toMatchObject({
      mode: "gpu",
      vendor: "nvidia",
      encoder: "h264_nvenc",
    });
  });

  it("selects Linux AMD VAAPI when the render device exists", async () => {
    await expect(
      resolveRenderAcceleration(
        {
          ...baseEnvironment,
          RENDER_ACCELERATOR: "amd",
          RENDER_VAAPI_DEVICE: "/dev/dri/renderD128",
        },
        "linux",
        async (_path, _bitrate, encoder) => encoder === "h264_vaapi",
        (filePath) => filePath === "/dev/dri/renderD128",
      ),
    ).resolves.toMatchObject({
      mode: "gpu",
      vendor: "amd",
      encoder: "h264_vaapi",
      vaapiDevice: "/dev/dri/renderD128",
    });
  });

  it("prefers visible NVIDIA in auto mode", async () => {
    await expect(
      resolveRenderAcceleration(
        {
          ...baseEnvironment,
          RENDER_ACCELERATOR: "auto",
          NVIDIA_VISIBLE_DEVICES: "0",
        },
        "linux",
        async (_path, _bitrate, encoder) => encoder === "h264_nvenc",
        () => false,
      ),
    ).resolves.toMatchObject({ vendor: "nvidia", encoder: "h264_nvenc" });
  });

  it("falls back to CPU after an NVIDIA probe fails", async () => {
    await expect(
      resolveRenderAcceleration(
        { ...baseEnvironment, RENDER_ACCELERATOR: "nvidia" },
        "linux",
        async () => false,
        () => false,
      ),
    ).resolves.toEqual({ mode: "cpu", reason: "nvenc-probe-failed" });
  });

  it("honors an explicit CPU selection", async () => {
    await expect(
      resolveRenderAcceleration(
        { ...baseEnvironment, RENDER_ACCELERATOR: "cpu" },
        "linux",
        async () => true,
        () => true,
      ),
    ).resolves.toEqual({ mode: "cpu", reason: "disabled" });
  });
});
