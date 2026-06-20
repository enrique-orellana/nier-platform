export const buildVisibleProviders = () => (
  ['gemini', 'lmstudio']
);

export const pickProviderAfterDiscoveryFailure = ({ currentProvider }) => {
  return currentProvider;
};

export const pickLmStudioModel = ({ currentModel, models }) => {
  const available = Array.isArray(models)
    ? models
      .map((model) => (model?.id || '').trim())
      .filter(Boolean)
    : [];

  if (available.length === 0) return '';

  const cleaned = (currentModel || '').trim();
  if (!cleaned || ['auto', 'default'].includes(cleaned.toLowerCase())) {
    return available[0];
  }

  if (available.includes(cleaned)) {
    return cleaned;
  }

  return available[0];
};
