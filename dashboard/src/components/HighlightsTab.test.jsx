import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HighlightsTab from './HighlightsTab';

vi.mock('./MinioObjectPicker', () => ({
  default: ({ onSelect }) => (
    <button type="button" onClick={() => onSelect({ bucket: 'youtube-downloads', key: 'videos/source.mp4' })}>
      Select source.mp4
    </button>
  ),
}));

describe('HighlightsTab', () => {
  const getAiHeaders = vi.fn(() => ({ 'Content-Type': 'application/json', 'X-AI-Provider': 'ollama' }));

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submits one selected MinIO video with the target and AI headers', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ projects: [] }) });
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'project-1', name: 'Source', status: 'queued', job: { id: 'job-1', status: 'queued', logs: [] } }) });
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ projects: [] }) });

    render(<HighlightsTab getAiHeaders={getAiHeaders} aiProvider="ollama" />);
    fireEvent.click(screen.getByRole('button', { name: /select source.mp4/i }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /create project/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/highlights/projects', expect.objectContaining({ method: 'POST' })));
    const request = fetch.mock.calls[1][1];
    expect(request.headers).toEqual(expect.objectContaining({ 'X-AI-Provider': 'ollama' }));
    expect(JSON.parse(request.body)).toEqual(expect.objectContaining({
      name: '',
      source_object: { bucket: 'youtube-downloads', key: 'videos/source.mp4' },
      min_minutes: 12,
      ideal_minutes: 20,
      acknowledged: true,
    }));
  });

  it('stops an active job and displays a completed result', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ projects: [{ id: 'project-1', name: 'Source', status: 'processing', job: { id: 'job-1', status: 'processing', logs: ['Analyzing'] } }] }) });
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'project-1', name: 'Source', status: 'cancelled', job: { id: 'job-1', status: 'cancelled', logs: ['Cancelled'], error: 'Job cancelled.' } }) });
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ projects: [] }) });

    render(<HighlightsTab getAiHeaders={getAiHeaders} aiProvider="ollama" />);
    expect(await screen.findByText('Analyzing')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    expect(await screen.findByText('cancelled')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/highlights/projects/project-1/cancel', expect.objectContaining({ method: 'POST' }));
  });

  it('renders completed video and manifest links from persisted results', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        projects: [{
          id: 'project-2', name: 'Completed project',
          source_object: { bucket: 'youtube-downloads', key: 'source.mp4' }, min_minutes: 12, ideal_minutes: 20,
          job: {
            id: 'job-2',
          status: 'completed',
          logs: ['Ready'],
          result: { video_url: '/videos/job-2/highlights.mp4', manifest_url: '/videos/job-2/manifest.json' },
          },
        }],
      }),
    });

    render(<HighlightsTab getAiHeaders={getAiHeaders} aiProvider="ollama" />);
    expect(await screen.findByRole('link', { name: /download highlights/i })).toHaveAttribute('href', '/videos/job-2/highlights.mp4');
    expect(screen.getByRole('link', { name: /view manifest/i })).toHaveAttribute('href', '/videos/job-2/manifest.json');
  });
});
