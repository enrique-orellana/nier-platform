import { describe, expect, it } from 'vitest';

import {
  codexPollState,
  codexStatusLabel,
  normalizeCodexModels,
  normalizeCodexStatus,
  pickCodexEffort,
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
      models: [{
        id: 'gpt-5.4',
        label: 'GPT-5.4',
        supportsVision: true,
        efforts: [],
        defaultEffort: '',
      }],
      defaultModel: 'gpt-5.4',
    });
  });

  it('normalizes model-specific effort metadata and falls back when an effort disappears', () => {
    const catalog = normalizeCodexModels({
      models: [{
        id: 'gpt-5.6-luna',
        displayName: 'GPT-5.6-Luna',
        supported_reasoning_levels: [
          { effort: 'medium', description: 'Balanced' },
          { effort: 'max', description: 'Maximum' },
        ],
        default_reasoning_level: 'medium',
      }],
    });

    expect(catalog.models[0].efforts).toEqual([
      { id: 'medium', label: 'Medium', description: 'Balanced' },
      { id: 'max', label: 'Max', description: 'Maximum' },
    ]);
    expect(catalog.models[0].defaultEffort).toBe('medium');
    expect(pickCodexEffort({ currentEffort: 'max', modelId: 'gpt-5.6-luna', models: catalog.models })).toBe('max');
    expect(pickCodexEffort({ currentEffort: 'ultra', modelId: 'gpt-5.6-luna', models: catalog.models })).toBe('auto');
  });

  it('preserves efforts already normalized by the backend catalog endpoint', () => {
    const catalog = normalizeCodexModels({
      models: [{
        id: 'gpt-5.6-luna',
        label: 'GPT-5.6-Luna',
        efforts: [{ id: 'max', label: 'Max', description: 'Maximum' }],
        defaultEffort: 'max',
      }],
    });

    expect(catalog.models[0].efforts).toEqual([
      { id: 'max', label: 'Max', description: 'Maximum' },
    ]);
    expect(catalog.models[0].defaultEffort).toBe('max');
  });

  it('keeps an available model and falls back to Auto when it disappears', () => {
    const models = [{ id: 'gpt-5.4', label: 'GPT-5.4', supportsVision: true }];

    expect(pickCodexModel({ currentModel: 'gpt-5.4', models })).toBe('gpt-5.4');
    expect(pickCodexModel({ currentModel: 'retired-model', models })).toBe('auto');
  });
});
