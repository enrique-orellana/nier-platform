import { describe, expect, it, vi } from 'vitest';
import { buildBackendRenderProps, renderLocalVideoOnBackend } from './localEditorRender';

describe('local editor backend rendering', () => {
    it('converts local editor overlays to the native render contract', () => {
        const props = buildBackendRenderProps({
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

    it('uploads the source and polls the native render until it completes', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ renderId: 'render-1', jobId: 'local-editor-1' }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'rendering', progress: 50 }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'done', progress: 100, outputUrl: '/output/local-editor-1/render.mp4' }) });
        const onProgress = vi.fn();

        const outputUrl = await renderLocalVideoOnBackend({
            file: new File(['video'], 'source.mp4', { type: 'video/mp4' }),
            durationSeconds: 2,
            fps: 25,
            width: 608,
            height: 1080,
            pollMs: 0,
            fetchImpl,
            onProgress,
        });

        expect(outputUrl).toBe('/videos/local-editor-1/render.mp4');
        expect(fetchImpl).toHaveBeenCalledTimes(3);
        expect(fetchImpl.mock.calls[0][1].body).toBeInstanceOf(FormData);
        expect(onProgress).toHaveBeenCalledWith(0.5);
        expect(onProgress).toHaveBeenLastCalledWith(1);
    });
});
