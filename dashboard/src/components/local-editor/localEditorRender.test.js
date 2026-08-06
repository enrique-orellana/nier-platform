import { describe, expect, it, vi } from 'vitest';
import { renderInBrowser } from '../../lib/renderInBrowser';
import { buildRemotionRenderProps, burnLocalEditorSubtitles, renderLocalVideoOnBackend, renderLocalVideoOnBrowser } from './localEditorRender';

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

    it('preserves Clip Generator word timings when generated cues are rendered', () => {
        const props = buildRemotionRenderProps({
            durationSeconds: 2,
            fps: 25,
            width: 608,
            height: 1080,
            subtitleCues: [{
                text: 'Do I',
                startMs: 200,
                endMs: 550,
                captions: [
                    { text: 'Do', startMs: 200, endMs: 400 },
                    { text: 'I', startMs: 400, endMs: 550 },
                ],
            }],
        });

        expect(props.subtitles.captions).toEqual([
            { text: 'Do', startMs: 200, endMs: 400 },
            { text: 'I', startMs: 400, endMs: 550 },
        ]);
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

    it('falls back to the native backend renderer for unsupported browser codecs', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ renderId: 'render-1', jobId: 'local-editor-1' }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'done', progress: 100, outputUrl: '/output/local-editor-1/render.mp4' }) });
        const outputUrl = await renderLocalVideoOnBackend({
            file: new File(['video'], 'source.mp4', { type: 'video/mp4' }),
            durationSeconds: 2,
            width: 608,
            height: 1080,
            pollMs: 0,
            fetchImpl,
        });

        expect(outputUrl).toBe('/videos/local-editor-1/render.mp4');
        expect(fetchImpl.mock.calls[0][1].body).toBeInstanceOf(FormData);
    });

    it('burns edited cues through the backend FFmpeg subtitle path after rendering', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ renderId: 'render-1', jobId: 'local-editor-1' }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'done', progress: 100, outputUrl: '/output/local-editor-1/render.mp4' }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ outputUrl: '/videos/local-editor-1/subtitled.mp4' }) });

        const outputUrl = await burnLocalEditorSubtitles({
            file: new File(['video'], 'source.mp4', { type: 'video/mp4' }),
            durationSeconds: 2,
            width: 608,
            height: 1080,
            subtitleCues: [{ text: 'Do I need to undress?', startMs: 0, endMs: 1000 }],
            subtitleStyle: { position: 'bottom', fontFamily: 'Verdana', fontSize: 24 },
            pollMs: 0,
            fetchImpl,
        });

        expect(outputUrl).toBe('/videos/local-editor-1/subtitled.mp4');
        expect(fetchImpl.mock.calls[2][0]).toContain('/api/local-editor/burn-subtitles');
        expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toMatchObject({
            job_id: 'local-editor-1',
            input_filename: 'render.mp4',
            subtitle_cues: [{ text: 'Do I need to undress?', startMs: 0, endMs: 1000 }],
        });
    });

    it('uses the Clip Generator Remotion path for word-timed generated cues', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ renderId: 'render-1', jobId: 'local-editor-1' }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'done', progress: 100, outputUrl: '/output/local-editor-1/render.mp4' }) });

        const outputUrl = await burnLocalEditorSubtitles({
            file: new File(['video'], 'source.mp4', { type: 'video/mp4' }),
            durationSeconds: 2,
            width: 608,
            height: 1080,
            subtitleCues: [{
                text: 'Do I',
                startMs: 0,
                endMs: 800,
                captions: [{ text: 'Do', startMs: 0, endMs: 400 }, { text: 'I', startMs: 400, endMs: 800 }],
            }],
            pollMs: 0,
            fetchImpl,
        });

        expect(outputUrl).toBe('/videos/local-editor-1/render.mp4');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(JSON.parse(fetchImpl.mock.calls[0][1].body.get('props')).subtitles.captions).toEqual([
            { text: 'Do', startMs: 0, endMs: 400 },
            { text: 'I', startMs: 400, endMs: 800 },
        ]);
    });
});
