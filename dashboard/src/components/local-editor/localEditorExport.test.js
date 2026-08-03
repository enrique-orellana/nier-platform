import { describe, expect, it } from 'vitest';
import { activeCueAt, chooseRecordingMimeType, formatClock } from './localEditorExport';

describe('local editor export helpers', () => {
    it('finds a cue active at the playhead', () => {
        const cue = { id: 'one', startMs: 1000, endMs: 2000 };
        expect(activeCueAt([cue], 1000)).toEqual(cue);
        expect(activeCueAt([cue], 2000)).toBeNull();
    });

    it('formats the player clock', () => {
        expect(formatClock(65000)).toBe('01:05');
    });

    it('chooses a supported recording type', () => {
        expect(chooseRecordingMimeType((type) => type === 'video/webm')).toBe('video/webm');
    });
});
