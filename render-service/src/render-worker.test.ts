import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectComposition: vi.fn(async () => ({ width: 1080, height: 1920 })),
  renderMedia: vi.fn(async () => undefined),
}));

vi.mock("@remotion/renderer", () => mocks);
vi.mock("./server.js", () => ({ renderJobs: new Map() }));
vi.mock("./bundle.js", () => ({ getBundleLocation: vi.fn(() => "bundle") }));
vi.mock("./master-policy.js", () => ({
  buildRenderOptions: vi.fn(() => ({})),
  loadMasterPolicy: vi.fn(() => ({ output_width: 1080, output_height: 1920 })),
  resolveMediaCacheSizeInBytes: vi.fn(() => 1024 * 1024 * 1024),
}));
vi.mock("./hardware-acceleration.js", () => ({
  createAmfFfmpegOverride: vi.fn(),
  resolveRenderAcceleration: vi.fn(async () => ({ mode: "cpu", reason: "test" })),
}));
vi.mock("./output-validation.js", () => ({ validateOutputFile: vi.fn(async () => undefined) }));
vi.mock("./composition.js", () => ({
  applyRequestedCompositionMetadata: vi.fn((composition) => composition),
}));
vi.mock("./version-render.js", () => ({ outputFileNameForVersion: vi.fn(() => "render.mp4") }));
vi.mock("./output-normalization.js", () => ({
  needsOutputNormalization: vi.fn(async () => false),
  normalizeOutputFile: vi.fn(async () => undefined),
}));
vi.mock("./source-proxy.js", () => ({
  prepareRangeProxy: vi.fn(async () => ({
    videoUrl: "http://renderer/output/source.mp4",
    videoStartSeconds: 0,
    standardBackgroundVideoUrl: "http://renderer/output/render-cache/background.mp4",
  })),
}));
vi.mock("./progress.js", () => ({ shouldLogRenderProgress: vi.fn(() => false) }));
vi.mock("./render-concurrency.js", () => ({
  resolveRenderConcurrency: vi.fn(() => 1),
  selectRenderConcurrency: vi.fn(() => 1),
}));

import { renderJobs } from "./server.js";
import {
  closeRenderBrowser,
  executeRender,
  setRenderBrowser,
} from "./render-worker.js";
import { prepareRangeProxy } from "./source-proxy.js";

describe("executeRender browser lifecycle", () => {
  beforeEach(() => {
    renderJobs.clear();
    mocks.selectComposition.mockClear();
    mocks.renderMedia.mockClear();
    vi.mocked(prepareRangeProxy).mockClear();
    delete process.env.RENDER_METRICS_URL;
    vi.unstubAllGlobals();
    setRenderBrowser(null);
  });

  it("reuses the shared browser for composition selection and media rendering", async () => {
    const browser = { close: vi.fn(async () => undefined) };
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.RENDER_METRICS_URL = "http://backend:8000/api/render-metrics";
    setRenderBrowser(browser as never);
    renderJobs.set("render-1", {
      renderId: "render-1",
      jobId: "job-1",
      clipIndex: 0,
      status: "queued",
      progress: 0,
    });

    await executeRender({
      renderId: "render-1",
      jobId: "job-1",
      clipIndex: 0,
      props: {
        videoUrl: "http://renderer/output/source.mp4",
        durationInFrames: 30,
        fps: 30,
        width: 1080,
        height: 1920,
        versionId: "version-1",
      } as never,
    });

    expect(mocks.selectComposition).toHaveBeenCalledWith(
      expect.objectContaining({ puppeteerInstance: browser }),
    );
    expect(mocks.renderMedia).toHaveBeenCalledWith(
      expect.objectContaining({ puppeteerInstance: browser }),
    );

    await closeRenderBrowser();
    expect(browser.close).toHaveBeenCalledWith({ silent: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend:8000/api/render-metrics",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"render_id":"render-1"'),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).acceleration_mode).toBe("cpu");
    delete process.env.RENDER_METRICS_URL;
    vi.unstubAllGlobals();
  });

  it("keeps a successful render successful when metrics persistence is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("backend unavailable");
    }));
    process.env.RENDER_METRICS_URL = "http://backend:8000/api/render-metrics";
    renderJobs.set("render-2", {
      renderId: "render-2",
      jobId: "job-2",
      clipIndex: 0,
      status: "queued",
      progress: 0,
    });

    await executeRender({
      renderId: "render-2",
      jobId: "job-2",
      clipIndex: 0,
      props: {
        videoUrl: "http://renderer/output/source.mp4",
        durationInFrames: 30,
        fps: 30,
        width: 1080,
        height: 1920,
        versionId: "version-2",
      } as never,
    });

    expect(renderJobs.get("render-2")?.status).toBe("done");
    delete process.env.RENDER_METRICS_URL;
    vi.unstubAllGlobals();
  });

  it("prepares a cached Standard background only for layouts that contain Standard", async () => {
    renderJobs.set("render-3", {
      renderId: "render-3",
      jobId: "job-3",
      clipIndex: 0,
      status: "queued",
      progress: 0,
    });

    await executeRender({
      renderId: "render-3",
      jobId: "job-3",
      clipIndex: 0,
      props: {
        videoUrl: "http://renderer/output/source.mp4",
        durationInFrames: 30,
        fps: 30,
        width: 1080,
        height: 1920,
        layout: {
          format: "streamer_stack",
          segments: [{ id: "standard-1", format: "standard", startMs: 0, endMs: 1000 }],
        },
        versionId: "version-3",
      } as never,
    });

    expect(prepareRangeProxy).toHaveBeenCalledWith(
      expect.objectContaining({ includeStandardBackground: true }),
    );
    expect(mocks.selectComposition).toHaveBeenCalledWith(
      expect.objectContaining({
        inputProps: expect.objectContaining({
          standardBackgroundVideoUrl: "http://renderer/output/render-cache/background.mp4",
        }),
      }),
    );
  });
});
