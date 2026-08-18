export const normalizeCodexStatus = (status = {}) => ({
  connected: status.connected === true,
  pending: status.pending === true,
  requiresReconnect: status.requiresReconnect === true,
});

export const codexPollState = (status = {}) => {
  if (status.status === "expired" || status.status === "error") {
    return { connected: false, pending: false, requiresReconnect: true };
  }
  if (
    status.status === "connected" ||
    status.connected === true ||
    status.pending === false
  ) {
    return normalizeCodexStatus(status);
  }
  return null;
};

export const normalizeCodexModels = (payload = {}) => {
  const seen = new Set();
  const formatEffortLabel = (effort) =>
    ({
      xhigh: "Extra High",
      max: "Max",
      ultra: "Ultra",
    })[effort] || effort.charAt(0).toUpperCase() + effort.slice(1);
  const normalizeEfforts = (model) => {
    const rawEfforts =
      model?.supported_reasoning_levels ||
      model?.supportedReasoningLevels ||
      model?.supported_reasoning_efforts ||
      model?.supportedReasoningEfforts ||
      model?.reasoning_efforts ||
      model?.efforts ||
      [];
    if (!Array.isArray(rawEfforts)) return [];
    const effortIds = new Set();
    return rawEfforts
      .map((rawEffort) => {
        const effort =
          typeof rawEffort === "string"
            ? rawEffort
            : rawEffort?.effort ||
              rawEffort?.reasoning_effort ||
              rawEffort?.reasoningEffort ||
              rawEffort?.id ||
              rawEffort?.value ||
              rawEffort?.name;
        const id = String(effort || "")
          .trim()
          .toLowerCase();
        if (!id || effortIds.has(id)) return null;
        effortIds.add(id);
        return {
          id,
          label: String(
            rawEffort?.label ||
              rawEffort?.title ||
              rawEffort?.displayName ||
              formatEffortLabel(id),
          ).trim(),
          description: String(
            rawEffort?.description || rawEffort?.details || "",
          ).trim(),
        };
      })
      .filter(Boolean);
  };
  const models = (Array.isArray(payload.models) ? payload.models : [])
    .map((model) => {
      const id = String(
        model?.id || model?.slug || model?.model || model?.name || "",
      ).trim();
      if (!id || seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        label:
          String(
            model?.label ||
              model?.title ||
              model?.displayName ||
              model?.display_name ||
              id,
          ).trim() || id,
        supportsVision:
          model?.supportsVision === true || model?.supports_vision === true,
        efforts: normalizeEfforts(model),
        defaultEffort: String(
          model?.defaultEffort ||
            model?.default_effort ||
            model?.defaultReasoningEffort ||
            model?.default_reasoning_level ||
            "",
        )
          .trim()
          .toLowerCase(),
      };
    })
    .filter(Boolean);

  const requestedDefault = String(
    payload.defaultModel || payload.default_model || "",
  ).trim();
  return {
    models,
    defaultModel: models.some((model) => model.id === requestedDefault)
      ? requestedDefault
      : "",
  };
};

export const pickCodexModel = ({ currentModel, models = [] }) => {
  const normalized = String(currentModel || "").trim();
  if (!normalized || normalized === "auto" || normalized === "default")
    return "auto";
  return models.some((model) => model.id === normalized) ? normalized : "auto";
};

export const pickCodexEffort = ({ currentEffort, modelId, models = [] }) => {
  const normalized = String(currentEffort || "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized === "auto" || normalized === "default")
    return "auto";
  const model = models.find((entry) => entry.id === modelId);
  if (!model || !Array.isArray(model.efforts) || model.efforts.length === 0)
    return "auto";
  return model.efforts.some((effort) => effort.id === normalized)
    ? normalized
    : "auto";
};

export const codexStatusLabel = ({ connected, pending, requiresReconnect }) => {
  if (pending) return "Connecting...";
  if (requiresReconnect) return "Reconnect ChatGPT";
  if (connected) return "Connected to ChatGPT";
  return "Not connected";
};
