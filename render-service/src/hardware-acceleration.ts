import fs from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { FfmpegOverrideFn } from "@remotion/renderer";
import type { RenderVideoBitrate } from "./master-policy.js";

const execFileAsync = promisify(execFile);

export type RenderEncoder = "h264_nvenc" | "h264_amf" | "h264_vaapi";
export type RenderVendor = "nvidia" | "amd";
export type AcceleratorPreference = "auto" | "nvidia" | "amd" | "cpu";

export type RenderAcceleration =
  | {
      mode: "gpu";
      vendor: RenderVendor;
      encoder: RenderEncoder;
      hardwareAcceleration: "required";
      videoBitrate: RenderVideoBitrate;
      ffmpegOverride: FfmpegOverrideFn;
      binariesDirectory?: string;
      vaapiDevice?: string;
    }
  | { mode: "cpu"; reason: string };

type Environment = Record<string, string | undefined>;
type FileExists = (filePath: string) => boolean;
export type HardwareProbe = (
  ffmpegPath: string,
  videoBitrate: RenderVideoBitrate,
  encoder: RenderEncoder,
  vaapiDevice?: string,
) => Promise<boolean>;

export function createAmfFfmpegOverride(): FfmpegOverrideFn {
  return ({ args }) => {
    const rewritten: string[] = [];

    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index];
      if (argument === "-preset") {
        index += 1;
        continue;
      }
      rewritten.push(
        argument === "h264_nvenc"
          ? "h264_amf"
          : argument === "libfdk_aac"
            ? "aac"
            : argument,
      );
    }

    return rewritten;
  };
}

function createNoopFfmpegOverride(): FfmpegOverrideFn {
  return ({ args }) => args;
}

export function createVaapiFfmpegOverride(vaapiDevice?: string): FfmpegOverrideFn {
  return ({ args }) => {
    const rewritten: string[] = [];
    let hasVideoFilter = false;

    if (vaapiDevice && !args.includes("-vaapi_device")) {
      rewritten.push("-vaapi_device", vaapiDevice);
    }

    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index];
      if (["-preset", "-crf", "-x264-params"].includes(argument)) {
        index += 1;
        continue;
      }
      if (argument === "-c:v" || argument === "-codec:v") {
        rewritten.push(argument, "h264_vaapi");
        index += 1;
        continue;
      }
      if (argument === "h264_nvenc" || argument === "h264_amf" || argument === "libx264") {
        rewritten.push("h264_vaapi");
        continue;
      }
      if (argument === "-vf" || argument === "-filter:v") {
        const filter = args[index + 1];
        if (filter) {
          rewritten.push(argument, filter.includes("format=nv12,hwupload")
            ? filter
            : `${filter},format=nv12,hwupload`);
          index += 1;
          hasVideoFilter = true;
        }
        continue;
      }
      rewritten.push(argument);
    }

    if (!hasVideoFilter) {
      rewritten.push("-vf", "format=nv12,hwupload");
    }

    return rewritten;
  };
}

