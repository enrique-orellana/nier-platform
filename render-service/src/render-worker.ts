import fs from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { selectComposition, renderMedia } from "@remotion/renderer";
import { getBundleLocation } from "./bundle.js";
import { renderJobs } from "./server.js";
import { buildRenderOptions } from "./master-policy.js";
import { loadMasterPolicy } from "./master-policy.js";
import {
  resolveRenderAcceleration,
  type RenderAcceleration,
} from "./hardware-acceleration.js";
import { validateOutputFile } from "./output-validation.js";
import { applyRequestedCompositionMetadata } from "./composition.js";
import { outputFileNameForVersion } from "./version-render.js";
import { needsOutputNormalization, normalizeOutputFile } from "./output-normalization.js";
import type { RenderRequestProps } from "./render-props.js";
import { prepareRangeProxy } from "./source-proxy.js";
import { shouldLogRenderProgress } from "./progress.js";
import { selectRenderConcurrency } from "./render-concurrency.js";
import {
  createRenderStageDurations,
  createRenderStageSummary,
  type RenderAccelerationMode,
  type RenderStageSummary,
  type RenderStageName,
} from "./render-metrics.js";

type RenderBrowser = NonNullable<
  Parameters<typeof selectComposition>[0]["puppeteerInstance"]
>;

let renderBrowser: RenderBrowser | null = null;

export function setRenderBrowser(browser: RenderBrowser | null): void {
  renderBrowser = browser;
}

export async function closeRenderBrowser(): Promise<void> {
  const browser = renderBrowser;
  renderBrowser = null;

  if (browser) {
    await browser.close({ silent: true });
  }
}

async function persistRenderMetrics(summary: RenderStageSummary): Promise<void> {
  const metricsUrl = process.env.RENDER_METRICS_URL?.trim();
  if (!metricsUrl) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  const payload = {
    render_id: summary.renderId,
    job_id: summary.jobId,
    version_id: summary.versionId,
    clip_index: summary.clipIndex,
    status: summary.status,
    error: summary.error,
    started_at: summary.startedAt,
    finished_at: summary.finishedAt,
    total_duration_ms: summary.totalDurationMs,
    stage_durations_ms: summary.stageDurationsMs,
    render_concurrency: summary.renderConcurrency,
    worker_count: summary.workerCount,
    output_bytes: summary.outputBytes,
    acceleration_mode: summary.accelerationMode,
  };
  try {
    const response = await fetch(metricsUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`metrics endpoint returned HTTP ${response.status}`);
    }
  } catch (err) {
    console.error(`[render-worker] Could not persist render metrics for ${summary.renderId}:`, err);
  } finally {
    clearTimeout(timeout);
  }
}

export interface RenderParams {
  renderId: string;
  jobId: string;
  clipIndex: number;
  props: RenderRequestProps;
}

let renderAccelerationPromise: Promise<RenderAcceleration> | null = null;

export function resetRenderAccelerationCache(): void {
  renderAccelerationPromise = null;
}

function getRenderAcceleration(): Promise<RenderAcceleration> {
  if (!renderAccelerationPromise) {
    renderAccelerationPromise = resolveRenderAcceleration();
  }
  return renderAccelerationPromise;
}

/**
 * Executes a Remotion render in the background.
 * Updates the in-memory render job map with progress and final status.
 */
