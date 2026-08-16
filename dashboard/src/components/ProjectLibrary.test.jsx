import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ProjectLibrary from './ProjectLibrary';

describe('ProjectLibrary', () => {
  it('does not nest the delete button inside the project card control', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          projects: [
            {
              job_id: 'job-1',
              title: 'Test project',
              clips: [{ video_url: '/videos/job-1/clip.mp4' }],
              clip_count: 1,
            },
          ],
        }),
      }),
    );

    const { container } = render(<ProjectLibrary />);

    await waitFor(() => {
      expect(container.querySelector('[title="Delete Project"]')).toBeTruthy();
    });

    expect(container.querySelectorAll('button button')).toHaveLength(0);
  });

  it('routes external history videos through the same-origin video proxy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          projects: [
            {
              job_id: 'job-2',
              title: 'External project',
              clips: [{ video_url: 'http://minio.example/job-2/clip.mp4?signature=old' }],
              clip_count: 1,
            },
          ],
        }),
      }),
    );

    render(<ProjectLibrary />);

    await waitFor(() => {
      const video = document.querySelector('video');
      expect(video?.getAttribute('src')).toContain('/api/video-proxy/clip.mp4?url=');
    });
  });

  it('previews an unrendered candidate from the stored source video', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        if (String(url).includes('/api/projects/history')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              projects: [{
                job_id: 'job-3',
                title: 'Candidate project',
                clips: [{
                  index: 0,
                  start: 12,
                  end: 20,
                  source_video_url: '/videos/job-3/source.mp4',
                  render_status: 'found',
                }],
                clip_count: 1,
              }],
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ clips: {} }) });
      }),
    );

    render(<ProjectLibrary projectId="job-3" />);

    await waitFor(() => {
      expect(document.querySelector('video')?.getAttribute('src')).toBe('/videos/job-3/source.mp4');
    });
  });

  it('queues rendering from a historical candidate card', async () => {
    const fetchMock = vi.fn((url, options = {}) => {
      if (String(url).includes('/api/projects/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            projects: [{
              job_id: 'job-4',
              title: 'Candidate project',
              clips: [{
                index: 0,
                start: 12,
                end: 20,
                source_video_url: '/videos/job-4/source.mp4',
                render_status: 'found',
              }],
              clip_count: 1,
            }],
          }),
        });
      }
      if (String(url).includes('/api/jobs/job-4/clips/0/render')) {
        expect(options.method).toBe('POST');
        return Promise.resolve({ ok: true, json: async () => ({ job_id: 'render-4' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ clips: {} }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ProjectLibrary projectId="job-4" />);

    const button = await screen.findByRole('button', { name: 'Analyze & Render' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/jobs/job-4/clips/0/render',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('saves a webcam region per Streamer Stack clip before enabling render', async () => {
    const fetchMock = vi.fn((url, options = {}) => {
      if (String(url).includes('/api/projects/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            projects: [{
              job_id: 'job-5',
              title: 'Streamer project',
              clips: [{
                index: 0,
                start: 12,
                end: 20,
                source_video_url: '/videos/job-5/source.mp4',
                layout_format: 'streamer_stack',
                render_status: 'found',
              }],
              clip_count: 1,
            }],
          }),
        });
      }
      if (String(url).includes('/api/jobs/job-5/clips/0/webcam-region')) {
        expect(options.method).toBe('PATCH');
        expect(JSON.parse(options.body).webcam_region).toEqual(expect.objectContaining({ width: expect.any(Number) }));
        return Promise.resolve({
          ok: true,
          json: async () => ({ webcam_region: { x: 0.05, y: 0.1, width: 0.25, height: 0.4 } }),
        });
      }
      if (String(url).includes('/api/jobs/job-5/clips/0/render')) {
        expect(options.method).toBe('POST');
        return Promise.resolve({ ok: true, json: async () => ({ job_id: 'render-5' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ clips: {} }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ProjectLibrary projectId="job-5" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Select Webcam Area' }));
    expect(screen.getByRole('button', { name: 'Analyze & Render' })).toBeDisabled();

    const stage = screen.getByTestId('webcam-region-stage');
    const video = screen.getByTestId('webcam-region-video');
    Object.defineProperty(stage, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 400, height: 225, right: 400, bottom: 225 }),
    });
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1600 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 900 });
    fireEvent.loadedMetadata(video);
    const down = new Event('pointerdown', { bubbles: true });
    Object.defineProperty(down, 'clientX', { value: 40 });
    Object.defineProperty(down, 'clientY', { value: 30 });
    fireEvent(stage, down);
    const move = new Event('pointermove');
    Object.defineProperty(move, 'clientX', { value: 180 });
    Object.defineProperty(move, 'clientY', { value: 150 });
    fireEvent(window, move);
    fireEvent(window, new Event('pointerup'));
    fireEvent.click(screen.getByRole('button', { name: 'Save webcam area' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/jobs/job-5/clips/0/webcam-region',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Analyze & Render' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Analyze & Render' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/jobs/job-5/clips/0/render',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('loads and updates a status independently for each clip', async () => {
    const fetchMock = vi.fn((url, options = {}) => {
      if (String(url).includes('/api/projects/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            projects: [{
              job_id: 'job-1',
              title: 'Test project',
              clips: [
                { video_url: '/videos/job-1/clip-1.mp4', index: 0 },
                { video_url: '/videos/job-1/clip-2.mp4', index: 1 },
              ],
              clip_count: 2,
            }],
          }),
        });
      }
      if (String(url).includes('/api/projects/job-1/statuses')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            version: 1,
            clips: {
              '0': { status: 'reviewing' },
              '1': { status: 'discarded' },
            },
          }),
        });
      }
      if (String(url).includes('/api/projects/job-1/clips/0/status')) {
        expect(options.method).toBe('PATCH');
        expect(JSON.parse(options.body)).toEqual({ status: 'edited' });
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: 'edited', updated_at: '2026-08-12T18:30:00Z' }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ clips: [] }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ProjectLibrary projectId="job-1" />);

    await waitFor(() => {
      const loadedSelects = screen.getAllByLabelText('Clip status');
      expect(loadedSelects).toHaveLength(2);
      expect(loadedSelects[0]).toHaveValue('reviewing');
      expect(loadedSelects[1]).toHaveValue('discarded');
    });
    const selects = screen.getAllByLabelText('Clip status');
    expect(selects[0]).toHaveValue('reviewing');
    expect(selects[1]).toHaveValue('discarded');

    fireEvent.change(selects[0], { target: { value: 'edited' } });

    await waitFor(() => expect(screen.getAllByLabelText('Clip status')[0]).toHaveValue('edited'));
    expect(screen.getAllByLabelText('Clip status')[1]).toHaveValue('discarded');
    expect(screen.getByText(/1 edited · 1 discarded/)).toBeInTheDocument();
  });

  it('rolls back an optimistic status update when saving fails', async () => {
    const fetchMock = vi.fn((url) => {
      if (String(url).includes('/api/projects/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            projects: [{
              job_id: 'job-1',
              title: 'Test project',
              clips: [{ video_url: '/videos/job-1/clip-1.mp4', index: 0 }],
              clip_count: 1,
            }],
          }),
        });
      }
      if (String(url).includes('/api/projects/job-1/statuses')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ version: 1, clips: { '0': { status: 'reviewing' } } }),
        });
      }
      if (String(url).includes('/api/projects/job-1/clips/0/status')) {
        return Promise.resolve({ ok: false, text: async () => 'save failed' });
      }
      return Promise.resolve({ ok: true, json: async () => ({ clips: [] }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ProjectLibrary projectId="job-1" />);

    await waitFor(() => expect(screen.getByLabelText('Clip status')).toHaveValue('reviewing'));
    fireEvent.change(screen.getByLabelText('Clip status'), { target: { value: 'edited' } });

    await waitFor(() => expect(screen.getByLabelText('Clip status')).toHaveValue('reviewing'));
    expect(screen.getByText('save failed')).toBeInTheDocument();
  });
});
