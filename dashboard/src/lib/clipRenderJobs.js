const ACTIVE_CLIP_RENDER_STATUSES = new Set([
  "queued",
  "processing",
  "rendering",
]);

export function activeClipRenderJobs(clipRenders = []) {
  return Object.fromEntries(
    clipRenders
      .filter((render) => ACTIVE_CLIP_RENDER_STATUSES.has(render?.status))
      .filter(
        (render) => render?.job_id && Number.isInteger(render?.clip_index),
      )
      .map((render) => [String(render.clip_index), render.job_id]),
  );
}
