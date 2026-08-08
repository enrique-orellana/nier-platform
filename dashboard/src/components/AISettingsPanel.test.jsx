import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

  it('shows Connect ChatGPT for a disconnected Codex provider', () => {
    render(
      <AISettingsPanel
        aiProvider="openai-codex"
        aiBaseUrl=""
        apiKey=""
        aiQualityPreset="balanced"
        aiTextModel="auto"
        aiAnalyzeModel="auto"
        aiVisionModel="auto"
        aiImageModel=""
        lmStudioAvailable={false}
        lmStudioModels={{ textModels: [], visionModels: [] }}
        codexStatus={{ connected: false, pending: false, requiresReconnect: false }}
        onConnectCodex={vi.fn()}
        onDisconnectCodex={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Connect ChatGPT/i })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('AIza...')).not.toBeInTheDocument();
    expect(screen.queryByText(/Image Generation Model/i)).not.toBeInTheDocument();
  });

  it('shows the connected Codex state and disconnect action', () => {
    render(
      <AISettingsPanel
        aiProvider="openai-codex"
        aiBaseUrl=""
        apiKey=""
        aiQualityPreset="balanced"
        aiTextModel="auto"
        aiAnalyzeModel="auto"
        aiVisionModel="auto"
        aiImageModel=""
        lmStudioAvailable={false}
        lmStudioModels={{ textModels: [], visionModels: [] }}
        codexStatus={{ connected: true, pending: false, requiresReconnect: false }}
        onConnectCodex={vi.fn()}
        onDisconnectCodex={vi.fn()}
      />,
    );

    expect(screen.getByText(/Connected to ChatGPT/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Disconnect ChatGPT/i })).toBeInTheDocument();
  });

  it('shows the device code while Codex connection is pending', () => {
    const onDisconnectCodex = vi.fn();
    render(
      <AISettingsPanel
        aiProvider="openai-codex"
        aiBaseUrl=""
        apiKey=""
        aiQualityPreset="balanced"
        aiTextModel="auto"
        aiAnalyzeModel="auto"
        aiVisionModel="auto"
        aiImageModel=""
        lmStudioAvailable={false}
        lmStudioModels={{ textModels: [], visionModels: [] }}
        codexStatus={{ connected: false, pending: true, requiresReconnect: false }}
        codexPending={{ userCode: 'ABCD-EFGH' }}
        onConnectCodex={vi.fn()}
        onDisconnectCodex={onDisconnectCodex}
      />,
    );

    expect(screen.getByText('ABCD-EFGH')).toBeInTheDocument();
    const cancelButton = screen.getByRole('button', { name: /Cancel connection/i });
    expect(cancelButton).toBeEnabled();
    fireEvent.click(cancelButton);
    expect(onDisconnectCodex).toHaveBeenCalled();
  });
});
