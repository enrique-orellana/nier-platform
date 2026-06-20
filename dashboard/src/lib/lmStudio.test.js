import { describe, expect, it } from 'vitest';

import {
  buildVisibleProviders,
  pickProviderAfterDiscoveryFailure,
} from './lmStudio';

describe('lmStudio helpers', () => {
  it('shows lmstudio only when discovery is available', () => {
    expect(buildVisibleProviders({ lmStudioAvailable: false })).toEqual(['gemini', 'ollama']);
    expect(buildVisibleProviders({ lmStudioAvailable: true })).toEqual(['gemini', 'ollama', 'lmstudio']);
  });

  it('falls back to ollama before gemini when lmstudio disappears', () => {
    expect(
      pickProviderAfterDiscoveryFailure({
        currentProvider: 'lmstudio',
        ollamaBaseUrl: 'http://localhost:11434',
      }),
    ).toBe('ollama');
  });
});
