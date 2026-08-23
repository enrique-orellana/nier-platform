export const RENDER_STAGE_NAMES = [
  "bundle_prepare",
  "source_prepare",
  "composition_select",
  "render_media",
  "normalization",
  "validation",
] as const;

export type RenderStageName = (typeof RENDER_STAGE_NAMES)[number];
export type RenderStageDurations = Record<RenderStageName, number>;
export type RenderAccelerationMode = "cpu" | "gpu";

export interface RenderStageSummary {
  renderId: string;
  jobId: string;
  versionId?: string;
  clipIndex: number;
  status: "done" | "error";
  error?: string;
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  stageDurationsMs: RenderStageDurations;
  renderConcurrency: number;
  workerCount: number;
  outputBytes: number;
  accelerationMode: RenderAccelerationMode;
}

export function createRenderStageDurations(
  durations: Partial<RenderStageDurations> = {},
): RenderStageDurations {
  return Object.fromEntries(
    RENDER_STAGE_NAMES.map((stage) => [stage, durations[stage] ?? 0]),
  ) as RenderStageDurations;
}

export function createRenderStageSummary(params: {
  renderId: string;
  jobId: string;
  versionId?: string;
  clipIndex: number;
  status: RenderStageSummary["status"];
  error?: string;
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  stageDurationsMs?: Partial<RenderStageDurations>;
  renderConcurrency: number;
  workerCount: number;
  outputBytes: number;
  accelerationMode: RenderAccelerationMode;
}): RenderStageSummary {
  return {
    renderId: params.renderId,
    jobId: params.jobId,
    ...(params.versionId ? { versionId: params.versionId } : {}),
    clipIndex: params.clipIndex,
    status: params.status,
    ...(params.error ? { error: params.error } : {}),
    startedAt: params.startedAt,
    finishedAt: params.finishedAt,
    totalDurationMs: params.totalDurationMs,
    stageDurationsMs: createRenderStageDurations(params.stageDurationsMs),
    renderConcurrency: params.renderConcurrency,
    workerCount: params.workerCount,
    outputBytes: params.outputBytes,
    accelerationMode: params.accelerationMode,
  };
}
