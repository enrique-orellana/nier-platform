import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ClipRenderControls from './ClipRenderControls';

describe('ClipRenderControls', () => {
  it('opens the Standard 9:16 preview when gameplay is selected', () => {
    const onPreview = vi.fn();
    render(
      <ClipRenderControls
        status="found"
        gameplayRegion={{ x: 0.3, y: 0.1, width: 0.6, height: 0.8 }}
        onPreviewGameplayRegion={onPreview}
        onRender={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Preview 9:16' }));
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it('disables the preview until a gameplay area exists', () => {
    render(<ClipRenderControls status="found" onPreviewGameplayRegion={vi.fn()} onRender={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Preview 9:16' })).toBeDisabled();
    expect(screen.getByText('Select Gameplay Area First')).toBeInTheDocument();
  });

  it('lets a found clip start analysis and rendering', () => {
    const onRender = vi.fn();
    render(<ClipRenderControls status="found" onRender={onRender} />);

    fireEvent.click(screen.getByRole('button', { name: 'Analyze & Render' }));
    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it('requires a webcam area before Streamer Stack analysis', () => {
    const onSelect = vi.fn();
    render(
      <ClipRenderControls
        status="found"
        layoutFormat="streamer_stack"
        onRender={vi.fn()}
        onSelectWebcamRegion={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select Webcam Area' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Analyze & Render' })).toBeDisabled();
  });

  it('allows Streamer Stack rendering after a webcam area is saved', () => {
    const onRender = vi.fn();
    const onSelect = vi.fn();
    render(
      <ClipRenderControls
        status="found"
        layoutFormat="streamer_stack"
        webcamRegion={{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }}
        gameplayRegion={{ x: 0.4, y: 0.1, width: 0.5, height: 0.8 }}
        onRender={onRender}
        onSelectWebcamRegion={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Webcam Area' }));
    fireEvent.click(screen.getByRole('button', { name: 'Analyze & Render' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it('requires both regions before Streamer Stack rendering', () => {
    render(
      <ClipRenderControls
        status="found"
        layoutFormat="streamer_stack"
        webcamRegion={{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }}
        onRender={vi.fn()}
        onSelectWebcamRegion={vi.fn()}
        onSelectGameplayRegion={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Select Gameplay Area' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyze & Render' })).toBeDisabled();
  });

  it('defaults tracking off and reports the explicit toggle value', () => {
    const onTrackingChange = vi.fn();
    render(
      <ClipRenderControls
        status="found"
        layoutFormat="streamer_stack"
        webcamRegion={{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }}
        gameplayRegion={{ x: 0.3, y: 0.1, width: 0.6, height: 0.8 }}
        streamerTrackingEnabled={false}
        onTrackingChange={onTrackingChange}
        onRender={vi.fn()}
      />,
    );

    const toggle = screen.getByRole('checkbox', { name: 'Use Face/Person Tracking' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(onTrackingChange).toHaveBeenCalledWith(true);
  });

  it('shows independent progress without exposing another action', () => {
    render(<ClipRenderControls status="rendering" onRender={vi.fn()} />);

    expect(screen.getByText('Rendering…')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows ready state after the artifact is available', () => {
    render(<ClipRenderControls status="ready" onRender={vi.fn()} />);

    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('lets a failed clip retry', () => {
    const onRender = vi.fn();
    render(<ClipRenderControls status="failed" error="GPU error" onRender={onRender} />);

    expect(screen.getByText('GPU error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRender).toHaveBeenCalledTimes(1);
  });
});
