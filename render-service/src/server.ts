import express from "express";
import { v4 as uuidv4 } from "uuid";
import { openBrowser } from "@remotion/renderer";
import { initBundle } from "./bundle.js";
import { closeRenderBrowser, executeRender, setRenderBrowser } from "./render-worker.js";
import { buildRenderProps } from "./render-props.js";
import type { RenderRequestProps } from "./render-props.js";
import { renderRequestSchema } from "./render-request.js";
import { manifestToVersionRenderProps } from "./version-manifest.js";
import { RenderQueue } from "./render-queue.js";
import { getRenderBrowserOptions } from "./chromium-options.js";

// --- Render status types ---

export type RenderStatus = "queued" | "rendering" | "done" | "error";

export interface RenderJob {
  renderId: string;
  jobId: string;
  clipIndex: number;
  status: RenderStatus;
  progress: number;
  outputUrl?: string;
  error?: string;
}

// In-memory render job map
export const renderJobs = new Map<string, RenderJob>();

// --- Express app ---

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = parseInt(process.env.PORT || "3100", 10);
const OUTPUT_DIR = process.env.OUTPUT_DIR || "/output";
const RENDER_MAX_CONCURRENCY = Math.max(1, parseInt(process.env.RENDER_MAX_CONCURRENCY || "1", 10));
const renderQueue = new RenderQueue(RENDER_MAX_CONCURRENCY);
let httpServer: ReturnType<typeof app.listen> | null = null;
let isShuttingDown = false;

// Serve video files from the shared output volume so Remotion can access them via HTTP.
// The Remotion bundle runs from a different origin (localhost:3000), so media
// requests must explicitly allow cross-origin reads. Without this, @remotion/media
// falls back to its frame proxy and Chromium can terminate the compositor when the
// proxy cannot decode the source.
app.use(
  "/output",
  (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }

    next();
  },
  express.static(OUTPUT_DIR),
);

// Health check
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Submit a render job
app.post("/render", (req, res) => {
  const parsed = renderRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.issues,
    });
    return;
  }

  const { jobId, clipIndex } = parsed.data;
  const props: RenderRequestProps =
    "manifest" in parsed.data
      ? manifestToVersionRenderProps(parsed.data.manifest, {
          versionId: parsed.data.versionId,
          manifestRevision: parsed.data.manifestRevision,
        })
      : parsed.data.props;
  const renderId = uuidv4();

  const job: RenderJob = {
    renderId,
    jobId,
    clipIndex,
    status: "queued",
    progress: 0,
  };

  renderJobs.set(renderId, job);

  console.log(
    `[render] Queued render ${renderId} for job=${jobId} clip=${clipIndex}`
  );

  // Resolve video URL: convert frontend/backend URLs to renderer's own static server
  // The renderer serves /output/* from the shared Docker volume
  let resolvedVideoUrl = props.videoUrl;
  const videoPathMatch = props.videoUrl.match(/\/videos\/([^/]+)\/(.+)$/);
  if (videoPathMatch) {
    resolvedVideoUrl = `http://localhost:${PORT}/output/${videoPathMatch[1]}/${videoPathMatch[2]}`;
    console.log(`[render] Resolved video URL: ${props.videoUrl} -> ${resolvedVideoUrl}`);
  }

  // Queue renders so one CPU-heavy job cannot starve every other request.
  renderQueue.add(() => executeRender({
    renderId,
    jobId,
    clipIndex,
      props: buildRenderProps(props, resolvedVideoUrl),
  }).catch((err) => {
    console.error(`[render] Unhandled error for ${renderId}:`, err);
    const existingJob = renderJobs.get(renderId);
    if (existingJob) {
      existingJob.status = "error";
      existingJob.error =
        err instanceof Error ? err.message : "Unknown error";
    }
  }));

  res.status(202).json({ renderId, status: "queued" });
});

// Get render status
app.get("/render/:renderId", (req, res) => {
  const { renderId } = req.params;
  const job = renderJobs.get(renderId);

  if (!job) {
    res.status(404).json({ error: "Render not found" });
    return;
  }

  const response: Record<string, unknown> = {
    renderId: job.renderId,
    status: job.status,
  };

  if (job.progress !== undefined) {
    response.progress = job.progress;
  }
  if (job.outputUrl) {
    response.outputUrl = job.outputUrl;
  }
  if (job.error) {
    response.error = job.error;
  }

  res.json(response);
});

// --- Start server ---

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[render-service] Received ${signal}; waiting for queued renders.`);

  await renderQueue.onIdle();
  await closeRenderBrowser();

  if (httpServer) {
    await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
  }
}

process.once("SIGTERM", () => {
  void shutdown("SIGTERM").finally(() => process.exit(0));
});
process.once("SIGINT", () => {
  void shutdown("SIGINT").finally(() => process.exit(0));
});

async function main() {
  console.log("[render-service] Initializing Remotion bundle...");
  await initBundle();
  console.log("[render-service] Bundle ready.");

  console.log("[render-service] Opening reusable Remotion browser...");
  const { chromeMode, chromiumOptions } = getRenderBrowserOptions();
  console.log(
    `[render-service] Chromium mode: ${chromeMode}; GL backend: ${chromiumOptions.gl ?? "default"}`,
  );
  setRenderBrowser(await openBrowser("chrome", { chromeMode, chromiumOptions }));
  console.log("[render-service] Reusable Remotion browser ready.");

  httpServer = app.listen(PORT, () => {
    console.log(`[render-service] Listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error("[render-service] Fatal error during startup:", err);
  process.exit(1);
});
