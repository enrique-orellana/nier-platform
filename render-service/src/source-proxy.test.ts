import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));
import {
  buildRangeProxyArgs,
  buildStandardBackgroundProxyArgs,
  prepareRangeProxy,
  rangeProxyCacheName,
  rangeProxyTemporaryPath,
  standardBackgroundProxyCacheName,
} from "./source-proxy.js";

describe("range source proxy", () => {
  it("creates a stable cache name for a source range", () => {
    const name = rangeProxyCacheName("source.mp4", 12.5, 8, 1234, 5678);
    expect(name).toMatch(/^clip-[a-f0-9]{16}\.mp4$/);
    expect(name).toBe(rangeProxyCacheName("source.mp4", 12.5, 8, 1234, 5678));
    expect(name).not.toBe(rangeProxyCacheName("source.mp4", 12.5, 9, 1234, 5678));
  });

  it("builds a bounded H.264 extraction command", () => {
    expect(buildRangeProxyArgs("source.mp4", "proxy.mp4", 12.5, 8)).toEqual([
      "-y", "-ss", "12.5", "-i", "source.mp4", "-t", "8",
      "-map", "0:v:0", "-map", "0:a:0?",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "192k", "-shortest",
      "-movflags", "+faststart", "proxy.mp4",
    ]);
  });

  it("keeps an mp4 suffix on temporary extraction files for ffmpeg", () => {
    expect(rangeProxyTemporaryPath("proxy.mp4", 42, 123)).toBe(
      "proxy.mp4.tmp-42-123.mp4",
    );
  });

  it("reuses an already-trimmed generated clip without running ffmpeg", async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "source-proxy-"));
    const sourcePath = path.join(outputDir, "job-1", "source_clip_14.mp4");
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, "already-trimmed");

    try {
      await expect(
        prepareRangeProxy({
          videoUrl: "http://localhost:3100/output/job-1/source_clip_14.mp4",
          outputDir,
          serverPort: 3100,
          jobId: "job-1",
          startSeconds: 0,
          durationSeconds: 2,
        }),
      ).resolves.toEqual({
        videoUrl: "http://localhost:3100/output/job-1/source_clip_14.mp4",
        videoStartSeconds: 0,
      });
      expect(fs.existsSync(path.join(outputDir, "job-1", "render-cache"))).toBe(false);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("builds a silent low-resolution pre-blurred command for Standard backgrounds", () => {
    expect(
      buildStandardBackgroundProxyArgs("source.mp4", "background.mp4", 12.5, 8),
    ).toEqual([
      "-y", "-ss", "12.5", "-i", "source.mp4", "-t", "8",
      "-map", "0:v:0",
      "-vf", "scale=960:-2:flags=fast_bilinear,boxblur=luma_radius=12:luma_power=1",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-an", "-movflags", "+faststart", "background.mp4",
    ]);
  });

  it("uses a separate stable cache name for the Standard background", () => {
    const foreground = rangeProxyCacheName("source.mp4", 12.5, 8, 1234, 5678);
    const background = standardBackgroundProxyCacheName("source.mp4", 12.5, 8, 1234, 5678);

    expect(background).toMatch(/^clip-[a-f0-9]{16}-bg\.mp4$/);
    expect(background).not.toBe(foreground);
    expect(background).toBe(
      standardBackgroundProxyCacheName("source.mp4", 12.5, 8, 1234, 5678),
    );
  });

  it("shares a cached source range across render jobs", async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "source-proxy-shared-"));
    const sourcePath = path.join(outputDir, "uploads", "source.mp4");
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, "source");
    spawnMock.mockImplementation((_command, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
      child.stderr = new EventEmitter();
      fs.writeFileSync(args.at(-1)!, "proxy");
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });

    const baseOptions = {
      videoUrl: "http://localhost:3100/output/uploads/source.mp4",
      outputDir,
      serverPort: 3100,
      startSeconds: 2,
      durationSeconds: 4,
    };

    try {
      const first = await prepareRangeProxy({ ...baseOptions, jobId: "job-1" });
      const second = await prepareRangeProxy({ ...baseOptions, jobId: "job-2" });

      expect(second).toEqual(first);
      expect(first.proxyPath).toContain(`${path.sep}render-cache${path.sep}`);
      expect(spawnMock).toHaveBeenCalledTimes(1);
    } finally {
      spawnMock.mockReset();
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("caches a Standard background beside the foreground proxy when requested", async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "source-proxy-background-"));
    const sourcePath = path.join(outputDir, "uploads", "source.mp4");
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, "source");
    spawnMock.mockImplementation((_command, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
      child.stderr = new EventEmitter();
      fs.writeFileSync(args.at(-1)!, "proxy");
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });

    try {
      const result = await prepareRangeProxy({
        videoUrl: "http://localhost:3100/output/uploads/source.mp4",
        outputDir,
        serverPort: 3100,
        jobId: "job-1",
        startSeconds: 2,
        durationSeconds: 4,
        includeStandardBackground: true,
      });

      expect(result.proxyPath).toMatch(/render-cache[\\/]clip-[a-f0-9]{16}\.mp4$/);
      expect(result.standardBackgroundProxyPath).toMatch(
        /render-cache[\\/]clip-[a-f0-9]{16}-bg\.mp4$/,
      );
      expect(result.standardBackgroundVideoUrl).toMatch(
        /\/output\/render-cache\/clip-[a-f0-9]{16}-bg\.mp4$/,
      );
      expect(spawnMock).toHaveBeenCalledTimes(2);
      expect(spawnMock.mock.calls[1][1]).toContain("-an");
      expect(spawnMock.mock.calls[1][1]).toContain(
        "scale=960:-2:flags=fast_bilinear,boxblur=luma_radius=12:luma_power=1",
      );
    } finally {
      spawnMock.mockReset();
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
