import { describe, expect, it } from 'vitest';
import { clipTimeToSourceTime, sourceTimeToClipTime } from './localEditorPlayback';

describe('local editor playback offsets', () => {
    it('maps the master clip start to the beginning of the clip timeline', () => {
        expect(sourceTimeToClipTime(34200, 34200, 26440)).toBe(0);
        expect(sourceTimeToClipTime(34700, 34200, 26440)).toBe(500);
    });

    it('maps clip-relative seeks back onto the master video', () => {
        expect(clipTimeToSourceTime(0, 34200, 26440)).toBe(34200);
        expect(clipTimeToSourceTime(500, 34200, 26440)).toBe(34700);
        expect(clipTimeToSourceTime(99999, 34200, 26440)).toBe(60640);
    });
});
