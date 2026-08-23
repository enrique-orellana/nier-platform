import fs from "node:fs";
import path from "node:path";
import type { FfmpegOverrideFn } from "@remotion/renderer";

export type X264Preset =
  | "superfast"
  | "fast"
  | "faster"
  | "medium"
  | "placebo"
  | "slow"
  | "slower"
  | "ultrafast"
  | "veryfast"
  | "veryslow";

const X264_PRESETS = new Set<X264Preset>([
  "superfast", "fast", "faster", "medium", "placebo", "slow", "slower", "ultrafast", "veryfast", "veryslow",
]);

export interface MasterPolicy {
  version: number;
  container: "mp4";
  codec: "h264";
  profile: "high";
  h264_level: "4.2";
  crf: number;
  preset: X264Preset;
  pixel_format: "yuv420p";
  output_width: number;
  output_height: number;
  max_width: number;
  max_height: number;
  max_fps: number;
  gop_seconds: number;
  audio_codec: "aac";
  audio_sample_rate: number;
  audio_channels: number;
  audio_bitrate: string;
  color_range: "tv";
  color_space: "bt709";
  color_transfer: "bt709";
  color_primaries: "bt709";
  faststart: boolean;
}

function policyPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "master-export-policy.json"),
    path.resolve(process.cwd(), "..", "master-export-policy.json"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("master-export-policy.json was not found");
  return found;
}

export function loadMasterPolicy(): MasterPolicy {
  return parseMasterPolicy(JSON.parse(fs.readFileSync(policyPath(), "utf8")));
}

export type RenderVideoBitrate = `${number}${"k" | "K" | "M"}`;

export interface HardwareRenderOptions {
  hardwareAcceleration: "required";
  binariesDirectory: string;
  videoBitrate: RenderVideoBitrate;
  ffmpegOverride: FfmpegOverrideFn;
}

export function parseMasterPolicy(value: unknown): MasterPolicy {
  if (!value || typeof value !== "object") {
    throw new Error("master-export-policy.json does not contain the mandatory master contract");
  }
  const candidate = value as Record<string, unknown>;
  const stringFields = [
    "container", "codec", "profile", "h264_level", "preset", "pixel_format",
    "audio_codec", "audio_bitrate", "color_range", "color_space", "color_transfer", "color_primaries",
  ];
  const numberFields = [
    "version", "crf", "output_width", "output_height", "max_width", "max_height", "max_fps",
    "gop_seconds", "audio_sample_rate", "audio_channels",
  ];
  const valid = candidate.container === "mp4" && candidate.codec === "h264" &&
    stringFields.every((field) => typeof candidate[field] === "string" && candidate[field]) &&
    numberFields.every((field) => typeof candidate[field] === "number" && Number.isFinite(candidate[field])) &&
    X264_PRESETS.has(candidate.preset as X264Preset) &&
    candidate.version === 1 && typeof candidate.faststart === "boolean";
  if (!valid) {
    throw new Error("master-export-policy.json does not contain the mandatory master contract");
  }
  return Object.freeze(candidate as unknown as MasterPolicy);
}

export function buildRenderOptions(
  policy = loadMasterPolicy(),
  fps = 30,
  hardware?: HardwareRenderOptions,
) {
  const gopSize = Math.max(1, Math.round(fps * policy.gop_seconds));
  const common = {
    codec: policy.codec,
    pixelFormat: policy.pixel_format,
    colorSpace: "bt709" as const,
    audioCodec: policy.audio_codec,
    audioBitrate: policy.audio_bitrate as `${number}k`,
    sampleRate: policy.audio_sample_rate,
    gopSize,
    everyNthFrame: 1,
    concurrency: null,
  } as const;

  if (hardware) {
    return {
      ...common,
      hardwareAcceleration: hardware.hardwareAcceleration,
      binariesDirectory: hardware.binariesDirectory,
      videoBitrate: hardware.videoBitrate,
      ffmpegOverride: hardware.ffmpegOverride,
    } as const;
  }

  return {
    ...common,
    crf: policy.crf,
    x264Preset: policy.preset,
  } as const;
}
