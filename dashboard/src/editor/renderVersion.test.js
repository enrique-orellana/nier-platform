import { describe, expect, it, vi } from "vitest";
import {
  normalizeRenderedOutputUrl,
  renderDraftVersion,
  saveDraftVersion,
  saveAndRenderVersion,
} from "./renderVersion";

describe("saveDraftVersion", () => {
  it("creates a saved child version without starting or completing a render", async () => {
    const api = {
      createVersion: vi.fn().mockResolvedValue({
        version: { version_id: "v4", status: "pending" },
        manifest: { version_id: "v4", layers: { hook: null } },
      }),
      startRender: vi.fn(),
      getRenderStatus: vi.fn(),
      completeVersion: vi.fn(),
    };

    const result = await saveDraftVersion({
      api,
      jobId: "job",
      clipIndex: 0,
      manifest: { layers: { hook: null } },
      parentVersionId: "v3",
    });

    expect(result).toMatchObject({
      status: "saved",
      versionId: "v4",
      version: { version_id: "v4", status: "pending" },
    });
    expect(api.createVersion).toHaveBeenCalledWith(
      expect.objectContaining({ parent_version_id: "v3" }),
    );
    expect(api.startRender).not.toHaveBeenCalled();
    expect(api.getRenderStatus).not.toHaveBeenCalled();
    expect(api.completeVersion).not.toHaveBeenCalled();
  });
});

describe("saveAndRenderVersion", () => {
  it("updates and renders the selected version without creating a child", async () => {
    const api = {
      updateVersion: vi.fn().mockResolvedValue({
        version: { version_id: "v3", status: "pending" },
      }),
      createVersion: vi.fn(),
      startRender: vi.fn().mockResolvedValue({ renderId: "r1" }),
      getRenderStatus: vi
        .fn()
        .mockResolvedValue({ status: "done", outputUrl: "/videos/job/v3.mp4" }),
      completeVersion: vi
        .fn()
        .mockResolvedValue({ version: { version_id: "v3", status: "done" } }),
    };

    const result = await saveAndRenderVersion({
      api,
      jobId: "job",
      clipIndex: 0,
      versionId: "v3",
      manifest: { layers: { hook: { text: "edited" } } },
      pollMs: 0,
    });

    expect(api.updateVersion).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: "v3" }),
    );
    expect(api.createVersion).not.toHaveBeenCalled();
    expect(api.startRender).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: "v3" }),
    );
    expect(result.versionId).toBe("v3");
  });

  it("recovers a version left rendering before retrying its export", async () => {
    const api = {
      updateVersion: vi
        .fn()
        .mockRejectedValueOnce(new Error("version is currently rendering"))
        .mockResolvedValueOnce({
          version: { version_id: "v3", status: "pending" },
        }),
      createVersion: vi.fn(),
      startRender: vi.fn().mockResolvedValue({ renderId: "r1" }),
      getRenderStatus: vi
        .fn()
        .mockResolvedValue({ status: "done", outputUrl: "/videos/job/v3.mp4" }),
      completeVersion: vi
        .fn()
        .mockResolvedValue({ version: { version_id: "v3", status: "failed" } }),
    };

    const result = await saveAndRenderVersion({
      api,
      jobId: "job",
      clipIndex: 0,
      versionId: "v3",
      manifest: { layers: {} },
      pollMs: 0,
    });

    expect(api.completeVersion).toHaveBeenCalledWith({
      jobId: "job",
      clipIndex: 0,
      versionId: "v3",
      error: "Recovered stale render state before retrying.",
    });
    expect(api.updateVersion).toHaveBeenCalledTimes(2);
    expect(api.startRender).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: "v3" }),
    );
    expect(result.status).toBe("done");
  });

  it("does not report 100 percent until rendering is complete", async () => {
    const api = {
      startRender: vi.fn().mockResolvedValue({ renderId: "r1" }),
      getRenderStatus: vi
        .fn()
        .mockResolvedValueOnce({ status: "rendering", progress: 100 })
        .mockResolvedValueOnce({
          status: "done",
          progress: 100,
          outputUrl: "/videos/job/v4.mp4",
        }),
    };
    const progress = [];

    await renderDraftVersion({
      api,
      jobId: "job",
      clipIndex: 0,
      versionId: "v4",
      pollMs: 0,
      onProgress: (value) => progress.push(value),
    });

    expect(progress).toEqual([0.99, 1]);
  });

  it("normalizes renderer filesystem output paths to the renderer output route", () => {
    expect(
      normalizeRenderedOutputUrl("/output/job/master_0_v4_123.mp4", "job"),
    ).toBe("/output/job/master_0_v4_123.mp4");
    expect(
      normalizeRenderedOutputUrl("/videos/job/master_0_v4_123.mp4", "job"),
    ).toBe("/videos/job/master_0_v4_123.mp4");
  });

  it("creates, renders, polls, and completes an immutable child version", async () => {
    const api = {
      createVersion: vi
        .fn()
        .mockResolvedValue({ version: { version_id: "v4" } }),
      startRender: vi.fn().mockResolvedValue({ renderId: "r1" }),
      getRenderStatus: vi
        .fn()
        .mockResolvedValue({ status: "done", outputUrl: "/videos/job/v4.mp4" }),
      completeVersion: vi
        .fn()
        .mockResolvedValue({ version: { version_id: "v4", status: "done" } }),
    };
    const result = await saveAndRenderVersion({
      api,
      jobId: "job",
      clipIndex: 0,
      manifest: { layers: {} },
      parentVersionId: "v3",
      props: { fps: 30 },
      pollMs: 0,
    });
    expect(api.createVersion).toHaveBeenCalledWith(
      expect.objectContaining({ parent_version_id: "v3" }),
    );
    expect(api.startRender).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: "v4" }),
    );
    expect(api.startRender.mock.calls[0][0]).not.toHaveProperty("props");
    expect(api.completeVersion).toHaveBeenCalledWith(
      expect.objectContaining({ output_url: "/videos/job/v4.mp4" }),
    );
    expect(result.status).toBe("done");
  });

  it("marks a failed render without promoting the current output", async () => {
    const api = {
      createVersion: vi
        .fn()
        .mockResolvedValue({ version: { version_id: "v4" } }),
      startRender: vi.fn().mockResolvedValue({ renderId: "r1" }),
      getRenderStatus: vi
        .fn()
        .mockResolvedValue({ status: "error", error: "duration mismatch" }),
      completeVersion: vi
        .fn()
        .mockResolvedValue({ version: { version_id: "v4", status: "failed" } }),
      promote: vi.fn(),
    };
    const result = await saveAndRenderVersion({
      api,
      jobId: "job",
      clipIndex: 0,
      manifest: {},
      parentVersionId: "v3",
      props: {},
      pollMs: 0,
    });
    expect(result.status).toBe("failed");
    expect(api.completeVersion).toHaveBeenCalledWith(
      expect.objectContaining({ error: "duration mismatch" }),
    );
    expect(api.promote).not.toHaveBeenCalled();
  });
});
