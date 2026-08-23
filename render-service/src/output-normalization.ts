import { spawn } from "node:child_process";
import fs from "node:fs";
import { loadMasterPolicy, type MasterPolicy } from "./master-policy.js";
import { isFastStart, probeOutputFile, validateProbePayload, type OutputExpectation, type ProbePayload } from "./output-validation.js";

export interface NormalizationOptions {
  fps: number;
  hasAudio: boolean;
  preserveVideo?: boolean;
}

export function outputNeedsNormalization(
  probe: ProbePayload,
  expected: OutputExpectation,
  policy: MasterPolicy,
  fastStart: boolean,
): boolean {
  try {
    validateProbePayload(probe, expected, policy);
    return policy.faststart && !fastStart;
  } catch {
    return true;
  }
}

export async function needsOutputNormalization(
  outputPath: string,
  expected: OutputExpectation,
  policy: MasterPolicy,
): Promise<boolean> {
  try {
    const probe = await probeOutputFile(outputPath);
    return outputNeedsNormalization(probe, expected, policy, isFastStart(outputPath));
  } catch {
    return true;
  }
}

export function buildNormalizationArgs(
  inputPath: string,
  outputPath: string,
  options: NormalizationOptions,
  policy: MasterPolicy = loadMasterPolicy(),
): string[] {
  const gopSize = Math.max(1, Math.round(options.fps * policy.gop_seconds));
  const args = ["-y", "-i", inputPath, "-map", "0:v:0"];

  if (options.preserveVideo) {
    args.push("-c:v", "copy");
  } else {
    args.push(
      "-c:v", "libx264",
      "-profile:v", policy.profile,
      "-level:v", policy.h264_level,
      "-preset", policy.preset,
      "-crf", String(policy.crf),
      "-pix_fmt", policy.pixel_format,
      "-vf", `setsar=1,colorspace=all=${policy.color_space}:iall=${policy.color_space}:range=${policy.color_range}:irange=${policy.color_range}`,
      "-g", String(gopSize),
      "-keyint_min", String(gopSize),
      "-sc_threshold", "0",
      "-flags:v", "+cgop",
      "-colorspace", policy.color_space,
      "-color_range", policy.color_range,
      "-color_trc", policy.color_transfer,
      "-color_primaries", policy.color_primaries,
      "-video_track_timescale", "90000",
    );
  }

  if (options.hasAudio) {
    args.push(
      "-map", "0:a:0",
      "-c:a", policy.audio_codec,
      "-ar", String(policy.audio_sample_rate),
      "-ac", String(policy.audio_channels),
      "-b:a", policy.audio_bitrate,
      "-shortest",
    );
  } else {
    args.push("-an");
  }

  if (policy.faststart) args.push("-movflags", "+faststart");
  args.push("-map_metadata", "-1", outputPath);
  return args;
}

export async function normalizeOutputFile(
  outputPath: string,
  options: NormalizationOptions,
): Promise<void> {
  const temporaryPath = `${outputPath}.normalized-${process.pid}.mp4`;
  const args = buildNormalizationArgs(outputPath, temporaryPath, options);
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `ffmpeg normalization failed with code ${code}`));
    });
  });
  fs.rmSync(outputPath, { force: true });
  fs.renameSync(temporaryPath, outputPath);
}
