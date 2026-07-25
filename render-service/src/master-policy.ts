import fs from "node:fs";
import path from "node:path";

export interface MasterPolicy {
  version: number;
  container: "mp4";
  codec: "h264";
  profile: "high";
  crf: number;
  preset: "veryslow";
  pixel_format: "yuv420p";
  max_width: number;
  max_height: number;
  max_fps: number;
  audio_codec: "aac";
  audio_sample_rate: number;
  audio_bitrate: string;
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

export function buildRenderOptions(policy = loadMasterPolicy()) {
  return {
    codec: policy.codec,
    crf: policy.crf,
    x264Preset: policy.preset,
    pixelFormat: policy.pixel_format,
    audioCodec: policy.audio_codec,
    audioBitrate: policy.audio_bitrate as `${number}k`,
  } as const;
}
