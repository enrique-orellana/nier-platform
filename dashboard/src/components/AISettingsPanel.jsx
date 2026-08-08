import React from 'react';

import { buildVisibleProviders } from '../lib/lmStudio';
import { codexStatusLabel } from '../lib/openaiCodex';

export default function AISettingsPanel({
  aiProvider,
  setAiProvider,
  apiKey,
  setApiKey,
  aiBaseUrl,
  setAiBaseUrl,
  aiQualityPreset,
  setAiQualityPreset,
  aiTextModel,
  setAiTextModel,
  aiAnalyzeModel,
  setAiAnalyzeModel,
  aiVisionModel,
  setAiVisionModel,
  aiImageModel,
  setAiImageModel,
  lmStudioAvailable,
  lmStudioModels,
  codexStatus = { connected: false, pending: false, requiresReconnect: false },
  codexPending = null,
  codexError = '',
  onConnectCodex = () => {},
  onDisconnectCodex = () => {},
}) {
  const providerOptions = buildVisibleProviders({ lmStudioAvailable });
  const isCodex = aiProvider === 'openai-codex';
  const textOptions = aiProvider === 'lmstudio' ? lmStudioModels.textModels : null;
  const visionOptions = aiProvider === 'lmstudio' ? lmStudioModels.visionModels : null;

  return (
    <div className="glass-panel p-6 mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">AI Provider</h2>
        <span className="text-[10px] bg-white/5 border border-white/5 px-2 py-0.5 rounded text-zinc-500 uppercase tracking-wider">Optional</span>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <label className="block">
          <span className="block text-sm text-zinc-400 mb-2">Provider</span>
          <select value={aiProvider} onChange={(e) => setAiProvider(e.target.value)} className="input-field">
            {providerOptions.includes('gemini') && <option value="gemini">Gemini (Cloud)</option>}
            {providerOptions.includes('lmstudio') && <option value="lmstudio">LM Studio (Local)</option>}
            {providerOptions.includes('openai-codex') && <option value="openai-codex">OpenAI Codex (ChatGPT)</option>}
          </select>
        </label>
        {isCodex ? (
          <div className="rounded-lg border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-zinc-300">ChatGPT connection</span>
              <span className="text-xs text-zinc-500">{codexStatusLabel(codexStatus)}</span>
            </div>
            {codexPending?.userCode && (
              <p className="mt-3 text-xs text-zinc-400">
                Enter this code at the verification page: <code className="text-white">{codexPending.userCode}</code>
              </p>
            )}
            {codexPending?.verificationUrl && (
              <a
                href={codexPending.verificationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs text-primary hover:underline"
              >
                Open ChatGPT verification page
              </a>
            )}
            {codexError && <p className="mt-3 text-xs text-red-400">{codexError}</p>}
            <button
              type="button"
              onClick={codexStatus.connected || codexStatus.pending ? onDisconnectCodex : onConnectCodex}
              className="btn-primary mt-4 py-2 px-4 text-sm disabled:opacity-50"
            >
              {codexStatus.connected
                ? 'Disconnect ChatGPT'
                : codexStatus.pending
                  ? 'Cancel connection'
                  : codexStatus.requiresReconnect
                    ? 'Reconnect ChatGPT'
                    : 'Connect ChatGPT'}
            </button>
          </div>
        ) : (
          <label className="block">
            <span className="block text-sm text-zinc-400 mb-2">API / Access Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="input-field"
              placeholder={aiProvider === 'gemini' ? 'AIza...' : 'Optional'}
            />
          </label>
        )}
        {!isCodex && (
          <label className="block">
            <span className="block text-sm text-zinc-400 mb-2">Base URL</span>
            <input
              type="text"
              value={aiBaseUrl}
              onChange={(e) => setAiBaseUrl(e.target.value)}
              className="input-field"
              placeholder="http://localhost:11434"
            />
            <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
              Enter the reachable endpoint for your cluster or host.
            </p>
            {aiProvider === 'lmstudio' && !aiBaseUrl.trim() && (
              <p className="mt-2 text-xs text-amber-400">
                Base URL required for local models.
              </p>
            )}
          </label>
        )}
        <label className="block">
          <span className="block text-sm text-zinc-400 mb-2">Quality Preset</span>
          <select
            value={aiQualityPreset}
            onChange={(e) => setAiQualityPreset(e.target.value)}
            className="input-field"
          >
            <option value="lite">Lite</option>
            <option value="balanced">Balanced</option>
            <option value="best">Best</option>
            <option value="custom">Custom</option>
          </select>
        </label>

        {isCodex ? (
          <>
            {['Text Model', 'Clip Analysis Model', 'Vision Model'].map((label) => (
              <label className="block" key={label}>
                <span className="block text-sm text-zinc-400 mb-2">{label}</span>
                <select value="auto" className="input-field" disabled>
                  <option value="auto">Auto (Codex default)</option>
                </select>
              </label>
            ))}
          </>
        ) : !textOptions ? (
          <>
            <label className="block">
              <span className="block text-sm text-zinc-400 mb-2">Text Model</span>
              <select
                value={aiTextModel}
                onChange={(e) => {
                  setAiQualityPreset('custom');
                  setAiTextModel(e.target.value);
                }}
                className="input-field"
              >
                <option value="auto">Auto (recommended)</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-sm text-zinc-400 mb-2">Clip Analysis Model</span>
              <select
                value={aiAnalyzeModel}
                onChange={(e) => {
                  setAiQualityPreset('custom');
                  setAiAnalyzeModel(e.target.value);
                }}
                className="input-field"
              >
                <option value="auto">Auto (recommended)</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-sm text-zinc-400 mb-2">Vision Model</span>
              <select
                aria-label="Vision Model"
                value={aiVisionModel}
                onChange={(e) => {
                  setAiQualityPreset('custom');
                  setAiVisionModel(e.target.value);
                }}
                className="input-field"
              >
                <option value="auto">Auto (recommended)</option>
                <option value="gemini-3.1-flash-image-preview">Gemini 3.1 Flash Image Preview</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-sm text-zinc-400 mb-2">Image Generation Model</span>
              <select
                value={aiImageModel}
                onChange={(e) => {
                  setAiQualityPreset('custom');
                  setAiImageModel(e.target.value);
                }}
                className="input-field"
              >
                <option value="">None (skip image generation)</option>
                <option value="gemini-2.5-flash-image">Gemini 2.5 Flash Image</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <label className="block">
              <span className="block text-sm text-zinc-400 mb-2">Text Model</span>
              <select value={aiTextModel} onChange={(e) => { setAiQualityPreset('custom'); setAiTextModel(e.target.value); }} className="input-field">
                {textOptions.map((model) => (
                  <option key={model.id} value={model.id}>{model.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-sm text-zinc-400 mb-2">Clip Analysis Model</span>
              <select value={aiAnalyzeModel} onChange={(e) => { setAiQualityPreset('custom'); setAiAnalyzeModel(e.target.value); }} className="input-field">
                {textOptions.map((model) => (
                  <option key={model.id} value={model.id}>{model.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-sm text-zinc-400 mb-2">Vision Model</span>
              <select aria-label="Vision Model" value={aiVisionModel} onChange={(e) => { setAiQualityPreset('custom'); setAiVisionModel(e.target.value); }} className="input-field" disabled={aiProvider === 'lmstudio' && visionOptions.length === 0}>
                {visionOptions.map((model) => (
                  <option key={model.id} value={model.id}>{model.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-sm text-zinc-400 mb-2">Image Generation Model</span>
              <select
                value={aiImageModel}
                onChange={(e) => { setAiQualityPreset('custom'); setAiImageModel(e.target.value); }}
                className="input-field"
              >
                <option value="">None (skip image generation)</option>
              </select>
            </label>
          </>
        )}
      </div>
    </div>
  );
}
