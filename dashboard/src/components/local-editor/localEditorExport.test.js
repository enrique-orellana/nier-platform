import { describe, expect, it, vi } from 'vitest';
import { activeCueAt, chooseRecordingMimeType, clampOverlayY, formatClock, getExportSourceUrl, getRecordingOptions, getVideoFrameDimensions, hookVisualState, prepareVideoForExport, subtitleVisualStyle } from './localEditorExport';

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

    it('resets the source video to the beginning before export', () => {
        const video = { currentTime: 27.5, pause: vi.fn() };

        prepareVideoForExport(video);

        expect(video.pause).toHaveBeenCalledTimes(1);
        expect(video.currentTime).toBe(0);
    });

    it('keeps subtitle overlays inside the rendered frame', () => {
        expect(clampOverlayY(560, 720, 260, 20)).toBe(480);
        expect(clampOverlayY(0, 720, 260, 20)).toBe(20);
    });

    it('uses the source video dimensions for the export canvas', () => {
        expect(getVideoFrameDimensions({ videoWidth: 1920, videoHeight: 1080 })).toEqual({ width: 1920, height: 1080 });
    });

    it('uses the resolved media source for an isolated export video', () => {
        expect(getExportSourceUrl({ currentSrc: 'blob:current', src: 'blob:original' })).toBe('blob:current');
        expect(getExportSourceUrl({ src: 'blob:original' })).toBe('blob:original');
    });

    it('uses explicit high-quality recorder options', () => {
        expect(getRecordingOptions('video/webm', 1080, 1920)).toEqual({
            mimeType: 'video/webm',
            videoBitsPerSecond: 16588800,
            audioBitsPerSecond: 192000,
        });
    });
});
