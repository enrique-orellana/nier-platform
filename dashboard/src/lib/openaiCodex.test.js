import { describe, expect, it } from 'vitest';

import { codexStatusLabel, normalizeCodexStatus } from './openaiCodex';


describe('OpenAI Codex helpers', () => {
  it('maps connected status without exposing credential fields', () => {
    expect(normalizeCodexStatus({ connected: true, pending: false })).toEqual({
      connected: true,
      pending: false,
      requiresReconnect: false,
    });
  });

  it('labels pending, reconnect, connected, and disconnected states', () => {
    expect(codexStatusLabel({ pending: true })).toBe('Connecting...');
    expect(codexStatusLabel({ requiresReconnect: true })).toBe('Reconnect ChatGPT');
    expect(codexStatusLabel({ connected: true })).toBe('Connected to ChatGPT');
    expect(codexStatusLabel({})).toBe('Not connected');
  });
});
