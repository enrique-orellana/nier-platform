import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ClipMetadataPanel from './ClipMetadataPanel';

const clip = {
    start: 12,
    end: 51,
    video_title_for_youtube_short: 'La foto que según él parece Juan Guarnizo',
    video_description_for_tiktok: 'Una chica de Internet tiene una foto de cuerpo entero y le pide ayuda.',
};

describe('ClipMetadataPanel', () => {
    it('renders generated publishing metadata with boxed hashtags', () => {
        render(<ClipMetadataPanel clip={clip} />);

        expect(screen.getByRole('heading', { name: clip.video_title_for_youtube_short })).toBeInTheDocument();
        expect(screen.getByText('39s')).toBeInTheDocument();
        const hashtags = screen.getByRole('group', { name: 'Hashtags' });
        expect(hashtags).toHaveTextContent('#shorts');
        expect(hashtags).toHaveTextContent('#viral');
        expect(screen.getByText('YouTube Title')).toBeInTheDocument();
        expect(screen.getByText(clip.video_title_for_youtube_short, { selector: 'p' })).toBeInTheDocument();
        expect(screen.getByText(clip.video_description_for_tiktok)).toBeInTheDocument();
    });

    it('omits itself when no generated metadata is available', () => {
        const { container } = render(<ClipMetadataPanel clip={{}} />);
        expect(container.firstChild).toBeNull();
    });
});
