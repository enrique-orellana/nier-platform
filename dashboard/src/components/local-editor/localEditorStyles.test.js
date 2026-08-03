import { describe, expect, it } from 'vitest';
import {
    DEFAULT_SUBTITLE_STYLE,
    HOOK_ENTRANCE_OPTIONS,
    HOOK_SIZE_OPTIONS,
    normalizeSubtitleStyle,
    subtitlePositionClass,
} from './localEditorStyles';

describe('local editor overlay styles', () => {
    it('matches the existing hook options', () => {
        expect(HOOK_SIZE_OPTIONS.map((item) => item.value)).toEqual(['S', 'M', 'L']);
        expect(HOOK_ENTRANCE_OPTIONS.map((item) => item.value)).toEqual(['spring', 'fade', 'slide-up', 'none']);
    });

    it('normalizes subtitle style defaults without discarding overrides', () => {
        expect(normalizeSubtitleStyle({ fontFamily: 'Georgia', bgOpacity: 0.5 })).toEqual({
            ...DEFAULT_SUBTITLE_STYLE,
            fontFamily: 'Georgia',
            bgOpacity: 0.5,
        });
    });

    it('maps subtitle positions to preview classes', () => {
        expect(subtitlePositionClass('top')).toContain('top');
        expect(subtitlePositionClass('middle')).toContain('top-1/2');
        expect(subtitlePositionClass('bottom')).toContain('bottom');
    });
});
