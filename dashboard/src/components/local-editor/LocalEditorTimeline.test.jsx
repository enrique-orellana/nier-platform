import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LocalEditorTimeline from './LocalEditorTimeline';

describe('LocalEditorTimeline', () => {
    it('extends the timeline canvas for precise subtitle timing', () => {
        render(<LocalEditorTimeline durationMs={30000} subtitleCues={[{ id: 'cue-1', text: 'Caption', startMs: 1000, endMs: 2000 }]} onSeek={vi.fn()} />);

        expect(screen.getByTestId('local-editor-timeline-scroll')).toHaveClass('overflow-x-auto');
        expect(screen.getByTestId('local-editor-timeline-canvas')).toHaveStyle({ width: '2544px' });
        expect(screen.getByRole('button', { name: 'Caption' })).toBeInTheDocument();
    });

    it('keeps short adjacent subtitle cues at their actual timeline widths', () => {
        render(<LocalEditorTimeline durationMs={10000} subtitleCues={[
            { id: 'cue-1', text: 'One', startMs: 1000, endMs: 1050 },
            { id: 'cue-2', text: 'Two', startMs: 1050, endMs: 1100 },
        ]} onSeek={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'One' })).not.toHaveStyle({ minWidth: '18px' });
        expect(screen.getByRole('button', { name: 'Two' })).not.toHaveStyle({ minWidth: '18px' });
        expect(screen.getByRole('button', { name: 'One' })).toHaveStyle({ width: '0.5%' });
        expect(screen.getByRole('button', { name: 'Two' })).toHaveStyle({ width: '0.5%' });
    });
});
