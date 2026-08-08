import { describe, expect, it } from 'vitest';

import {
  codexPollState,
  codexStatusLabel,
  normalizeCodexModels,
  normalizeCodexStatus,
  pickCodexModel,
} from './openaiCodex';


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

  it('clears a poll when the backend reports that no authorization is pending', () => {
    expect(codexPollState({ connected: false, pending: false })).toEqual({
      connected: false,
      pending: false,
      requiresReconnect: false,
    });
  });

  it('requires reconnect after a terminal poll error', () => {
    expect(codexPollState({ status: 'expired', connected: false, pending: false })).toEqual({
      connected: false,
      pending: false,
      requiresReconnect: true,
    });
  });

  it('normalizes the account model catalog and removes duplicate or invalid entries', () => {
    expect(normalizeCodexModels({
      models: [
        { slug: 'gpt-5.4', title: 'GPT-5.4', supportsVision: true },
        { id: 'gpt-5.4', label: 'Duplicate' },
        { title: 'Missing id' },
      ],
      defaultModel: 'gpt-5.4',
    })).toEqual({
      models: [{ id: 'gpt-5.4', label: 'GPT-5.4', supportsVision: true }],
      defaultModel: 'gpt-5.4',
    });
  });

  it('keeps an available model and falls back to Auto when it disappears', () => {
    const models = [{ id: 'gpt-5.4', label: 'GPT-5.4', supportsVision: true }];

    expect(pickCodexModel({ currentModel: 'gpt-5.4', models })).toBe('gpt-5.4');
    expect(pickCodexModel({ currentModel: 'retired-model', models })).toBe('auto');
  });
});
