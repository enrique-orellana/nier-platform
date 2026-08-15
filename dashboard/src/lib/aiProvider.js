export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export const requiresAiApiKey = (provider = '', transcriptionProvider = '') => {
    const normalizedProvider = String(provider || '').trim().toLowerCase();
    const normalizedTranscriptionProvider = String(transcriptionProvider || '').trim().toLowerCase();
    return normalizedProvider === 'gemini'
        || normalizedProvider === 'openrouter'
        || normalizedTranscriptionProvider === 'openrouter';
};

export const shouldForwardApiKey = (provider = '', transcriptionProvider = '') => {
    const normalizedProvider = String(provider || '').trim().toLowerCase();
    const normalizedTranscriptionProvider = String(transcriptionProvider || '').trim().toLowerCase();
    return normalizedProvider !== 'openai-codex' || normalizedTranscriptionProvider === 'openrouter';
};

export const resolveAiBaseUrl = (provider, baseUrl = '') => (
    provider === 'openrouter' ? OPENROUTER_BASE_URL : baseUrl
);
