import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RemotionPreview from './RemotionPreview';

vi.mock('@remotion/player', () => ({
    Player: forwardRef(({ children }, ref) => {
        const listeners = useRef({}).current;
        useImperativeHandle(ref, () => ({
            addEventListener: (name, callback) => { listeners[name] = callback; },
            removeEventListener: vi.fn(),
            seekTo: vi.fn(),
            play: vi.fn(),
            pause: vi.fn(),
            emit: (name, detail) => listeners[name]?.({ detail }),
        }), [listeners]);
        return <button type="button" onClick={() => listeners.frameupdate?.({ detail: { frame: 180 } })}>player{children}</button>;
    }),
}));

describe('RemotionPreview', () => {
    it('forwards player frame events to the shared editor clock', () => {
        const onFrameChange = vi.fn();
        render(<RemotionPreview videoUrl="/video.mp4" onFrameChange={onFrameChange} />);
        fireEvent.click(screen.getByRole('button', { name: /player/i }));
        expect(onFrameChange).toHaveBeenCalledWith(180);
    });
});
