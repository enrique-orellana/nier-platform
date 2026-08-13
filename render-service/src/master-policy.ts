import fs from "node:fs";
import path from "node:path";

export interface MasterPolicy {
  version: number;
  container: "mp4";
  codec: "h264";
  profile: "high";
  h264_level: "4.2";
  crf: number;
  preset: "veryslow";
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
  const value = JSON.parse(fs.readFileSync(policyPath(), "utf8")) as MasterPolicy;
  if (value.codec !== "h264" || value.container !== "mp4" || value.crf !== 14 || value.preset !== "veryslow") {
    throw new Error("master-export-policy.json does not contain the mandatory master contract");
  }
  return Object.freeze(value);
}

export function buildRenderOptions(policy = loadMasterPolicy(), fps = 30) {
  const gopSize = Math.max(1, Math.round(fps * policy.gop_seconds));
  return {
    codec: policy.codec,
    crf: policy.crf,
    x264Preset: policy.preset,
    pixelFormat: policy.pixel_format,
    colorSpace: "bt709" as const,
    audioCodec: policy.audio_codec,
    audioBitrate: policy.audio_bitrate as `${number}k`,
    sampleRate: policy.audio_sample_rate,
    gopSize,
    everyNthFrame: 1,
    concurrency: null,
  } as const;
}