async function probeHardware(
  ffmpegPath: string,
  videoBitrate: RenderVideoBitrate,
  encoder: RenderEncoder,
  vaapiDevice?: string,
): Promise<boolean> {
  try {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      ...(encoder === "h264_vaapi" && vaapiDevice ? ["-vaapi_device", vaapiDevice] : []),
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=30:duration=1",
      ...(encoder === "h264_vaapi" ? ["-vf", "format=nv12,hwupload"] : []),
      "-pix_fmt",
      "yuv420p",
      "-frames:v",
      "1",
      "-c:v",
      encoder,
      "-b:v",
      videoBitrate,
      "-f",
      "null",
      "-",
    ];
    await execFileAsync(ffmpegPath, args, { windowsHide: true, timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

function parsePreference(environment: Environment): AcceleratorPreference {
  const preference = environment.RENDER_ACCELERATOR?.trim().toLowerCase();
  return preference === "nvidia" || preference === "amd" || preference === "cpu"
    ? preference
    : "auto";
}

function hasVisibleNvidia(environment: Environment): boolean {
  const devices = environment.NVIDIA_VISIBLE_DEVICES?.trim().toLowerCase();
  return devices !== undefined && devices !== "" && devices !== "none" && devices !== "void";
}

function gpuResult(
  vendor: RenderVendor,
  encoder: RenderEncoder,
  videoBitrate: RenderVideoBitrate,
  environment: Environment,
  vaapiDevice?: string,
): RenderAcceleration {
  return {
    mode: "gpu",
    vendor,
    encoder,
    hardwareAcceleration: "required",
    videoBitrate,
    ffmpegOverride:
      encoder === "h264_amf"
        ? createAmfFfmpegOverride()
        : encoder === "h264_vaapi"
          ? createVaapiFfmpegOverride(vaapiDevice)
          : createNoopFfmpegOverride(),
    ...(environment.RENDER_FFMPEG_DIRECTORY
      ? { binariesDirectory: path.normalize(environment.RENDER_FFMPEG_DIRECTORY) }
      : {}),
    ...(vaapiDevice ? { vaapiDevice } : {}),
  };
}

export async function resolveRenderAcceleration(
  environment: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
  probe: HardwareProbe = probeHardware,
  fileExists: FileExists = fs.existsSync,
): Promise<RenderAcceleration> {
  if (environment.RENDER_HARDWARE_ACCELERATION !== "if-possible") {
    return { mode: "cpu", reason: "disabled" };
  }

  const preference = parsePreference(environment);
  if (preference === "cpu") {
    return { mode: "cpu", reason: "disabled" };
  }

  const ffmpegPath = environment.RENDER_FFMPEG_PATH;
  const videoBitrate = environment.RENDER_HARDWARE_VIDEO_BITRATE;
  if (!ffmpegPath || !videoBitrate || !/^\d+(?:\.\d+)?[kKmM]$/.test(videoBitrate)) {
    return { mode: "cpu", reason: "gpu-configuration-incomplete" };
  }

  const bitrate = videoBitrate as RenderVideoBitrate;
  const candidates: Array<{
    vendor: RenderVendor;
    encoder: RenderEncoder;
    device?: string;
    available: boolean;
    failureReason: string;
  }> = [];
  let lastFailureReason = "no-usable-gpu";
  const linux = platform === "linux";
  const requestedNvidia = preference === "nvidia";
  const requestedAmd = preference === "amd";

  if (requestedNvidia || (!requestedAmd && (preference === "auto" && hasVisibleNvidia(environment)))) {
    candidates.push({
      vendor: "nvidia",
      encoder: "h264_nvenc",
      available: requestedNvidia || hasVisibleNvidia(environment),
      failureReason: "nvenc-probe-failed",
    });
  }

  const vaapiDevice = environment.RENDER_VAAPI_DEVICE || "/dev/dri/renderD128";
  if (requestedAmd || preference === "auto") {
    candidates.push({
      vendor: "amd",
      encoder: linux ? "h264_vaapi" : "h264_amf",
      device: linux ? vaapiDevice : undefined,
      available: !linux || fileExists(vaapiDevice),
      failureReason: linux
        ? fileExists(vaapiDevice) ? "vaapi-probe-failed" : "amd-device-missing"
        : "amf-probe-failed",
    });
  }

  for (const candidate of candidates) {
    if (!candidate.available) continue;
    if (await probe(ffmpegPath, bitrate, candidate.encoder, candidate.device)) {
      return gpuResult(candidate.vendor, candidate.encoder, bitrate, environment, candidate.device);
    }
    lastFailureReason = candidate.failureReason;
    if (preference !== "auto") {
      return { mode: "cpu", reason: candidate.failureReason };
    }
  }

  if (preference === "nvidia") return { mode: "cpu", reason: "nvenc-probe-failed" };
  if (preference === "amd") {
    return {
      mode: "cpu",
      reason: linux && !fileExists(vaapiDevice) ? "amd-device-missing" : linux ? "vaapi-probe-failed" : "amf-probe-failed",
    };
  }
  return { mode: "cpu", reason: lastFailureReason };
}
