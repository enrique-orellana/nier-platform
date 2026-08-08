export const normalizeCodexStatus = (status = {}) => ({
  connected: status.connected === true,
  pending: status.pending === true,
  requiresReconnect: status.requiresReconnect === true,
});

export const codexPollState = (status = {}) => {
  if (status.status === 'expired' || status.status === 'error') {
    return { connected: false, pending: false, requiresReconnect: true };
  }
  if (status.status === 'connected' || status.connected === true || status.pending === false) {
    return normalizeCodexStatus(status);
  }
  return null;
};

export const normalizeCodexModels = (payload = {}) => {
  const seen = new Set();
  const models = (Array.isArray(payload.models) ? payload.models : [])
    .map((model) => {
      const id = String(model?.id || model?.slug || model?.model || model?.name || '').trim();
      if (!id || seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        label: String(model?.label || model?.title || model?.displayName || model?.display_name || id).trim() || id,
        supportsVision: model?.supportsVision === true || model?.supports_vision === true,
      };
    })
    .filter(Boolean);

  const requestedDefault = String(payload.defaultModel || payload.default_model || '').trim();
  return {
    models,
    defaultModel: models.some((model) => model.id === requestedDefault) ? requestedDefault : '',
  };
};

export const pickCodexModel = ({ currentModel, models = [] }) => {
  const normalized = String(currentModel || '').trim();
  if (!normalized || normalized === 'auto' || normalized === 'default') return 'auto';
  return models.some((model) => model.id === normalized) ? normalized : 'auto';
};

export const codexStatusLabel = ({ connected, pending, requiresReconnect }) => {
  if (pending) return 'Connecting...';
  if (requiresReconnect) return 'Reconnect ChatGPT';
  if (connected) return 'Connected to ChatGPT';
  return 'Not connected';
};
