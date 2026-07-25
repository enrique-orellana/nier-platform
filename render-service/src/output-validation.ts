import { spawn } from "node:child_process";
import fs from "node:fs";
import type { MasterPolicy } from "./master-policy.js";

export interface OutputExpectation {
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  requireAudio: boolean;
  toneMappedToSdr: boolean;
}

export interface ProbePayload {
  streams?: Array<Record<string, string | number | undefined>>;
  format?: Record<string, string | number | undefined>;
}

function number(value: string | number | undefined): number {
  return Number(value || 0);
}

function rate(value: string | number | undefined): number {
  const [num, den] = String(value || "0/1").split("/").map(Number);
  return den ? num / den : Number(value || 0);
}

export function validateProbePayload(
  payload: ProbePayload,
  expected: OutputExpectation,
  policy: MasterPolicy,
): void {
  const streams = payload.streams || [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  if (!video) throw new Error("master output has no video stream");
  if (video.codec_name !== policy.codec) throw new Error("master output is not H.264");
  if (video.pix_fmt !== policy.pixel_format) throw new Error("master output is not yuv420p");
  if (number(video.width) !== expected.width || number(video.height) !== expected.height) {
    throw new Error("master output dimensions do not match the export policy");
  }
  if (Math.abs(rate(video.avg_frame_rate) - expected.fps) > 0.001) {
    throw new Error("master output frame rate does not match the source policy");
  }
  if (expected.requireAudio && !audio) throw new Error("master output has no audio stream");
  const duration = number(payload.format?.duration);
  if (Math.abs(duration - expected.durationSeconds) > (1 / expected.fps) + 0.01) {
    throw new Error("master output duration is outside the one-frame tolerance");
  }
  if (expected.toneMappedToSdr && video.color_transfer && video.color_transfer !== "bt709") {
    throw new Error("HDR transfer metadata remained in the SDR master");
  }
}

export async function validateOutputFile(
  outputPath: string,
  expected: OutputExpectation,
  policy: MasterPolicy,
): Promise<void> {
  if (!fs.existsSync(outputPath)) throw new Error("master output file does not exist");
  const payload = await new Promise<ProbePayload>((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", outputPath]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr || "ffprobe failed")));
  });
  validateProbePayload(payload, expected, policy);
}
