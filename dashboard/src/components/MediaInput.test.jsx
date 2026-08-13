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

    fireEvent.change(screen.getByPlaceholderText('http://localhost:9000/bucket/video.mp4'), { target: { value: 'http://localhost:9000/openshorts-media/source.mp4' } });
    fireEvent.change(screen.getByLabelText(/original source url/i), { target: { value: 'https://www.twitch.tv/videos/2842570758' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /generate clips/i }));

    expect(onProcess).toHaveBeenCalledWith({
      type: 'url',
      payload: 'http://localhost:9000/openshorts-media/source.mp4',
      sourceUrl: 'https://www.twitch.tv/videos/2842570758',
      acknowledged: true,
    });
  });

  it('submits the original source URL with an uploaded file', () => {
    const onProcess = vi.fn();
    const { container } = render(<MediaInput onProcess={onProcess} isProcessing={false} targetClipCount={6} onTargetClipCountChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /upload file/i }));
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [new File(['video'], 'source.mp4', { type: 'video/mp4' })] },
    });
    fireEvent.change(screen.getByLabelText(/original source url/i), { target: { value: 'https://www.youtube.com/watch?v=source123' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /generate clips/i }));

    expect(onProcess).toHaveBeenCalledWith(expect.objectContaining({
      type: 'file',
      sourceUrl: 'https://www.youtube.com/watch?v=source123',
      acknowledged: true,
    }));
  });
});
