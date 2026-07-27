import { describe, expect, it } from 'vitest';
import { getPathForTab, getTabFromPath } from './routing';

describe('frontend tab routing', () => {
  it('restores the projects tab from its URL after a reload', () => {
    expect(getTabFromPath('/projects')).toBe('projects');
  });

  it('maps tabs to stable frontend paths', () => {
    expect(getPathForTab('projects')).toBe('/projects');
    expect(getPathForTab('dashboard')).toBe('/');
  });
});
