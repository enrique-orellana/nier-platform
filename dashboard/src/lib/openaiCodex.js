export const normalizeCodexStatus = (status = {}) => ({
  connected: status.connected === true,
  pending: status.pending === true,
  requiresReconnect: status.requiresReconnect === true,
});

export const codexStatusLabel = ({ connected, pending, requiresReconnect }) => {
  if (pending) return 'Connecting...';
  if (requiresReconnect) return 'Reconnect ChatGPT';
  if (connected) return 'Connected to ChatGPT';
  return 'Not connected';
};
