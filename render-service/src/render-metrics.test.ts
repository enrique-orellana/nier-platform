import { describe, expect, it } from "vitest";
import {
  createRenderStageDurations,
  createRenderStageSummary,
} from "./render-metrics.js";

describe("render stage metrics", () => {
  it("creates a complete structured summary with every render stage", () => {
    const summary = createRenderStageSummary({
      renderId: "render-1",
      jobId: "job-1",
      versionId: "version-1",
      clipIndex: 3,
      status: "done",
      startedAt: "2026-08-23T10:00:00.000Z",
      finishedAt: "2026-08-23T10:00:01.234Z",
      totalDurationMs: 1234,
      stageDurationsMs: {
        ...createRenderStageDurations(),
        bundle_prepare: 10,
        source_prepare: 20,
        composition_select: 30,
        render_media: 1000,
        normalization: 40,
        validation: 50,
      },
      renderConcurrency: 4,
      workerCount: 12,
      outputBytes: 1234,
      accelerationMode: "gpu",
    });

    expect(summary).toEqual({
      renderId: "render-1",
      jobId: "job-1",
      versionId: "version-1",
      clipIndex: 3,
      status: "done",
      startedAt: "2026-08-23T10:00:00.000Z",
      finishedAt: "2026-08-23T10:00:01.234Z",
      totalDurationMs: 1234,
      stageDurationsMs: {
        bundle_prepare: 10,
        source_prepare: 20,
        composition_select: 30,
        render_media: 1000,
        normalization: 40,
        validation: 50,
      },
      renderConcurrency: 4,
      workerCount: 12,
      outputBytes: 1234,
      accelerationMode: "gpu",
    });
  });

  it("fills omitted stage durations with zero", () => {
    expect(
      createRenderStageSummary({
        renderId: "render-2",
        jobId: "job-2",
        clipIndex: 0,
        status: "error",
        startedAt: "2026-08-23T10:00:00.000Z",
        finishedAt: "2026-08-23T10:00:00.012Z",
        totalDurationMs: 12,
        stageDurationsMs: { render_media: 12 },
        renderConcurrency: 0,
        workerCount: 0,
        outputBytes: 0,
        accelerationMode: "cpu",
      }),
    ).toEqual({
      renderId: "render-2",
      jobId: "job-2",
      clipIndex: 0,
      status: "error",
      startedAt: "2026-08-23T10:00:00.000Z",
      finishedAt: "2026-08-23T10:00:00.012Z",
      totalDurationMs: 12,
      stageDurationsMs: {
        bundle_prepare: 0,
        source_prepare: 0,
        composition_select: 0,
        render_media: 12,
        normalization: 0,
        validation: 0,
      },
      renderConcurrency: 0,
      workerCount: 0,
      outputBytes: 0,
      accelerationMode: "cpu",
    });
  });
});
