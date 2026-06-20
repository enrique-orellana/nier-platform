export const buildVisibleProviders = () => (
  ['gemini', 'lmstudio']
);

export const pickProviderAfterDiscoveryFailure = ({ currentProvider }) => {
  return currentProvider;
};
