import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FullScreenEditor from './FullScreenEditor';

const renderVersionMocks = vi.hoisted(() => ({ saveAndRenderVersion: vi.fn() }));
vi.mock('../../editor/renderVersion', () => renderVersionMocks);
vi.mock('../../components/RemotionPreview', () => ({ default: ({ currentFrame = 0 }) => <div data-testid="remotion-player-frame">{currentFrame}</div> }));

const manifest = {
    timeline: { source_video_url: 'https://example.test/video.mp4', trim: { start_sec: 0, end_sec: 10 } },
    layers: { hook: { text: 'Original hook', startMs: 1000, endMs: 3000 }, subtitles: null, effects: null },
    subtitle_tracks: [{ id: 'original', label: 'Original', language: 'es', cues: [{ text: 'Hola', startMs: 1000, endMs: 2000 }] }],
};

describe('FullScreenEditor', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        renderVersionMocks.saveAndRenderVersion.mockReset();
    });

    it('renders the editor workspace and advances the preview one frame', () => {
        render(<FullScreenEditor jobId="job" clipIndex={0} clip={{ output_fps: 30, output_width: 1080, output_height: 1920, video_url: manifest.timeline.source_video_url }} initialManifest={manifest} initialVersion={{ version_id: 'v1', status: 'done' }} onClose={vi.fn()} />);
        expect(screen.getByRole('heading', { name: /media pool/i })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: /timeline/i })).toBeInTheDocument();
        expect(screen.getByLabelText('Subtitle translation')).toBeInTheDocument();
        expect(screen.getByText(/starts at the current playhead/i)).toBeInTheDocument();
        expect(screen.getByText(/nothing selected/i)).toBeInTheDocument();
        expect(screen.getByText(/select a clip or cue in the timeline/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /next frame/i }));
        expect(screen.getByTestId('remotion-player-frame')).toHaveTextContent('1');
    });

    it('connects timeline selection to hook and subtitle inspectors', () => {
        render(<FullScreenEditor jobId="job" clipIndex={0} clip={{ output_fps: 30, output_width: 1080, output_height: 1920, video_url: manifest.timeline.source_video_url }} initialManifest={manifest} initialVersion={{ version_id: 'v1', status: 'done' }} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Original hook clip' }));
        expect(screen.getByLabelText('Text')).toHaveValue('Original hook');
        fireEvent.click(screen.getByRole('button', { name: 'Hola clip' }));
        expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument();
        expect(screen.getByLabelText('Subtitle translation')).toBeInTheDocument();
    });

    it('keeps inspector subtitle text edits in the selected cue', () => {
        render(<FullScreenEditor jobId="job" clipIndex={0} clip={{ output_fps: 30, output_width: 1080, output_height: 1920, video_url: manifest.timeline.source_video_url }} initialManifest={manifest} initialVersion={{ version_id: 'v1', status: 'done' }} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Hola clip' }));
        const text = screen.getByLabelText('Text');
        fireEvent.change(text, { target: { value: 'Piano corrected' } });
        expect(text).toHaveValue('Piano corrected');
        expect(screen.getByRole('button', { name: 'Piano corrected clip' })).toBeInTheDocument();
    });

    it('deletes the selected subtitle cue from the timeline', () => {
        render(<FullScreenEditor jobId="job" clipIndex={0} clip={{ output_fps: 30, output_width: 1080, output_height: 1920, video_url: manifest.timeline.source_video_url }} initialManifest={manifest} initialVersion={{ version_id: 'v1', status: 'done' }} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Hola clip' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete subtitle cue' }));
        expect(screen.queryByRole('button', { name: 'Hola clip' })).not.toBeInTheDocument();
    });

    it('deletes a translated subtitle track while keeping the original', () => {
        const translatedManifest = {
            ...manifest,
            subtitle_tracks: [
                ...manifest.subtitle_tracks,
                { id: 'en', label: 'EN', language: 'en', origin: 'translation', cues: [{ text: 'Hello', startMs: 1000, endMs: 2000 }] },
            ],
        };
        render(<FullScreenEditor jobId="job" clipIndex={0} clip={{ output_fps: 30, output_width: 1080, output_height: 1920, video_url: manifest.timeline.source_video_url }} initialManifest={translatedManifest} initialVersion={{ version_id: 'v1', status: 'done' }} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Delete EN translation' }));
        expect(screen.queryByRole('button', { name: 'EN' })).not.toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Original' })).toBeInTheDocument();
    });

    it('adds a new translated subtitle track to the current draft', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ translationId: 'translation-1', status: 'queued' }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ translationId: 'translation-1', status: 'done', track: { id: 'en', label: 'EN', language: 'en', origin: 'translation', cues: [{ text: 'Hello', startMs: 1000, endMs: 2000 }] } }) }));
        render(<FullScreenEditor jobId="job" clipIndex={0} clip={{ output_fps: 30, output_width: 1080, output_height: 1920, video_url: manifest.timeline.source_video_url }} initialManifest={manifest} initialVersion={{ version_id: 'v1', status: 'done' }} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Translate entire track' }));
        await waitFor(() => expect(screen.getByRole('option', { name: 'EN' })).toBeInTheDocument());
    });

    it('adds a subtitle cue at the current playhead and selects it', () => {
        render(<FullScreenEditor jobId="job" clipIndex={0} clip={{ output_fps: 30, output_width: 1080, output_height: 1920, video_url: manifest.timeline.source_video_url }} initialManifest={manifest} initialVersion={{ version_id: 'v1', status: 'done' }} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /next frame/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Add subtitle cue' }));
        const text = screen.getByLabelText('Text');
        expect(text).toHaveValue('');
        fireEvent.change(text, { target: { value: 'Manual cue' } });
        expect(screen.getByRole('button', { name: 'Manual cue clip' })).toBeInTheDocument();
    });

    it('keeps cue creation available while another editor item is selected', () => {
        render(<FullScreenEditor jobId="job" clipIndex={0} clip={{ output_fps: 30, output_width: 1080, output_height: 1920, video_url: manifest.timeline.source_video_url }} initialManifest={manifest} initialVersion={{ version_id: 'v1', status: 'done' }} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Original hook clip' }));
        expect(screen.getByRole('button', { name: 'Add subtitle cue' })).toBeInTheDocument();
    });

    it('renders the complete action toolbar when opened from a result card', () => {
        const editorActions = Object.fromEntries(['onAutoEdit', 'onConvertNativeShort', 'onSubtitles', 'onViralHook', 'onDubVoice', 'onPost', 'onDownload'].map((name) => [name, vi.fn()]));
        render(<FullScreenEditor jobId="job" clipIndex={0} clip={{ output_fps: 30, video_url: manifest.timeline.source_video_url }} initialManifest={manifest} initialVersion={{ version_id: 'v1', status: 'done' }} editorActions={editorActions} onClose={vi.fn()} />);
        const actionsRegion = screen.getByRole('region', { name: 'Editor actions' });
        expect(actionsRegion).toBeInTheDocument();
        expect(actionsRegion.closest('aside')).toHaveAttribute('aria-label', 'Inspector');
        expect(screen.getByRole('button', { name: 'Auto Edit' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    });

    it('uses the local editor workspace while retaining project actions and version history', async () => {
        Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => 'blob:project-video') });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['video'], { type: 'video/mp4' }) }));
        render(<FullScreenEditor useLocalEditor jobId="job" clipIndex={0} clip={{ output_fps: 30, video_url: manifest.timeline.source_video_url }} initialManifest={manifest} initialVersion={{ version_id: 'v1', status: 'done' }} editorActions={Object.fromEntries(['onAutoEdit', 'onConvertNativeShort', 'onSubtitles', 'onViralHook', 'onDubVoice', 'onPost', 'onDownload'].map((name) => [name, vi.fn()]))} onClose={vi.fn()} />);
        await waitFor(() => expect(screen.getByRole('button', { name: /toggle subtitles settings/i })).toBeInTheDocument());
        const actionsRegion = screen.getByRole('region', { name: 'Editor actions' });
        expect(actionsRegion).toBeInTheDocument();
        expect(actionsRegion.closest('aside')).toHaveAttribute('aria-label', 'Inspector');
        expect(screen.getByText(/version history/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /save as new version/i })).toBeInTheDocument();
    });

    it('loads legacy project subtitles into the local editor timeline', async () => {
        Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => 'blob:legacy-project-video') });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['video'], { type: 'video/mp4' }) }));
        const legacyManifest = {
            timeline: { source_video_url: 'https://example.test/video.mp4', trim: { start_sec: 0, end_sec: 4 } },
            layers: { subtitles: { cues: [{ text: 'Hola', startMs: 500, endMs: 1500 }] } },
        };

        render(<FullScreenEditor useLocalEditor jobId="job" clipIndex={0} clip={{ output_fps: 30, video_url: legacyManifest.timeline.source_video_url }} initialManifest={legacyManifest} initialVersion={{ version_id: 'v1', status: 'done' }} onClose={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('local-editor-subtitles-track')).toHaveTextContent('Hola'));
    });

    it('previews the master at the clip start while retaining the trimmed export source', async () => {
        const fetchMock = vi.fn().mockImplementation(async (url) => ({
            ok: true,
            blob: async () => new Blob([String(url)], { type: 'video/mp4' }),
        }));
        vi.stubGlobal('fetch', fetchMock);
        Object.defineProperty(URL, 'createObjectURL', {
            configurable: true,
            writable: true,
            value: vi.fn()
                .mockReturnValueOnce('blob:trimmed-export')
                .mockReturnValueOnce('blob:master-preview'),
        });
        const localManifest = {
            timeline: { source_video_url: '', trim: { start_sec: 34.2, end_sec: 60.64 } },
            layers: {},
            subtitle_tracks: [],
        };

        render(<FullScreenEditor
            useLocalEditor
            jobId="job"
            clipIndex={0}
            clip={{ output_fps: 30, video_url: '/videos/job/source_clip_1.mp4', source_video_url: '/videos/job/source.mp4' }}
            initialManifest={localManifest}
            initialVersion={{ version_id: 'v1', status: 'done' }}
            onClose={vi.fn()}
        />);

        await waitFor(() => expect(screen.getByRole('button', { name: /toggle subtitles settings/i })).toBeInTheDocument());
        expect(fetchMock).toHaveBeenCalledWith('/videos/job/source.mp4');
        expect(fetchMock).toHaveBeenCalledWith('/videos/job/source_clip_1.mp4');
        expect(document.querySelector('video')).toHaveAttribute('src', 'blob:master-preview');
        expect(screen.getAllByText('00:00 / 00:26')).toHaveLength(2);
    });

    it('saves generated hashtags in the new version manifest', async () => {
        renderVersionMocks.saveAndRenderVersion.mockResolvedValue({ status: 'done', outputUrl: '/videos/job/generated.mp4', version: { version_id: 'v2', status: 'done' } });
        vi.stubGlobal('fetch', vi.fn((url) => String(url).includes('/api/local-editor/hashtags')
            ? Promise.resolve({ ok: true, json: async () => ({ hashtags: ['#editedclip'] }) })
            : Promise.resolve({ ok: true, blob: async () => new Blob(['video'], { type: 'video/mp4' }) })));
        Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => 'blob:project-video') });

        render(<FullScreenEditor
            useLocalEditor
            jobId="job"
            clipIndex={0}
            clip={{ output_fps: 30, video_url: manifest.timeline.source_video_url, video_title_for_youtube_short: 'Título', video_description_for_tiktok: 'Caption' }}
            initialManifest={manifest}
            initialVersion={{ version_id: 'v1', status: 'done' }}
            onClose={vi.fn()}
        />);

        await waitFor(() => expect(screen.getByRole('button', { name: /generate hashtags/i })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /generate hashtags/i }));
        await waitFor(() => expect(screen.getByRole('group', { name: 'Hashtags' })).toHaveTextContent('#editedclip'));
        fireEvent.click(screen.getByRole('button', { name: /save as new version/i }));

        await waitFor(() => expect(renderVersionMocks.saveAndRenderVersion).toHaveBeenCalledWith(expect.objectContaining({
            manifest: expect.objectContaining({ publishing_metadata: { hashtags: ['#editedclip'] } }),
        })));
    });

    it('restores saved hashtags from the version manifest', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            blob: async () => new Blob(['video'], { type: 'video/mp4' }),
        }));
        Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => 'blob:saved-hashtags') });

        render(<FullScreenEditor
            useLocalEditor
            jobId="job"
            clipIndex={0}
            clip={{ output_fps: 30, video_url: manifest.timeline.source_video_url, video_title_for_youtube_short: 'Título', video_description_for_tiktok: 'Caption' }}
            initialManifest={{ ...manifest, publishing_metadata: { hashtags: ['#savedtag'] } }}
            initialVersion={{ version_id: 'v1', status: 'done' }}
            onClose={vi.fn()}
        />);

        await waitFor(() => expect(screen.getByRole('group', { name: 'Hashtags' })).toHaveTextContent('#savedtag'));
        expect(screen.queryByText('#shorts')).not.toBeInTheDocument();
    });

    it('exposes a draft session that accumulates effects and optional subtitle tracks', async () => {
        let session;
        render(<FullScreenEditor jobId="job" clipIndex={0} clip={{ output_fps: 30, video_url: manifest.timeline.source_video_url }} initialManifest={{ ...manifest, subtitle_tracks: [], layers: { hook: manifest.layers.hook, effects: null, subtitles: null } }} initialVersion={{ version_id: 'v1', status: 'done', output_url: '/videos/job/v1.mp4' }} onSessionReady={(api) => { session = api; }} onClose={vi.fn()} />);
        await waitFor(() => expect(session).toBeTruthy());
        session.applyLayer('effects', { segments: [{ startSec: 0, endSec: 2, zoom: 1.1 }] });
        session.applyLayer('subtitles', { captions: [{ text: 'Hello', startMs: 500, endMs: 1200 }], style: { animation: 'pop' } });
        expect(session.getManifest()).toMatchObject({ layers: { hook: { text: 'Original hook' }, effects: { segments: [{ startSec: 0, endSec: 2, zoom: 1.1 }] }, subtitles: { style: { animation: 'pop' } } }, subtitle_tracks: [{ id: 'original', cues: [{ text: 'Hello', startMs: 500, endMs: 1200 }] }], active_subtitle_track_id: 'original' });
    });

    it('downloads the exact completed version output', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['video']) });
        vi.stubGlobal('fetch', fetchMock);
        Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:download') });
        Object.defineProperty(window.URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
        const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const appendChild = vi.spyOn(document.body, 'appendChild');
        render(<FullScreenEditor jobId="job" clipIndex={2} clip={{ output_fps: 30, video_url: manifest.timeline.source_video_url }} initialManifest={manifest} initialVersion={{ version_id: 'version-123456', status: 'done', output_url: '/videos/job/version-123456.mp4' }} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /download saved version/i }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/videos/job/version-123456.mp4'));
        expect(appendChild.mock.calls.some(([node]) => node?.download === 'clip-3-version-.mp4')).toBe(true);
        anchorClick.mockRestore();
        appendChild.mockRestore();
    });

    it('shows and edits subtitles from the legacy layer shape', () => {
        const legacyManifest = {
            timeline: { source_video_url: 'https://example.test/video.mp4', trim: { start_sec: 0, end_sec: 4 } },
            layers: { subtitles: { cues: [{ text: 'Hola', startMs: 500, endMs: 1500 }] } },
        };
        render(<FullScreenEditor jobId="job" clipIndex={0} clip={{ output_fps: 30, video_url: legacyManifest.timeline.source_video_url }} initialManifest={legacyManifest} initialVersion={{ version_id: 'v1', status: 'done' }} onClose={vi.fn()} />);
        fireEvent.doubleClick(screen.getByRole('button', { name: 'Hola clip' }));
        const input = screen.getByRole('textbox', { name: 'Edit subtitle Hola' });
        fireEvent.change(input, { target: { value: 'Hello' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(screen.getByRole('button', { name: 'Hello clip' })).toBeInTheDocument();
        expect(legacyManifest.layers.subtitles.cues[0].text).toBe('Hola');
    });

    it('shows subtitle cues from the transcript manifest shape used by generated clips', () => {
        const transcriptManifest = {
            timeline: { source_video_url: 'https://example.test/video.mp4', trim: { start_sec: 0, end_sec: 4 }, transcript: { language: 'it', segments: [{ start: 0.5, end: 1.5, text: 'Ciao' }] } },
            layers: {},
        };
        render(<FullScreenEditor jobId="job" clipIndex={0} clip={{ output_fps: 30, video_url: transcriptManifest.timeline.source_video_url }} initialManifest={transcriptManifest} initialVersion={{ version_id: 'v1', status: 'done' }} onClose={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Ciao clip' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Original it' })).toBeInTheDocument();
    });

    it('preloads generated transcript subtitles in the local editor timeline', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['video'], { type: 'video/mp4' }) }));
        Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => 'blob:generated-clip') });
        const transcriptManifest = {
            timeline: { source_video_url: 'https://example.test/video.mp4', trim: { start_sec: 10, end_sec: 14 }, transcript: { language: 'it', segments: [{ start: 10.5, end: 11.5, text: 'Ciao' }] } },
            layers: {},
            subtitle_tracks: [],
        };
        render(<FullScreenEditor useLocalEditor jobId="job" clipIndex={0} clip={{ output_fps: 30, video_url: transcriptManifest.timeline.source_video_url }} initialManifest={transcriptManifest} initialVersion={{ version_id: 'v1', status: 'done' }} onClose={vi.fn()} />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Ciao' })).toBeInTheDocument());
    });

    it('hydrates subtitles from the clip transcript endpoint when a legacy version has no subtitle track', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url) => {
            if (String(url).endsWith('/versions')) {
                return { ok: true, json: async () => ({ current_version_id: 'v3', versions: [{ version_id: 'v3', status: 'done' }] }) };
            }
            if (String(url).endsWith('/versions/v3')) {
                return { ok: true, json: async () => ({ version: { version_id: 'v3', status: 'done' }, manifest: { timeline: { source_video_url: '/videos/clip.mp4', trim: { start_sec: 10, end_sec: 14 }, transcript: { language: 'it', segments: [{ start: 10.5, end: 11.5, text: 'Source transcript' }] } }, subtitle_tracks: [], layers: {} } }) };
            }
            if (String(url).endsWith('/transcript')) {
                return { ok: true, json: async () => ({ language: 'it', durationSec: 4, captions: [{ text: 'Ciao', startMs: 500, endMs: 1500 }] }) };
            }
            throw new Error(`Unexpected request: ${url}`);
        }));
        render(<FullScreenEditor jobId="job" clipIndex={1} clip={{ output_fps: 30, video_url: '/videos/clip.mp4' }} onClose={vi.fn()} />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Ciao clip' })).toBeInTheDocument());
        expect(screen.getByRole('button', { name: 'Original it' })).toBeInTheDocument();
    });

    it('bootstraps the editor from a persisted manifest when no saved version exists', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url) => {
            if (String(url).endsWith('/versions')) {
                return { ok: true, json: async () => ({ current_version_id: '', versions: [] }) };
            }
            if (String(url).endsWith('/manifest')) {
                return {
                    ok: true,
                    json: async () => ({
                        manifest: {
                            timeline: { source_video_url: '/videos/clip.mp4', trim: { start_sec: 0, end_sec: 4 } },
                            subtitle_tracks: [],
                            layers: {},
                        },
                    }),
                };
            }
            if (String(url).endsWith('/transcript')) {
                return { ok: true, json: async () => ({ language: 'it', captions: [{ text: 'Ciao', startMs: 500, endMs: 1500 }] }) };
            }
            throw new Error(`Unexpected request: ${url}`);
        }));
        render(<FullScreenEditor jobId="job" clipIndex={0} clip={{ output_fps: 30, video_url: '/videos/clip.mp4' }} onClose={vi.fn()} />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Ciao clip' })).toBeInTheDocument());
        expect(screen.getByRole('button', { name: 'Original it' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Save as new version' })).toBeEnabled();
    });
});
