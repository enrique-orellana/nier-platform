import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AISettingsPanel from './AISettingsPanel';

describe('AISettingsPanel', () => {
  it('hides lmstudio until discovery succeeds', () => {
    render(
      <AISettingsPanel
        aiProvider="gemini"
        aiBaseUrl=""
        apiKey=""
        aiQualityPreset="balanced"
        aiTextModel="auto"
        aiAnalyzeModel="auto"
        aiVisionModel="auto"
        aiImageModel=""
        lmStudioAvailable={false}
        lmStudioModels={{ textModels: [], visionModels: [] }}
        onDetectLmStudio={vi.fn()}
      />,
    );

    expect(screen.queryByRole('option', { name: /LM Studio/i })).not.toBeInTheDocument();
  });

  it('shows lmstudio when discovery state is available', () => {
    render(
      <AISettingsPanel
        aiProvider="lmstudio"
        aiBaseUrl="http://localhost:1234"
        apiKey=""
        aiQualityPreset="balanced"
        aiTextModel="google/gemma-4-27b"
        aiAnalyzeModel="google/gemma-4-27b"
        aiVisionModel="google/gemma-4-27b"
        aiImageModel=""
        lmStudioAvailable
        lmStudioModels={{
          textModels: [{ id: 'google/gemma-4-27b', label: 'Gemma 4 27B' }],
          visionModels: [{ id: 'google/gemma-4-27b', label: 'Gemma 4 27B' }],
        }}
        onDetectLmStudio={vi.fn()}
      />,
    );

    expect(screen.getByRole('option', { name: /LM Studio \(Detected\)/i })).toBeInTheDocument();
  });

  it('calls detect when the user requests LM Studio discovery', async () => {
    const onDetectLmStudio = vi.fn().mockResolvedValue({ available: false });

    render(
      <AISettingsPanel
        aiProvider="gemini"
        aiBaseUrl="http://localhost:1234"
        apiKey=""
        aiQualityPreset="balanced"
        aiTextModel="auto"
        aiAnalyzeModel="auto"
        aiVisionModel="auto"
        aiImageModel=""
        lmStudioAvailable={false}
        lmStudioModels={{ textModels: [], visionModels: [] }}
        onDetectLmStudio={onDetectLmStudio}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Detect LM Studio/i }));

    await waitFor(() => {
      expect(onDetectLmStudio).toHaveBeenCalled();
    });
  });
});
