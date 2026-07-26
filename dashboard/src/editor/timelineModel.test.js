import { describe, expect, it } from 'vitest';
import { createSubtitleCue, frameToMs, makeEditorDraft, moveCue, resizeCue } from './timelineModel';

describe('timelineModel', () => {
    it('converts frames exactly', () => expect(frameToMs(15, 30)).toBe(500));
    it('moves cues inside the clip', () => expect(moveCue({ startMs: 900, endMs: 1400 }, -1000, 1000)).toEqual({ startMs: 0, endMs: 500 }));
    it('resizes with a minimum duration', () => expect(resizeCue({ startMs: 100, endMs: 200 }, 'end', -200, 1000)).toEqual({ startMs: 100, endMs: 180 }));
    it('creates a blank cue at the playhead with a two-second default', () => {
        expect(createSubtitleCue({ playheadMs: 4200, durationMs: 10000, fps: 25, existingIds: [] }))
            .toMatchObject({ type: 'subtitle', text: '', label: '', startMs: 4200, endMs: 6200 });
    });
    it('clamps a new cue to the clip end with one frame minimum duration', () => {
        expect(createSubtitleCue({ playheadMs: 9900, durationMs: 10000, fps: 25, existingIds: ['subtitle-new-1'] }))
            .toMatchObject({ startMs: 9900, endMs: 9940 });
    });
    it('deep clones a version manifest', () => {
        const version = { manifest: { layers: { hook: { text: 'x' } } } };
        const draft = makeEditorDraft(version); draft.layers.hook.text = 'y';
        expect(version.manifest.layers.hook.text).toBe('x');
    });
});
