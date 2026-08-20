import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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

function text(value: string | number | undefined): string {
  return String(value ?? "");
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
  if (text(video.profile).toLowerCase() !== policy.profile) throw new Error("master output profile does not match the export policy");
  if (video.pix_fmt !== policy.pixel_format) throw new Error("master output pixel format does not match the export policy");
  if (number(video.width) !== expected.width || number(video.height) !== expected.height) {
    throw new Error("master output dimensions do not match the export policy");
  }
  if (Math.abs(rate(video.avg_frame_rate) - expected.fps) > 0.001) {
    throw new Error("master output frame rate does not match the source policy");
  }
  if (!["1:1", "1/1"].includes(text(video.sample_aspect_ratio))) {
    throw new Error("master output must use square pixels (SAR 1:1)");
  }
  if (text(video.color_range) !== policy.color_range || text(video.color_space) !== policy.color_space || text(video.color_transfer) !== policy.color_transfer || text(video.color_primaries) !== policy.color_primaries) {
    throw new Error("master output must carry BT.709 SDR color metadata");
  }
  const rotation = text((video.tags as Record<string, string> | undefined)?.rotate);
  if (rotation && rotation !== "0") throw new Error("master output must not rely on rotation metadata");
  if (expected.requireAudio && !audio) throw new Error("master output has no audio stream");
  if (expected.requireAudio && audio) {
    if (audio.codec_name !== policy.audio_codec || number(audio.sample_rate) !== policy.audio_sample_rate || number(audio.channels) !== policy.audio_channels) {
      throw new Error("master output audio must be AAC stereo at 48 kHz");
    }
    if (number(audio.bit_rate) <= 0) throw new Error("master output audio bitrate is invalid");
  }
  // The container duration follows the longest stream. AAC frame padding can
  // extend it by a few milliseconds beyond the requested video frame clock,
  // so validate against the video stream whenever ffprobe provides it.
  const duration = video.duration !== undefined
    ? number(video.duration)
    : number(payload.format?.duration);
  if (Math.abs(duration - expected.durationSeconds) > (1 / expected.fps) + 0.01) {
    throw new Error("master output duration is outside the one-frame tolerance");
  }
  if (expected.toneMappedToSdr && video.color_transfer && video.color_transfer !== policy.color_transfer) {
    throw new Error("HDR transfer metadata remained in the SDR master");
  }
}

function assertFastStart(filePath: string): void {
  const data = fs.readFileSync(filePath);
  let offset = 0;
  let moov = -1;
  let mdat = -1;
  while (offset + 8 <= data.length) {
    let size = data.readUInt32BE(offset);
    const type = data.toString("ascii", offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > data.length) throw new Error("master output has an invalid MP4 box");
      const largeSize = Number(data.readBigUInt64BE(offset + 8));
      size = largeSize;
      headerSize = 16;
    } else if (size === 0) {
      size = data.length - offset;
    }
    if (size < headerSize || offset + size > data.length) throw new Error("master output has an invalid MP4 box");
    if (type === "moov" && moov < 0) moov = offset;
    if (type === "mdat" && mdat < 0) mdat = offset;
    offset += size;
  }
  if (moov < 0 || (mdat >= 0 && moov > mdat)) throw new Error("master output is not fast-start");
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
  assertFastStart(path.resolve(outputPath));
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-v", "error", "-i", outputPath, "-f", "null", "-"]);
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || "master output has decode errors")));
  });
}
