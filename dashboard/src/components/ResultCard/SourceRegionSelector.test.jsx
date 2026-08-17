import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SourceRegionSelector from './SourceRegionSelector';

function prepareStage() {
  const stage = screen.getByTestId('gameplay-region-stage');
  const video = screen.getByTestId('gameplay-region-video');
  Object.defineProperty(stage, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: 400, height: 225, right: 400, bottom: 225 }),
  });
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1600 });
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: 900 });
  fireEvent.loadedMetadata(video);
  return stage;
}

function pointerEvent(type, clientX, clientY) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'clientX', { value: clientX });
  Object.defineProperty(event, 'clientY', { value: clientY });
  return event;
}

describe('SourceRegionSelector', () => {
  it('restores, resets, and saves a gameplay region', () => {
    const onSave = vi.fn();
    render(
      <SourceRegionSelector
        videoUrl="/videos/source.mp4"
        title="Select Gameplay Area"
        description="Choose the gameplay panel."
        selectionLabel="Gameplay Area"
        regionTestId="gameplay-region"
        initialRegion={{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );

    const stage = prepareStage();
    expect(screen.getByTestId('gameplay-region-box').style.left).toBe('10%');
    fireEvent.click(screen.getByRole('button', { name: 'Reset selection' }));
    expect(screen.queryByTestId('gameplay-region-box')).not.toBeInTheDocument();

    fireEvent(stage, pointerEvent('pointerdown', 40, 30));
    fireEvent(window, pointerEvent('pointermove', 240, 180));
    fireEvent(window, pointerEvent('pointerup', 240, 180));
    fireEvent.click(screen.getByRole('button', { name: 'Save gameplay area' }));

    expect(onSave).toHaveBeenCalledWith({
      x: expect.closeTo(0.1, 3),
      y: expect.closeTo(0.133, 3),
      width: expect.closeTo(0.5, 3),
      height: expect.closeTo(0.667, 3),
    });
  });
});
