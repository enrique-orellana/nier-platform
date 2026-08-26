import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export interface RangeProxyResult {
  videoUrl: string;
  videoStartSeconds: number;
  proxyPath?: string;
}

interface RangeProxyOptions {
  videoUrl: string;
  outputDir: string;
  serverPort: number;
  jobId: string;
  startSeconds: number;
  durationSeconds: number;
}

export function rangeProxyCacheName(
  sourcePath: string,
  startSeconds: number,
  durationSeconds: number,
  sourceSize: number,
  sourceMtimeMs: number,
): string {
  const key = JSON.stringify({ sourcePath, startSeconds, durationSeconds, sourceSize, sourceMtimeMs });
  return `clip-${crypto.createHash("sha256").update(key).digest("hex").slice(0, 16)}.mp4`;
}

export function buildRangeProxyArgs(
  sourcePath: string,
  proxyPath: string,
  startSeconds: number,
  durationSeconds: number,
): string[] {
  return [
    "-y", "-ss", String(startSeconds), "-i", sourcePath, "-t", String(durationSeconds),
    "-map", "0:v:0", "-map", "0:a:0?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "192k", "-shortest",
    "-movflags", "+faststart", proxyPath,
  ];
}

export function rangeProxyTemporaryPath(
  cachePath: string,
  processId: number,
  timestamp: number,
): string {
  return `${cachePath}.tmp-${processId}-${timestamp}.mp4`;
}

function localOutputPath(videoUrl: string, outputDir: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(videoUrl);
  } catch {
    return null;
  }
  if (!(parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")) return null;
  const prefix = "/output/";
  if (!parsed.pathname.startsWith(prefix)) return null;
  const candidate = path.resolve(outputDir, decodeURIComponent(parsed.pathname.slice(prefix.length)));
  const root = path.resolve(outputDir);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
  return candidate;
}

function proxyUrl(outputDir: string, proxyPath: string, serverPort: number): string {
  const relativePath = path.relative(outputDir, proxyPath).split(path.sep).join("/");
  return `http://localhost:${serverPort}/output/${relativePath}`;
}

function isGeneratedClipPath(sourcePath: string): boolean {
  return /^source_clip_[^/\\]+\.mp4$/i.test(path.basename(sourcePath));
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `range proxy ffmpeg failed with code ${code}`));
    });
  });
}

const inFlightProxies = new Map<string, Promise<RangeProxyResult>>();

export function prepareRangeProxy(options: RangeProxyOptions): Promise<RangeProxyResult> {
  const { videoUrl, outputDir, serverPort, jobId, startSeconds, durationSeconds } = options;
  if (!Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return Promise.resolve({ videoUrl, videoStartSeconds: Math.max(0, startSeconds || 0) });
  }
  const sourcePath = localOutputPath(videoUrl, outputDir);
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return Promise.resolve({ videoUrl, videoStartSeconds: startSeconds });
  }
  if (startSeconds === 0 && isGeneratedClipPath(sourcePath)) {
    return Promise.resolve({ videoUrl, videoStartSeconds: 0 });
  }
  const sourceStat = fs.statSync(sourcePath);
  // Keep range proxies outside the job directory so identical source ranges
  // can be reused by later renders and by different jobs.
  const cacheDir = path.join(outputDir, "render-cache");
  const cachePath = path.join(cacheDir, rangeProxyCacheName(sourcePath, startSeconds, durationSeconds, sourceStat.size, sourceStat.mtimeMs));
  const existing = inFlightProxies.get(cachePath);
  if (existing) return existing;

  const work = (async (): Promise<RangeProxyResult> => {
    fs.mkdirSync(cacheDir, { recursive: true });
    if (!fs.existsSync(cachePath) || fs.statSync(cachePath).size === 0) {
      const temporaryPath = rangeProxyTemporaryPath(
        cachePath,
        process.pid,
        Date.now(),
      );
      try {
        await runFfmpeg(buildRangeProxyArgs(sourcePath, temporaryPath, startSeconds, durationSeconds));
        fs.renameSync(temporaryPath, cachePath);
      } finally {
        fs.rmSync(temporaryPath, { force: true });
      }
    }
    return { videoUrl: proxyUrl(outputDir, cachePath, serverPort), videoStartSeconds: 0, proxyPath: cachePath };
  })();
  inFlightProxies.set(cachePath, work);
  return work.finally(() => inFlightProxies.delete(cachePath));
}
