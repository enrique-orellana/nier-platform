export const buildVisibleProviders = ({ lmStudioAvailable }) => (
  lmStudioAvailable ? ['gemini', 'ollama', 'lmstudio'] : ['gemini', 'ollama']
);

export const pickProviderAfterDiscoveryFailure = ({ currentProvider, ollamaBaseUrl }) => {
  if (currentProvider !== 'lmstudio') return currentProvider;
  return (ollamaBaseUrl || '').trim() ? 'ollama' : 'gemini';
};