export async function executeRender(params: RenderParams): Promise<void> {
  const { renderId, jobId, clipIndex, props } = params;
  const job = renderJobs.get(renderId);

  if (!job) {
    console.error(`[render-worker] Job ${renderId} not found in map`);
    return;
  }

  const renderStartedAt = performance.now();
  const renderStartedAtISO = new Date().toISOString();
  const stageDurationsMs = createRenderStageDurations();
  const workerCount = availableParallelism();
  let renderConcurrency = 0;
  let accelerationMode: RenderAccelerationMode = "cpu";
  let outputLocation = "";
  const measureStage = async <T>(
    stage: RenderStageName,
    operation: () => T | Promise<T>,
  ): Promise<T> => {
    const stageStartedAt = performance.now();
    try {
      return await operation();
    } finally {
      stageDurationsMs[stage] = Math.max(
        0,
        Math.round(performance.now() - stageStartedAt),
      );
    }
  };

  try {
    job.status = "rendering";
    job.progress = 0;

    console.log(
      `[render-worker] Starting render ${renderId} (job=${jobId}, clip=${clipIndex})`
    );

    const bundleLocation = await measureStage("bundle_prepare", () =>
      getBundleLocation(),
    );
    const policy = loadMasterPolicy();
    const renderProps = {
      ...props,
      ...(props.versionId
        ? {}
        : { width: policy.output_width, height: policy.output_height }),
    };

    const outputDir = process.env.OUTPUT_DIR
      ? path.resolve(process.env.OUTPUT_DIR)
      : path.resolve(import.meta.dirname, "../../output");
    const configuredConcurrency = Number.parseInt(
      process.env.RENDER_CONCURRENCY || "4",
      10,
    );
    renderConcurrency = selectRenderConcurrency({
      requested: configuredConcurrency,
      available: workerCount,
    });
    console.log(
      `[render-worker] ${renderId} render concurrency: ${renderConcurrency}/${workerCount}`,
    );

    const renderAcceleration = await getRenderAcceleration();
    accelerationMode = renderAcceleration.mode;
    console.log(
      `[render-worker] ${renderId} encoding mode: ${renderAcceleration.mode}` +
        (renderAcceleration.mode === "cpu"
          ? ` (${renderAcceleration.reason})`
          : ` (${renderAcceleration.vendor}/${renderAcceleration.encoder}, ${renderAcceleration.videoBitrate})`),
    );

    const sourceRange = await measureStage("source_prepare", () =>
      prepareRangeProxy({
        videoUrl: props.videoUrl,
        outputDir,
        serverPort: Number(process.env.PORT || 3100),
        jobId,
        startSeconds: props.videoStartSeconds || 0,
        durationSeconds: props.durationInFrames / props.fps,
      }),
    );
    renderProps.videoUrl = sourceRange.videoUrl;
    renderProps.videoStartSeconds = sourceRange.videoStartSeconds;

    // Select the composition with the provided input props
    const composition = await measureStage("composition_select", async () => {
      const selectedComposition = await selectComposition({
        serveUrl: bundleLocation,
        id: "ShortVideo",
        inputProps: renderProps,
        puppeteerInstance: renderBrowser ?? undefined,
      });
      return applyRequestedCompositionMetadata(selectedComposition, renderProps);
    });

    // Determine output directory and file path
    const jobOutputDir = path.join(outputDir, jobId);
    fs.mkdirSync(jobOutputDir, { recursive: true });

    const timestamp = Date.now();
    const outputFileName = outputFileNameForVersion(clipIndex, props.versionId, timestamp);
    outputLocation = path.join(jobOutputDir, outputFileName);

    console.log(`[render-worker] Output: ${outputLocation}`);

    // Render the video
    let lastLoggedPercent = -1;
    await measureStage("render_media", () =>
      renderMedia({
        composition,
        serveUrl: bundleLocation,
        puppeteerInstance: renderBrowser ?? undefined,
        ...buildRenderOptions(
          policy,
          renderProps.fps,
          renderAcceleration.mode === "gpu"
            ? renderAcceleration
            : undefined,
        ),
        concurrency: renderConcurrency,
        enforceAudioTrack: true,
        outputLocation,
        onProgress: ({ progress }) => {
          const percent = Math.round(progress * 100);
          job.progress = percent;

          if (shouldLogRenderProgress(percent, lastLoggedPercent)) {
            lastLoggedPercent = percent;
            console.log(`[render-worker] ${renderId} progress: ${percent}%`);
          }
        },
      }),
    );

    const outputExpectation = {
      width: renderProps.width,
      height: renderProps.height,
      fps: renderProps.fps,
      durationSeconds: renderProps.durationInFrames / renderProps.fps,
      requireAudio: true,
      toneMappedToSdr: true,
    };
    let wasNormalized = false;
    await measureStage("normalization", async () => {
      if (await needsOutputNormalization(outputLocation, outputExpectation, policy)) {
        await normalizeOutputFile(outputLocation, {
          fps: renderProps.fps,
          hasAudio: true,
          preserveVideo: renderAcceleration.mode === "gpu",
        });
        wasNormalized = true;
      }
    });

    await measureStage("validation", () =>
      validateOutputFile(outputLocation, outputExpectation, policy, {
        fullDecode: wasNormalized,
      }),
    );

    // Success
    job.status = "done";
    job.progress = 100;
    const relativeOutputPath = path.relative(outputDir, outputLocation).split(path.sep).join("/");
    job.outputUrl = `/output/${relativeOutputPath}`;

    console.log(`[render-worker] Render ${renderId} completed: ${outputLocation}`);
  } catch (err) {
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err);

    console.error(`[render-worker] Render ${renderId} failed:`, err);
  } finally {
    let outputBytes = 0;
    if (outputLocation && fs.existsSync(outputLocation)) {
      try {
        outputBytes = fs.statSync(outputLocation).size;
      } catch {
        outputBytes = 0;
      }
    }
    const summary = createRenderStageSummary({
      renderId,
      jobId,
      versionId: props.versionId,
      clipIndex,
      status: job.status === "done" ? "done" : "error",
      error: job.error,
      startedAt: renderStartedAtISO,
      finishedAt: new Date().toISOString(),
      totalDurationMs: Math.max(0, Math.round(performance.now() - renderStartedAt)),
      stageDurationsMs,
      renderConcurrency,
      workerCount,
      outputBytes,
      accelerationMode,
    });
    console.log(`[render-worker] render_summary ${JSON.stringify(summary)}`);
    await persistRenderMetrics(summary);
  }
}
