import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ClipRenderControls from './ClipRenderControls';

describe('ClipRenderControls', () => {
  it('lets a found clip start analysis and rendering', () => {
    const onRender = vi.fn();
    render(<ClipRenderControls status="found" onRender={onRender} />);

    fireEvent.click(screen.getByRole('button', { name: 'Analyze & Render' }));
    expect(onRender).toHaveBeenCalledTimes(1);
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
