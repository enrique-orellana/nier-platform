import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import Standard916Preview from './Standard916Preview';

const gameplayRegion = { x: 0.35, y: 0.1, width: 0.55, height: 0.8 };

describe('Standard916Preview', () => {
  it('renders the selected gameplay region in a 9:16 preview', () => {
    render(
      <Standard916Preview
        videoUrl="/videos/source.mp4"
        startTime={12}
        endTime={24}
        gameplayRegion={gameplayRegion}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId('standard-916-preview')).toHaveAttribute('data-aspect', '9:16');
    expect(screen.getByTestId('standard-916-preview-video')).toHaveAttribute('src', '/videos/source.mp4');
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('changes and resets temporary zoom without changing clip metadata', () => {
    const onClose = vi.fn();
    render(
      <Standard916Preview
        videoUrl="/videos/source.mp4"
        startTime={12}
        endTime={24}
        gameplayRegion={gameplayRegion}
        onClose={onClose}
      />,
    );

    const video = screen.getByTestId('standard-916-preview-video');
    const initialTransform = video.style.transform;
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('110%')).toBeInTheDocument();
    expect(video.style.transform).not.toBe(initialTransform);
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(video.style.transform).toBe(initialTransform);
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('saves the adjusted zoom for final rendering', () => {
    const onSaveZoom = vi.fn().mockResolvedValue(1.1);
    render(
      <Standard916Preview
        videoUrl="/videos/source.mp4"
        gameplayRegion={gameplayRegion}
        onClose={vi.fn()}
        onSaveZoom={onSaveZoom}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save zoom' }));

    expect(onSaveZoom).toHaveBeenCalledWith(1.1);
  });
});
