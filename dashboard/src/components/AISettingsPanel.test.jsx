import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import AISettingsPanel from './AISettingsPanel';

describe('AISettingsPanel', () => {
  it('shows lmstudio as an available local provider before discovery', () => {
    render(
      <AISettingsPanel
        aiProvider="lmstudio"
        aiBaseUrl=""
        apiKey=""
        aiQualityPreset="balanced"
        aiTextModel="auto"
        aiAnalyzeModel="auto"
        aiVisionModel="auto"
        aiImageModel=""
        lmStudioAvailable={false}
        lmStudioModels={{ textModels: [], visionModels: [] }}
      />,
    );

    expect(screen.getByRole('option', { name: /LM Studio \(Local\)/i })).toBeInTheDocument();
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
      />,
    );

    expect(screen.getByRole('option', { name: /LM Studio \(Local\)/i })).toBeInTheDocument();
  });

  it('does not require a separate discovery button', () => {
    render(
      <AISettingsPanel
        aiProvider="lmstudio"
        aiBaseUrl="http://localhost:1234"
        apiKey=""
        aiQualityPreset="balanced"
        aiTextModel="auto"
        aiAnalyzeModel="auto"
        aiVisionModel="auto"
        aiImageModel=""
        lmStudioAvailable={false}
        lmStudioModels={{ textModels: [], visionModels: [] }}
      />,
    );

    expect(screen.queryByRole('button', { name: /Detect LM Studio/i })).not.toBeInTheDocument();
  });
});
