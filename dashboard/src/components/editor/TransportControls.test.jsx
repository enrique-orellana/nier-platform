import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TransportControls from './TransportControls';

describe('TransportControls', () => {
    it('requests playback synchronously with the play click', () => {
        const onPlayingChange = vi.fn();
        const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
        render(<TransportControls currentFrame={0} durationFrames={300} fps={30} playing={false} onPlayingChange={onPlayingChange} onFrameChange={vi.fn()} zoom={1} onZoomChange={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'play' }));
        expect(onPlayingChange).toHaveBeenCalledWith(true);
        expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'openshorts:playback-request', detail: true }));
        dispatchSpy.mockRestore();
    });
});
