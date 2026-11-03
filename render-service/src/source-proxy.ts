import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export interface RangeProxyResult {
  videoUrl: string;
  videoStartSeconds: number;
  proxyPath?: string;
  standardBackgroundVideoUrl?: string;
  standardBackgroundProxyPath?: string;
}

interface RangeProxyOptions {
  videoUrl: string;
  outputDir: string;
  serverPort: number;
  jobId: string;
  startSeconds: number;
  durationSeconds: number;
  includeStandardBackground?: boolean;
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

export function standardBackgroundProxyCacheName(
  sourcePath: string,
  startSeconds: number,
  durationSeconds: number,
  sourceSize: number,
  sourceMtimeMs: number,
): string {
  return rangeProxyCacheName(
    sourcePath,
    startSeconds,
    durationSeconds,
    sourceSize,
    sourceMtimeMs,
  ).replace(/\.mp4$/i, "-bg.mp4");
}

export function buildStandardBackgroundProxyArgs(
  sourcePath: string,
  proxyPath: string,
  startSeconds: number,
  durationSeconds: number,
): string[] {
  return [
    "-y", "-ss", String(startSeconds), "-i", sourcePath, "-t", String(durationSeconds),
    "-map", "0:v:0",
    "-vf", "scale=960:-2:flags=fast_bilinear,boxblur=luma_radius=12:luma_power=1",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-an", "-movflags", "+faststart", proxyPath,
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
      else {
        const safeStderr = stderr
          .replace(/https?:\/\/[^\s"'<>]+/gi, "[remote media URL]")
          .trim()
          .slice(-2000);
        reject(new Error(safeStderr || `range proxy ffmpeg failed with code ${code}`));
      }
    });
  });
}

const DEFAULT_REMOTE_SOURCE_ORIGINS = [
  "http://seaweedfs-s3.192.168.50.2.nip.io:32380",
];

function normalizeRemoteSourceOrigin(value: string): string | null {
  try {
    const origin = new URL(value);
    if ((origin.protocol !== "http:" && origin.protocol !== "https:")
      || origin.username
      || origin.password
      || origin.pathname !== "/"
      || origin.search
      || origin.hash) {
      return null;
    }
    return origin.origin;
  } catch {
    return null;
  }
}

function signedRemoteSourceUrl(videoUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(videoUrl);
  } catch {
    return null;
  }

  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || parsed.username
    || parsed.password) {
    return null;
  }

  const configuredOrigins = process.env.RENDER_SOURCE_PROXY_ALLOWED_ORIGINS
    ?.split(",")
    .map((origin) => normalizeRemoteSourceOrigin(origin.trim()))
    .filter((origin): origin is string => Boolean(origin));
  const allowedOrigins = configuredOrigins?.length
    ? configuredOrigins
    : DEFAULT_REMOTE_SOURCE_ORIGINS;
  if (!allowedOrigins.includes(parsed.origin)) return null;

  const hasSignature = [...parsed.searchParams.entries()].some(([name, value]) => {
    const normalizedName = name.toLowerCase();
    return (normalizedName === "x-amz-signature" || normalizedName === "signature")
      && Boolean(value.trim());
  });
  return hasSignature ? parsed.toString() : null;
}

async function ensureCachedProxy(cachePath: string, args: string[]): Promise<void> {
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0) return;

  const temporaryPath = rangeProxyTemporaryPath(
    cachePath,
    process.pid,
    Date.now(),
  );
  try {
    await runFfmpeg(args.slice(0, -1).concat(temporaryPath));
    fs.renameSync(temporaryPath, cachePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

const inFlightProxies = new Map<string, Promise<RangeProxyResult>>();

export function prepareRangeProxy(options: RangeProxyOptions): Promise<RangeProxyResult> {
  const {
    videoUrl,
    outputDir,
    serverPort,
    jobId,
    startSeconds,
    durationSeconds,
    includeStandardBackground = false,
  } = options;
  if (!Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return Promise.resolve({ videoUrl, videoStartSeconds: Math.max(0, startSeconds || 0) });
  }
  const localSourcePath = localOutputPath(videoUrl, outputDir);
  const remoteSourceUrl = localSourcePath ? null : signedRemoteSourceUrl(videoUrl);
  const sourcePath = localSourcePath || remoteSourceUrl;
  if (!sourcePath) {
    return Promise.resolve({ videoUrl, videoStartSeconds: startSeconds });
  }
  if (localSourcePath && !fs.existsSync(localSourcePath)) {
    return Promise.resolve({ videoUrl, videoStartSeconds: startSeconds });
  }

  const sourceIsGeneratedClip = Boolean(
    localSourcePath && startSeconds === 0 && isGeneratedClipPath(localSourcePath),
  );
  if (sourceIsGeneratedClip && !includeStandardBackground) {
    return Promise.resolve({ videoUrl, videoStartSeconds: 0 });
  }
  const sourceStat = localSourcePath ? fs.statSync(localSourcePath) : undefined;
  const cacheSourceIdentity = localSourcePath || videoUrl;
  const sourceSize = sourceStat?.size ?? 0;
  const sourceMtimeMs = sourceStat?.mtimeMs ?? 0;
  // Keep range proxies inside the owning job directory so project deletion
  // removes the cache together with the rendered output.
  const cacheDir = path.join(outputDir, jobId, "render-cache");
  const cachePath = path.join(
    cacheDir,
    rangeProxyCacheName(cacheSourceIdentity, startSeconds, durationSeconds, sourceSize, sourceMtimeMs),
  );
  const standardBackgroundPath = includeStandardBackground
    ? path.join(
        cacheDir,
        standardBackgroundProxyCacheName(
          cacheSourceIdentity,
          startSeconds,
          durationSeconds,
          sourceSize,
          sourceMtimeMs,
        ),
      )
    : undefined;
  const inFlightKey = standardBackgroundPath || cachePath;
  const existing = inFlightProxies.get(inFlightKey);
  if (existing) return existing;

  const work = (async (): Promise<RangeProxyResult> => {
    fs.mkdirSync(cacheDir, { recursive: true });
    const foregroundProxyPath = sourceIsGeneratedClip ? undefined : cachePath;
    if (foregroundProxyPath) {
      await ensureCachedProxy(
        foregroundProxyPath,
        buildRangeProxyArgs(sourcePath, foregroundProxyPath, startSeconds, durationSeconds),
      );
    }

    if (standardBackgroundPath) {
      const backgroundSourcePath = foregroundProxyPath || sourcePath;
      const backgroundStartSeconds = foregroundProxyPath ? 0 : startSeconds;
      await ensureCachedProxy(
        standardBackgroundPath,
        buildStandardBackgroundProxyArgs(
          backgroundSourcePath,
          standardBackgroundPath,
          backgroundStartSeconds,
          durationSeconds,
        ),
      );
    }

    return {
      videoUrl: foregroundProxyPath
        ? proxyUrl(outputDir, foregroundProxyPath, serverPort)
        : videoUrl,
      videoStartSeconds: foregroundProxyPath ? 0 : startSeconds,
      proxyPath: foregroundProxyPath,
      standardBackgroundVideoUrl: standardBackgroundPath
        ? proxyUrl(outputDir, standardBackgroundPath, serverPort)
        : undefined,
      standardBackgroundProxyPath: standardBackgroundPath,
    };
  })();
  inFlightProxies.set(inFlightKey, work);
  return work.finally(() => inFlightProxies.delete(inFlightKey));
}
