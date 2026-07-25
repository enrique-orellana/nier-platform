import { render, waitFor } from '@testing-library/react';
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
});
