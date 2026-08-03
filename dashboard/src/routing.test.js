import { describe, expect, it } from 'vitest';
import {
  getPathForTab,
  getTabFromPath,
  buildProjectPath,
  buildEditorPath,
  parseRoute,
} from './routing';

describe('frontend tab routing', () => {
  it('restores the projects tab from its URL after a reload', () => {
    expect(getTabFromPath('/projects')).toBe('projects');
  });

  it('maps tabs to stable frontend paths', () => {
    expect(getPathForTab('projects')).toBe('/projects');
    expect(getPathForTab('dashboard')).toBe('/');
  });

  it('maps the standalone local editor tab to /editor', () => {
    expect(getPathForTab('editor')).toBe('/editor');
    expect(getTabFromPath('/editor')).toBe('editor');
    expect(parseRoute('/editor')).toMatchObject({
      tab: 'editor',
      projectId: null,
      clipIndex: null,
      editor: false,
      versionId: null,
    });
  });

  it('builds and parses a project detail route with encoded IDs', () => {
    const path = buildProjectPath('job/with spaces');
    expect(path).toBe('/projects/job%2Fwith%20spaces');
    expect(parseRoute(path)).toMatchObject({
      tab: 'projects',
      projectId: 'job/with spaces',
      clipIndex: null,
      editor: false,
      versionId: null,
    });
  });

  it('builds and parses an editor route with a selected version', () => {
    const path = buildEditorPath('job-123', 2, 'v/3');
    expect(path).toBe('/projects/job-123/clips/2/editor?version=v%2F3');
    expect(parseRoute(path)).toMatchObject({
      tab: 'projects',
      projectId: 'job-123',
      clipIndex: 2,
      editor: true,
      versionId: 'v/3',
    });
  });
});
