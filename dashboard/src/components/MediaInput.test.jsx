import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MediaInput from './MediaInput';

describe('MediaInput', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submits a Local MinIO URL without YouTube-specific UI', () => {
    const onProcess = vi.fn();
    render(<MediaInput onProcess={onProcess} isProcessing={false} targetClipCount={6} onTargetClipCountChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: /local minio url/i })).toBeInTheDocument();
    expect(screen.queryByText(/youtube url/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'http://localhost:9000/openshorts-media/source.mp4' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /generate clips/i }));

    expect(onProcess).toHaveBeenCalledWith({
      type: 'url',
      payload: 'http://localhost:9000/openshorts-media/source.mp4',
      acknowledged: true,
    });
  });
});
