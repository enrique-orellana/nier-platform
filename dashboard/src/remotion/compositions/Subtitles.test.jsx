import { describe, expect, it } from 'vitest';
import { normalizeSubtitleConfig } from './Subtitles';

describe('subtitle rendering defaults', () => {
    it('fills missing style data before rendering legacy subtitle configs', () => {
        const normalized = normalizeSubtitleConfig({ captions: [{ text: 'Ciao', startMs: 0, endMs: 500 }] });
        expect(normalized.position).toBe('bottom');
        expect(normalized.style).toMatchObject({ fontFamily: 'Arial', fontSize: 52, animation: 'none' });
        expect(normalized.style.fontColor).toBe('#FFFFFF');
    });
});
