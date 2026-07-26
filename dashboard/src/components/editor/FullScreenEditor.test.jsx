import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FullScreenEditor from './FullScreenEditor';

vi.mock('../../components/RemotionPreview', () => ({ default: ({ currentFrame = 0 }) => <div data-testid="remotion-player-frame">{currentFrame}</div> }));

const manifest = {
    timeline: { source_video_url: 'https://example.test/video.mp4', trim: { start_sec: 0, end_sec: 10 } },
    layers: { hook: null, subtitles: null, effects: null },
    subtitle_tracks: [],
};

describe('FullScreenEditor', () => {
    it('renders the editor workspace and advances the preview one frame', () => {
        render(<FullScreenEditor jobId="job" clipIndex={0} clip={{ output_fps: 30, output_width: 1080, output_height: 1920, video_url: manifest.timeline.source_video_url }} initialManifest={manifest} initialVersion={{ version_id: 'v1', status: 'done' }} onClose={vi.fn()} />);
        expect(screen.getByRole('heading', { name: /media pool/i })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: /timeline/i })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /next frame/i }));
        expect(screen.getByTestId('remotion-player-frame')).toHaveTextContent('1');
    });
});
