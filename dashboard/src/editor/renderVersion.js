import { getApiUrl } from "../config";

const jsonRequest = async (url, options = {}) => {
  const response = await fetch(getApiUrl(url), {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      payload.detail || payload.error || `Request failed (${response.status})`,
    );
  return payload;
};

export function normalizeRenderedOutputUrl(outputUrl, jobId) {
  if (!outputUrl || !jobId) return outputUrl;
  const normalized = String(outputUrl).replace(/\\/g, "/");
  if (normalized.startsWith("/videos/")) return normalized;
  const outputMatch = normalized.match(/(?:^|\/)output\/[^/]+\/([^/?#]+)$/);
  return outputMatch ? `/output/${jobId}/${outputMatch[1]}` : outputUrl;
}

const defaultApi = {
  createVersion: ({ jobId, clipIndex, manifest, parent_version_id }) =>
    jsonRequest(`/api/clip/${jobId}/${clipIndex}/versions`, {
      method: "POST",
      body: JSON.stringify({ manifest, parent_version_id }),
    }),
  startRender: ({ jobId, clipIndex, versionId }) =>
    jsonRequest(
      `/api/clip/${jobId}/${clipIndex}/versions/${versionId}/render`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  getRenderStatus: ({ renderId }) => jsonRequest(`/api/render/${renderId}`),
  completeVersion: ({ jobId, clipIndex, versionId, output_url, error }) =>
    jsonRequest(
      `/api/clip/${jobId}/${clipIndex}/versions/${versionId}/complete`,
      {
        method: "POST",
        body: JSON.stringify(error ? { error } : { output_url }),
      },
    ),
};

export async function createDraftVersion({
  api = defaultApi,
  jobId,
  clipIndex,
  manifest,
  parentVersionId,
}) {
  return api.createVersion({
    jobId,
    clipIndex,
    manifest,
    parent_version_id: parentVersionId,
  });
}

export async function saveDraftVersion({
  api = defaultApi,
  jobId,
  clipIndex,
  manifest,
  parentVersionId,
}) {
  const created = await createDraftVersion({
    api,
    jobId,
    clipIndex,
    manifest,
    parentVersionId,
  });
  const version = created?.version;
  const versionId = version?.version_id;
  if (!versionId) throw new Error("Version creation did not return an id.");
  return {
    status: "saved",
    versionId,
    version,
    manifest: created?.manifest,
    response: created,
  };
}

export async function renderDraftVersion({
  api = defaultApi,
  jobId,
  clipIndex,
  versionId,
  pollMs = 1200,
}) {
  const started = await api.startRender({ jobId, clipIndex, versionId });
  if (!started?.renderId) throw new Error("Render did not return an id.");
  let status;
  do {
    if (pollMs > 0) await new Promise((resolve) => setTimeout(resolve, pollMs));
    status = await api.getRenderStatus({ renderId: started.renderId });
    if (status.status === "error" || status.status === "failed")
      throw new Error(status.error || "Render failed.");
  } while (!["done", "completed"].includes(status.status));
  if (!status.outputUrl)
    throw new Error("Render completed without an output file.");
  return status;
}

export async function saveAndRenderVersion({
  api = defaultApi,
  jobId,
  clipIndex,
  manifest,
  parentVersionId,
  pollMs = 1200,
}) {
  let versionId;
  try {
    const created = await createDraftVersion({
      api,
      jobId,
      clipIndex,
      manifest,
      parentVersionId,
    });
    versionId = created?.version?.version_id;
    if (!versionId) throw new Error("Version creation did not return an id.");
    const rendered = await renderDraftVersion({
      api,
      jobId,
      clipIndex,
      versionId,
      pollMs,
    });
    const outputUrl = normalizeRenderedOutputUrl(rendered.outputUrl, jobId);
    const completed = await api.completeVersion({
      jobId,
      clipIndex,
      versionId,
      output_url: outputUrl,
    });
    return {
      status: "done",
      versionId,
      outputUrl,
      version: completed?.version,
      response: completed,
    };
  } catch (error) {
    if (versionId) {
      try {
        await api.completeVersion({
          jobId,
          clipIndex,
          versionId,
          error: error.message,
        });
      } catch {
        /* preserve original render error */
      }
    }
    return { status: "failed", versionId, error: error.message };
  }
}
