import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MediaInput from './MediaInput';

describe('MediaInput', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submits a selected MinIO object without YouTube-specific UI', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        bucket: 'youtube-downloads',
        objects: [{ key: 'videos/source.mp4', name: 'source.mp4', size: 12, last_modified: '2026-08-13T00:00:00Z' }],
      }),
    });
    const onProcess = vi.fn();
    render(<MediaInput onProcess={onProcess} isProcessing={false} targetClipCount={6} onTargetClipCountChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: /select from minio/i })).toBeInTheDocument();
    expect(screen.queryByText(/youtube url/i)).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /select source\.mp4/i }));
    fireEvent.change(screen.getByLabelText(/original source url/i), { target: { value: 'https://www.twitch.tv/videos/2842570758' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /generate clips/i }));

    expect(onProcess).toHaveBeenCalledWith({
      type: 'minio-object',
      payload: { bucket: 'youtube-downloads', key: 'videos/source.mp4' },
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
