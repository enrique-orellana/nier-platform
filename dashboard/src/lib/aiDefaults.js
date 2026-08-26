export const DEFAULT_CODEX_MODEL = "gpt-5.6-luna";
export const DEFAULT_CODEX_EFFORT = "high";
export const DEFAULT_TRANSCRIPTION_MODEL = "openai/whisper-large-v3-turbo";
export const DEFAULT_TRANSCRIPTION_LANGUAGE = "auto";
export const DEFAULT_TRANSCRIPTION_OPENROUTER_PROVIDER = "deepinfra";

export const defaultAiModelForProvider = (provider) =>
  provider === "openai-codex" ? DEFAULT_CODEX_MODEL : "auto";

export const defaultReasoningEffortForProvider = (provider) =>
  provider === "openai-codex" ? DEFAULT_CODEX_EFFORT : "auto";
