import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { FfmpegOverrideFn } from "@remotion/renderer";
import type { RenderVideoBitrate } from "./master-policy.js";

const execFileAsync = promisify(execFile);

export type RenderAcceleration =
  | {
      mode: "gpu";
      hardwareAcceleration: "required";
      binariesDirectory: string;
      videoBitrate: RenderVideoBitrate;
    }
  | { mode: "cpu"; reason: string };

type Environment = Record<string, string | undefined>;
type Probe = (ffmpegPath: string, videoBitrate: RenderVideoBitrate) => Promise<boolean>;

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

async function probeAmf(ffmpegPath: string, videoBitrate: RenderVideoBitrate): Promise<boolean> {
  try {
    await execFileAsync(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=30:duration=1",
      "-pix_fmt",
      "yuv420p",
      "-frames:v",
      "1",
      "-c:v",
      "h264_amf",
      "-b:v",
      videoBitrate,
      "-f",
      "null",
      "-",
    ], { windowsHide: true, timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export async function resolveRenderAcceleration(
  environment: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
  probe: Probe = probeAmf,
): Promise<RenderAcceleration> {
  if (environment.RENDER_HARDWARE_ACCELERATION !== "if-possible") {
    return { mode: "cpu", reason: "disabled" };
  }

  if (platform !== "win32") {
    return { mode: "cpu", reason: "windows-amf-only" };
  }

  const ffmpegPath = environment.RENDER_FFMPEG_PATH;
  const binariesDirectory = environment.RENDER_FFMPEG_DIRECTORY;
  const videoBitrate = environment.RENDER_HARDWARE_VIDEO_BITRATE;
  if (
    !ffmpegPath ||
    !binariesDirectory ||
    !videoBitrate ||
    !/^\d+(?:\.\d+)?[kKmM]$/.test(videoBitrate)
  ) {
    return { mode: "cpu", reason: "gpu-configuration-incomplete" };
  }

  const bitrate = videoBitrate as RenderVideoBitrate;
  if (!(await probe(ffmpegPath, bitrate))) {
    return { mode: "cpu", reason: "amf-probe-failed" };
  }

  return {
    mode: "gpu",
    hardwareAcceleration: "required",
    binariesDirectory: path.normalize(binariesDirectory),
    videoBitrate: bitrate,
  };
}
