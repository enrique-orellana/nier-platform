export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export const requiresAiApiKey = () => true;

export const shouldForwardApiKey = (
  provider = "",
  { requiresRemoteTranscription = false } = {},
) => {
  const normalizedProvider = String(provider || "")
    .trim()
    .toLowerCase();
  return requiresRemoteTranscription || normalizedProvider !== "openai-codex";
};

export const resolveAiBaseUrl = (provider, baseUrl = "") =>
  provider === "openrouter" ? OPENROUTER_BASE_URL : baseUrl;
