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

export interface RenderParams {
  renderId: string;
  jobId: string;
  clipIndex: number;
  props: {
    videoUrl: string;
    durationInFrames: number;
    fps: number;
    width: number;
    height: number;
    subtitles: unknown;
    hook: unknown;
    effects: unknown;
    versionId?: string;
    manifestPath?: string;
    manifestRevision?: string;
  };
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

    // Select the composition with the provided input props
    const selectedComposition = await selectComposition({
      serveUrl: bundleLocation,
      id: "ShortVideo",
      inputProps: props,
    });
    const composition = applyRequestedCompositionMetadata(selectedComposition, props);

    // Determine output directory and file path
    const outputDir = process.env.OUTPUT_DIR
      ? path.resolve(process.env.OUTPUT_DIR)
      : path.resolve(import.meta.dirname, "../../output");

    const jobOutputDir = path.join(outputDir, jobId);
    fs.mkdirSync(jobOutputDir, { recursive: true });

    const timestamp = Date.now();
    const outputFileName = outputFileNameForVersion(clipIndex, props.versionId, timestamp);
    const outputLocation = path.join(jobOutputDir, outputFileName);

    console.log(`[render-worker] Output: ${outputLocation}`);

    // Render the video
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      ...buildRenderOptions(),
      outputLocation,
      onProgress: ({ progress }) => {
        const percent = Math.round(progress * 100);
        job.progress = percent;

        if (percent % 10 === 0) {
          console.log(`[render-worker] ${renderId} progress: ${percent}%`);
        }
      },
    });

    await validateOutputFile(
      outputLocation,
      {
        width: props.width,
        height: props.height,
        fps: props.fps,
        durationSeconds: props.durationInFrames / props.fps,
        requireAudio: false,
        toneMappedToSdr: false,
      },
      loadMasterPolicy(),
    );

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
