import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AISettingsPanel from './AISettingsPanel';

describe('AISettingsPanel', () => {
  it('shows OpenRouter as a cloud provider with a key-only setup', () => {
    render(
      <AISettingsPanel
        aiProvider="openrouter"
        aiBaseUrl=""
        apiKey=""
        aiQualityPreset="balanced"
        aiTextModel="openai/gpt-4o-mini"
        aiAnalyzeModel="openai/gpt-4o-mini"
        aiVisionModel="openai/gpt-4o-mini"
        aiImageModel=""
        transcriptionProvider="local"
        transcriptionModel="openai/whisper-large-v3"
        lmStudioAvailable={false}
        lmStudioModels={{ textModels: [], visionModels: [] }}
      />,
    );

    expect(screen.getAllByRole('option', { name: /OpenRouter/i })).toHaveLength(2);
    expect(screen.getByPlaceholderText('sk-or-v1-...')).toBeInTheDocument();
    expect(screen.getByLabelText('OpenRouter API key')).toBeInTheDocument();
    expect(screen.getByText(/only the API key is required/i)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /OpenShorts local/i })).toBeInTheDocument();
  });

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

  it('shows account-available Codex models and refreshes the catalog', () => {
    const onRefreshCodexModels = vi.fn();
    render(
      <AISettingsPanel
        aiProvider="openai-codex"
        aiBaseUrl=""
        apiKey=""
        aiQualityPreset="custom"
        aiTextModel="auto"
        aiAnalyzeModel="auto"
        aiVisionModel="auto"
        aiImageModel=""
        lmStudioAvailable={false}
        lmStudioModels={{ textModels: [], visionModels: [] }}
        codexStatus={{ connected: true, pending: false, requiresReconnect: false }}
        codexModels={{
          models: [{
            id: 'gpt-5.4',
            label: 'GPT-5.4',
            supportsVision: true,
            efforts: [{ id: 'high', label: 'High', description: 'Deep' }],
            defaultEffort: 'high',
          }],
          defaultModel: 'gpt-5.4',
        }}
        aiTextEffort="auto"
        aiAnalyzeEffort="auto"
        aiVisionEffort="auto"
        onRefreshCodexModels={onRefreshCodexModels}
        onConnectCodex={vi.fn()}
        onDisconnectCodex={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox', { name: /Text Model/i })).toHaveValue('auto');
    expect(screen.getByRole('combobox', { name: /Text Effort/i })).toHaveValue('auto');
    expect(screen.getAllByRole('option', { name: 'High' })).toHaveLength(3);
    expect(screen.getAllByRole('option', { name: 'GPT-5.4' })).toHaveLength(3);
    const refreshButton = screen.getByRole('button', { name: /Refresh models/i });
    expect(refreshButton).toBeEnabled();
    fireEvent.click(refreshButton);
    expect(onRefreshCodexModels).toHaveBeenCalled();
  });
});
