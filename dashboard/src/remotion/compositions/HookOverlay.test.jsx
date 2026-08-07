import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('remotion', () => ({
    AbsoluteFill: ({ children }) => <div>{children}</div>,
    Sequence: ({ children }) => <div>{children}</div>,
    interpolate: vi.fn(),
    spring: vi.fn(),
    staticFile: (file) => `/${file}`,
    useCurrentFrame: () => 0,
    useVideoConfig: () => ({ fps: 30, width: 360 }),
}));

import { HookOverlay } from './HookOverlay';

describe('HookOverlay visual contract', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders the same editable hook appearance used by the local preview', () => {
        render(<HookOverlay config={{
            text: 'Therapy Session Gone Wrong? 😱',
            position: 'top',
            size: 'M',
            entranceAnimation: 'none',
            displayDurationSec: 2,
            startMs: 0,
            endMs: 2000,
            color: '#ffffff',
            background: '#111111',
            fontSize: 48,
            fontFamily: 'Arial, Helvetica, sans-serif',
        }} />);

        const text = screen.getByText('Therapy Session Gone Wrong? 😱');
        const box = text.parentElement;
        expect(box).toHaveStyle({
            color: '#ffffff',
            backgroundColor: '#111111',
            fontFamily: 'Arial, Helvetica, sans-serif',
            fontSize: '18.46153846153846px',
        });
    });
});
