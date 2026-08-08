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

export const codexStatusLabel = ({ connected, pending, requiresReconnect }) => {
  if (pending) return 'Connecting...';
  if (requiresReconnect) return 'Reconnect ChatGPT';
  if (connected) return 'Connected to ChatGPT';
  return 'Not connected';
};
