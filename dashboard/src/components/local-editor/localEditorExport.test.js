import { describe, expect, it } from 'vitest';
import { activeCueAt, chooseRecordingMimeType, formatClock, hookVisualState, subtitleVisualStyle } from './localEditorExport';

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

    it('matches hook size and entrance settings', () => {
        expect(hookVisualState({ size: 'L', entranceAnimation: 'none' }, 100)).toMatchObject({ scale: 1.3, opacity: 1 });
        expect(hookVisualState({ size: 'M', entranceAnimation: 'fade' }, 0).opacity).toBe(0);
    });

    it('converts subtitle style to canvas values', () => {
        expect(subtitleVisualStyle({ fontFamily: 'Georgia', fontColor: '#FFDD00', borderWidth: 3, bgColor: '#000000', bgOpacity: 0.5 })).toMatchObject({
            fontFamily: 'Georgia',
            color: '#FFDD00',
            background: 'rgba(0, 0, 0, 0.5)',
        });
    });
});
