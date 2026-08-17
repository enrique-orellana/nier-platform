import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ClipSourceRangeEditor from './ClipSourceRangeEditor';

describe('ClipSourceRangeEditor', () => {
  it('lets the user extend or compact the clip and saves the new range', () => {
    const onSave = vi.fn();

    render(
      <ClipSourceRangeEditor
        isOpen
        clip={{ start: 176, end: 204 }}
        masterDuration={3577}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId('clip-range-start'), { target: { value: '150' } });
    fireEvent.change(screen.getByTestId('clip-range-end'), { target: { value: '230' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save clip range' }));

    expect(onSave).toHaveBeenCalledWith({ start: 150, end: 230 });
  });

  it('keeps the range inside the master and preserves a one-second minimum', () => {
    render(
      <ClipSourceRangeEditor
        isOpen
        clip={{ start: 176, end: 204 }}
        masterDuration={220}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId('clip-range-end'), { target: { value: '176' } });
    expect(screen.getByTestId('clip-range-end')).toHaveValue('177');

    fireEvent.change(screen.getByTestId('clip-range-end'), { target: { value: '220' } });
    fireEvent.change(screen.getByTestId('clip-range-start'), { target: { value: '220' } });
    expect(screen.getByTestId('clip-range-start')).toHaveValue('219');
  });
});
