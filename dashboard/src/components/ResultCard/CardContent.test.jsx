import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import CardContent from './CardContent';

describe('CardContent', () => {
  it('shows the clip range against the master video timeline', () => {
    render(
      <CardContent
        clip={{
          start: 176,
          end: 204,
          video_title_for_youtube_short: 'A useful clip',
          video_description_for_tiktok: 'Caption',
        }}
        masterDuration={3577}
      />,
    );

    expect(screen.getByTestId('clip-source-range')).toHaveTextContent(
      'Start 02:56 · End 03:24 · Master 59:37',
    );
  });
});
