import { describe, expect, it, vi } from 'vitest';
import { renderInBrowser } from '../../lib/renderInBrowser';
import { buildRemotionRenderProps, renderLocalVideoOnBrowser } from './localEditorRender';

vi.mock('../../lib/renderInBrowser', () => ({ renderInBrowser: vi.fn() }));

describe('local editor Remotion rendering', () => {
    it('converts local editor overlays to the native render contract', () => {
        const props = buildRemotionRenderProps({
            durationSeconds: 6,
            fps: 25,
            width: 608,
            height: 1080,
            subtitleCues: [{ text: 'Hello', startMs: 500, endMs: 1500 }],
            subtitleStyle: { position: 'bottom', fontFamily: 'Verdana', fontSize: 24 },
            hook: { text: 'Hook', startMs: 0, endMs: 2000, position: 'center', size: 'M', entranceAnimation: 'fade' },
        });

        expect(props).toMatchObject({ durationInFrames: 150, fps: 25, width: 608, height: 1080 });
        expect(props.subtitles.captions).toEqual([{ text: 'Hello', startMs: 500, endMs: 1500 }]);
        expect(props.hook).toMatchObject({ text: 'Hook', displayDurationSec: 2, position: 'center' });
    });

    it('renders locally with the same Remotion/WebCodecs composition', async () => {
        renderInBrowser.mockResolvedValue('blob:rendered-mp4');

        const outputUrl = await renderLocalVideoOnBrowser({
            videoUrl: 'blob:source',
            durationSeconds: 2,
            fps: 25,
            width: 608,
            height: 1080,
            subtitleCues: [{ text: 'Hello', startMs: 0, endMs: 1000 }],
            subtitleStyle: { position: 'bottom' },
            onProgress: vi.fn(),
        });

        expect(outputUrl).toBe('blob:rendered-mp4');
        expect(renderInBrowser).toHaveBeenCalledWith(expect.objectContaining({
            videoUrl: 'blob:source',
            durationInSeconds: 2,
            fps: 25,
            width: 608,
            height: 1080,
            subtitles: expect.objectContaining({ captions: [{ text: 'Hello', startMs: 0, endMs: 1000 }] }),
        }));
    });
});
