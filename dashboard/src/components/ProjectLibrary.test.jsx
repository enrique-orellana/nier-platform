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
              '1': { status: 'edited' },
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
      expect(loadedSelects[1]).toHaveValue('edited');
    });
    const selects = screen.getAllByLabelText('Clip status');
    expect(selects[0]).toHaveValue('reviewing');
    expect(selects[1]).toHaveValue('edited');

    fireEvent.change(selects[0], { target: { value: 'edited' } });

    await waitFor(() => expect(screen.getAllByLabelText('Clip status')[0]).toHaveValue('edited'));
    expect(screen.getAllByLabelText('Clip status')[1]).toHaveValue('edited');
    expect(screen.getByText(/2 edited/)).toBeInTheDocument();
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
