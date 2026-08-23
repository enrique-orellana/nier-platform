import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import process from "node:process";
import { spawnSync } from "node:child_process";

function usage() {
  console.error("Usage: node scripts/benchmark-render.mjs --request request.json [--endpoint http://127.0.0.1:13101] [--runs 1]");
  console.error("   or: node scripts/benchmark-render.mjs --baseline baseline.mp4 --candidate candidate.mp4");
  process.exit(2);
}

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const requestPath = arg("--request", "");
const endpoint = arg("--endpoint", "http://127.0.0.1:13101").replace(/\/$/, "");
const runs = Number.parseInt(arg("--runs", "1"), 10);
if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer");

const baselinePath = arg("--baseline", "");
const candidatePath = arg("--candidate", "");
if (baselinePath || candidatePath) {
  if (!baselinePath || !candidatePath) usage();

  const probe = (filePath) => JSON.parse(execFileSync("ffprobe", [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", filePath,
  ], { encoding: "utf8" }));
  const metadata = (payload) => {
    const video = payload.streams.find((stream) => stream.codec_type === "video") || {};
    const audio = payload.streams.find((stream) => stream.codec_type === "audio") || {};
    return {
      video: Object.fromEntries(["codec_name", "profile", "width", "height", "avg_frame_rate", "pix_fmt", "color_range", "color_space", "color_transfer", "color_primaries", "duration"].map((key) => [key, video[key] ?? null])),
      audio: Object.fromEntries(["codec_name", "sample_rate", "channels", "duration"].map((key) => [key, audio[key] ?? null])),
    };
  };
  const ssim = spawnSync("ffmpeg", [
    "-v", "info", "-i", baselinePath, "-i", candidatePath,
    "-lavfi", "[0:v][1:v]ssim=stats_file=-", "-f", "null", "-",
  ], { encoding: "utf8" });
  const ssimLine = `${ssim.stdout}\n${ssim.stderr}`.split(/\r?\n/).findLast((line) => line.includes("All:")) || "";
  const ssimMatch = ssimLine.match(/All:([0-9.]+)/);
  const result = {
    baseline: { path: baselinePath, bytes: (await fs.stat(baselinePath)).size, metadata: metadata(probe(baselinePath)) },
    candidate: { path: candidatePath, bytes: (await fs.stat(candidatePath)).size, metadata: metadata(probe(candidatePath)) },
    metadataMatch: JSON.stringify(metadata(probe(baselinePath))) === JSON.stringify(metadata(probe(candidatePath))),
    ssim: ssimMatch ? Number(ssimMatch[1]) : null,
    ssimLine,
    ffmpegExitCode: ssim.status,
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.metadataMatch && result.ssim !== null ? 0 : 1);
}

if (!requestPath) usage();
const request = JSON.parse(await fs.readFile(requestPath, "utf8"));
const results = [];

for (let run = 1; run <= runs; run += 1) {
  const payload = {
    ...request,
    jobId: `${request.jobId || "benchmark"}-run-${run}-${Date.now()}`,
  };
  const startedAt = performance.now();
  const response = await fetch(`${endpoint}/render`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`render request failed with HTTP ${response.status}: ${await response.text()}`);
  const queued = await response.json();
  let status;

  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const statusResponse = await fetch(`${endpoint}/render/${queued.renderId}`);
    if (!statusResponse.ok) throw new Error(`status request failed with HTTP ${statusResponse.status}`);
    status = await statusResponse.json();
    if (status.status === "done" || status.status === "error") break;
  }

  const result = {
    run,
    renderId: queued.renderId,
    elapsedMs: Math.round(performance.now() - startedAt),
    status: status.status,
    progress: status.progress,
    outputUrl: status.outputUrl,
    error: status.error,
  };

  if (status.outputUrl) {
    const outputUrl = new URL(status.outputUrl, `${endpoint}/`);
    result.media = JSON.parse(execFileSync("ffprobe", [
      "-v", "error", "-show_streams", "-show_format", "-of", "json", outputUrl.toString(),
    ], { encoding: "utf8" }));
  }
  results.push(result);
  console.log(JSON.stringify(result));
}

const durations = results.map((result) => result.elapsedMs);
console.log(JSON.stringify({
  endpoint,
  runs,
  minElapsedMs: Math.min(...durations),
  maxElapsedMs: Math.max(...durations),
  averageElapsedMs: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
}));
