import { describe, expect, it } from "vitest";
import {
  buildRangeProxyArgs,
  rangeProxyCacheName,
  rangeProxyTemporaryPath,
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
});
