import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectComposition: vi.fn(async () => ({ width: 1080, height: 1920 })),
  renderMedia: vi.fn(async () => undefined),
  buildRenderOptions: vi.fn((_policy, _fps, hardware) => hardware ?? {}),
  renderAcceleration: { mode: "cpu", reason: "test" } as unknown,
}));

vi.mock("@remotion/renderer", () => mocks);
vi.mock("./server.js", () => ({ renderJobs: new Map() }));
vi.mock("./bundle.js", () => ({ getBundleLocation: vi.fn(() => "bundle") }));
vi.mock("./master-policy.js", () => ({
  buildRenderOptions: mocks.buildRenderOptions,
  loadMasterPolicy: vi.fn(() => ({ output_width: 1080, output_height: 1920 })),
}));
vi.mock("./hardware-acceleration.js", () => ({
  resolveRenderAcceleration: vi.fn(async () => mocks.renderAcceleration),
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
  })),
}));
vi.mock("./progress.js", () => ({ shouldLogRenderProgress: vi.fn(() => false) }));
vi.mock("./render-concurrency.js", () => ({
  selectRenderConcurrency: vi.fn(() => 1),
}));

import { renderJobs } from "./server.js";
import {
  closeRenderBrowser,
  executeRender,
  resetRenderAccelerationCache,
  setRenderBrowser,
} from "./render-worker.js";

describe("executeRender browser lifecycle", () => {
  beforeEach(() => {
    renderJobs.clear();
    mocks.selectComposition.mockClear();
    mocks.renderMedia.mockClear();
    mocks.buildRenderOptions.mockClear();
    mocks.renderAcceleration = { mode: "cpu", reason: "test" };
    resetRenderAccelerationCache();
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

  it("passes a selected NVIDIA adapter to Remotion and reports GPU metrics", async () => {
    const override = vi.fn(({ args }: { args: string[] }) => args);
    mocks.renderAcceleration = {
      mode: "gpu",
      vendor: "nvidia",
      encoder: "h264_nvenc",
      hardwareAcceleration: "required",
      videoBitrate: "20M",
      binariesDirectory: "/usr/bin",
      ffmpegOverride: override,
    };
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.RENDER_METRICS_URL = "http://backend:8000/api/render-metrics";
    renderJobs.set("render-gpu", {
      renderId: "render-gpu",
      jobId: "job-gpu",
      clipIndex: 0,
      status: "queued",
      progress: 0,
    });

    await executeRender({
      renderId: "render-gpu",
      jobId: "job-gpu",
      clipIndex: 0,
      props: {
        videoUrl: "http://renderer/output/source.mp4",
        durationInFrames: 30,
        fps: 30,
        width: 1080,
        height: 1920,
        versionId: "version-gpu",
      } as never,
    });

    expect(mocks.buildRenderOptions).toHaveBeenCalledWith(
      expect.anything(),
      30,
      expect.objectContaining({
        vendor: "nvidia",
        encoder: "h264_nvenc",
        videoBitrate: "20M",
        ffmpegOverride: override,
      }),
    );
    expect(mocks.renderMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        hardwareAcceleration: "required",
        videoBitrate: "20M",
        ffmpegOverride: override,
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).acceleration_mode).toBe("gpu");
    delete process.env.RENDER_METRICS_URL;
    vi.unstubAllGlobals();
  });
});
