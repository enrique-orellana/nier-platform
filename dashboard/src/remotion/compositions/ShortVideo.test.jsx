import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const useRemotionEnvironmentMock = vi.hoisted(() => vi.fn());

vi.mock('remotion', () => ({
    AbsoluteFill: ({ children }) => <div>{children}</div>,
    Html5Video: (props) => <video data-testid="html5-video" {...props} />,
    OffthreadVideo: (props) => <video data-testid="offthread-video" {...props} />,
    useRemotionEnvironment: useRemotionEnvironmentMock,
    useCurrentFrame: () => 0,
    useVideoConfig: () => ({ fps: 30 }),
    interpolate: (value) => value,
    Sequence: ({ children }) => <>{children}</>,
    spring: () => 1,
}));

vi.mock('./Subtitles', () => ({ Subtitles: () => null }));
vi.mock('./HookOverlay', () => ({ HookOverlay: () => null }));

import { ShortVideo } from './ShortVideo';

describe('ShortVideo media source', () => {
    it('uses native HTML5 playback in the Remotion Player', () => {
        useRemotionEnvironmentMock.mockReturnValue({ isRendering: false });
        render(<ShortVideo videoUrl="/videos/clip.mp4" />);
        expect(screen.getByTestId('html5-video')).toHaveAttribute('src', '/videos/clip.mp4');
    });

    it('uses OffthreadVideo for frame-accurate rendering', () => {
        useRemotionEnvironmentMock.mockReturnValue({ isRendering: true });
        render(<ShortVideo videoUrl="/videos/clip.mp4" />);
        expect(screen.getByTestId('offthread-video')).toHaveAttribute('src', '/videos/clip.mp4');
    });
});
