import { describe, expect, it } from 'vitest';
import { frameToMs, makeEditorDraft, moveCue, resizeCue } from './timelineModel';

describe('timelineModel', () => {
    it('converts frames exactly', () => expect(frameToMs(15, 30)).toBe(500));
    it('moves cues inside the clip', () => expect(moveCue({ startMs: 900, endMs: 1400 }, -1000, 1000)).toEqual({ startMs: 0, endMs: 500 }));
    it('resizes with a minimum duration', () => expect(resizeCue({ startMs: 100, endMs: 200 }, 'end', -200, 1000)).toEqual({ startMs: 100, endMs: 180 }));
    it('deep clones a version manifest', () => {
        const version = { manifest: { layers: { hook: { text: 'x' } } } };
        const draft = makeEditorDraft(version); draft.layers.hook.text = 'y';
        expect(version.manifest.layers.hook.text).toBe('x');
    });
});
