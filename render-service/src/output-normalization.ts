import { spawn } from "node:child_process";
import fs from "node:fs";
import { loadMasterPolicy, type MasterPolicy } from "./master-policy.js";

export interface NormalizationOptions {
  fps: number;
  hasAudio: boolean;
}

export function buildNormalizationArgs(
  inputPath: string,
  outputPath: string,
  options: NormalizationOptions,
  policy: MasterPolicy = loadMasterPolicy(),
): string[] {
  const gopSize = Math.max(1, Math.round(options.fps * policy.gop_seconds));
  const args = [
    "-y",
    "-i", inputPath,
    "-map", "0:v:0",
    "-c:v", "libx264",
    "-profile:v", policy.profile,
    "-level:v", policy.h264_level,
    "-preset", policy.preset,
    "-crf", String(policy.crf),
    "-pix_fmt", policy.pixel_format,
    "-vf", "setsar=1,colorspace=all=bt709:iall=bt709:range=tv:irange=tv",
    "-g", String(gopSize),
    "-keyint_min", String(gopSize),
    "-sc_threshold", "0",
    "-flags:v", "+cgop",
    "-colorspace", policy.color_space,
    "-color_range", policy.color_range,
    "-color_trc", policy.color_transfer,
    "-color_primaries", policy.color_primaries,
    "-video_track_timescale", "90000",
  ];

  if (options.hasAudio) {
    args.push(
      "-map", "0:a:0",
      "-c:a", "aac",
      "-ar", String(policy.audio_sample_rate),
      "-ac", String(policy.audio_channels),
      "-b:a", policy.audio_bitrate,
      "-shortest",
    );
  } else {
    args.push("-an");
  }

  args.push("-movflags", "+faststart", "-map_metadata", "-1", outputPath);
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
