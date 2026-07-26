import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FullScreenEditor from './FullScreenEditor';

vi.mock('../../components/RemotionPreview', () => ({ default: ({ currentFrame = 0 }) => <div data-testid="remotion-player-frame">{currentFrame}</div> }));

const manifest = {
    timeline: { source_video_url: 'https://example.test/video.mp4', trim: { start_sec: 0, end_sec: 10 } },
    layers: { hook: { text: 'Original hook', startMs: 1000, endMs: 3000 }, subtitles: null, effects: null },
    subtitle_tracks: [{ id: 'original', label: 'Original', language: 'es', cues: [{ text: 'Hola', startMs: 1000, endMs: 2000 }] }],
};

describe('FullScreenEditor', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('renders the editor workspace and advances the preview one frame', () => {
        render(<FullScreenEditor jobId="job" clipIndex={0} clip={{ output_fps: 30, output_width: 1080, output_height: 1920, video_url: manifest.timeline.source_video_url }} initialManifest={manifest} initialVersion={{ version_id: 'v1', status: 'done' }} onClose={vi.fn()} />);
        expect(screen.getByRole('heading', { name: /media pool/i })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: /timeline/i })).toBeInTheDocument();
        expect(screen.getByLabelText('Subtitle translation')).toBeInTheDocument();
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

    it('hydrates subtitles from the clip transcript endpoint when a legacy version has no subtitle track', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url) => {
            if (String(url).endsWith('/versions')) {
                return { ok: true, json: async () => ({ current_version_id: 'v3', versions: [{ version_id: 'v3', status: 'done' }] }) };
            }
            if (String(url).endsWith('/versions/v3')) {
                return { ok: true, json: async () => ({ version: { version_id: 'v3', status: 'done' }, manifest: { timeline: { source_video_url: '/videos/clip.mp4', trim: { start_sec: 0, end_sec: 4 } }, subtitle_tracks: [], layers: {} } }) };
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
});
