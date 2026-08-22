import fs from "node:fs";
import path from "node:path";
import { selectComposition, renderMedia } from "@remotion/renderer";
import { getBundleLocation } from "./bundle.js";
import { renderJobs } from "./server.js";
import { buildRenderOptions } from "./master-policy.js";
import { loadMasterPolicy } from "./master-policy.js";
import { validateOutputFile } from "./output-validation.js";
import { applyRequestedCompositionMetadata } from "./composition.js";
import { outputFileNameForVersion } from "./version-render.js";
import { needsOutputNormalization, normalizeOutputFile } from "./output-normalization.js";
import type { RenderRequestProps } from "./render-props.js";
import { prepareRangeProxy } from "./source-proxy.js";
import { shouldLogRenderProgress } from "./progress.js";

export interface RenderParams {
  renderId: string;
  jobId: string;
  clipIndex: number;
  props: RenderRequestProps;
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

  try {
    job.status = "rendering";
    job.progress = 0;

    console.log(
      `[render-worker] Starting render ${renderId} (job=${jobId}, clip=${clipIndex})`
    );

    const bundleLocation = getBundleLocation();
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
    const sourceRange = await prepareRangeProxy({
      videoUrl: props.videoUrl,
      outputDir,
      serverPort: Number(process.env.PORT || 3100),
      jobId,
      startSeconds: props.videoStartSeconds || 0,
      durationSeconds: props.durationInFrames / props.fps,
    });
    renderProps.videoUrl = sourceRange.videoUrl;
    renderProps.videoStartSeconds = sourceRange.videoStartSeconds;

    // Select the composition with the provided input props
    const selectedComposition = await selectComposition({
      serveUrl: bundleLocation,
      id: "ShortVideo",
      inputProps: renderProps,
    });
    const composition = applyRequestedCompositionMetadata(selectedComposition, renderProps);

    // Determine output directory and file path
    const jobOutputDir = path.join(outputDir, jobId);
    fs.mkdirSync(jobOutputDir, { recursive: true });

    const timestamp = Date.now();
    const outputFileName = outputFileNameForVersion(clipIndex, props.versionId, timestamp);
    const outputLocation = path.join(jobOutputDir, outputFileName);

    console.log(`[render-worker] Output: ${outputLocation}`);

    // Render the video
    let lastLoggedPercent = -1;
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      ...buildRenderOptions(policy, renderProps.fps),
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
    });

    const outputExpectation = {
      width: renderProps.width,
      height: renderProps.height,
      fps: renderProps.fps,
      durationSeconds: renderProps.durationInFrames / renderProps.fps,
      requireAudio: true,
      toneMappedToSdr: true,
    };
    if (await needsOutputNormalization(outputLocation, outputExpectation, policy)) {
      await normalizeOutputFile(outputLocation, { fps: renderProps.fps, hasAudio: true });
    }

    await validateOutputFile(outputLocation, outputExpectation, policy);

    // Success
    job.status = "done";
    job.progress = 100;
    job.outputUrl = outputLocation;

    console.log(`[render-worker] Render ${renderId} completed: ${outputLocation}`);
  } catch (err) {
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err);

    console.error(`[render-worker] Render ${renderId} failed:`, err);
  }
}
