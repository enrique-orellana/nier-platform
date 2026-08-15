import { describe, expect, it } from 'vitest';

import {
  buildVisibleProviders,
  pickLmStudioModel,
  pickProviderAfterDiscoveryFailure,
} from './lmStudio';

describe('lmStudio helpers', () => {
  it('shows lmstudio only when discovery is available', () => {
    expect(buildVisibleProviders({ lmStudioAvailable: false })).toEqual(['gemini', 'openrouter', 'lmstudio', 'openai-codex']);
    expect(buildVisibleProviders({ lmStudioAvailable: true })).toEqual(['gemini', 'openrouter', 'lmstudio', 'openai-codex']);
  });

  it('keeps the current provider when lmstudio disappears', () => {
    expect(
      pickProviderAfterDiscoveryFailure({
        currentProvider: 'lmstudio',
      }),
    ).toBe('lmstudio');
  });

  it('uses the first discovered lmstudio model when current selection is auto', () => {
    expect(
      pickLmStudioModel({
        currentModel: 'auto',
        models: [
          { id: 'google/gemma-4-27b', label: 'Gemma 4 27B' },
          { id: 'meta/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
        ],
      }),
    ).toBe('google/gemma-4-27b');
  });

  it('preserves a valid discovered lmstudio model selection', () => {
    expect(
      pickLmStudioModel({
        currentModel: 'meta/llama-3.3-70b-instruct',
        models: [
          { id: 'google/gemma-4-27b', label: 'Gemma 4 27B' },
          { id: 'meta/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
        ],
      }),
    ).toBe('meta/llama-3.3-70b-instruct');
  });
});
