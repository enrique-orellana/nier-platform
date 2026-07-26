import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SubtitleTranslationPanel from './SubtitleTranslationPanel';

describe('SubtitleTranslationPanel', () => {
    it('keeps original and adds a translated track', async () => {
        const onTrackAdded = vi.fn();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ track: { id: 'es', label: 'ES' }, manifest: { subtitle_tracks: [] } }),
        }));
        render(
            <SubtitleTranslationPanel
                jobId="job"
                clipIndex={0}
                versionId="v1"
                tracks={[{ id: 'original', language: 'en', label: 'Original', cues: [{ text: 'One' }, { text: 'Two' }] }]}
                activeTrackId="original"
                aiHeaders={{ 'X-AI-Api-Key': 'test' }}
                onTrackAdded={onTrackAdded}
                onSelectTrack={vi.fn()}
            />,
        );

        expect(screen.getByText(/Translates all 2 cues in the selected track/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Translate entire track' }));
        await waitFor(() => expect(onTrackAdded).toHaveBeenCalled());
        expect(screen.getByRole('option', { name: 'Original' })).toBeInTheDocument();
    });

    it('offers English as a translation target for non-English source tracks', () => {
        render(
            <SubtitleTranslationPanel
                jobId="job"
                clipIndex={0}
                versionId="v1"
                tracks={[{ id: 'original', language: 'es', label: 'Original' }]}
                activeTrackId="original"
                onTrackAdded={vi.fn()}
                onSelectTrack={vi.fn()}
            />,
        );

        expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument();
    });
});
