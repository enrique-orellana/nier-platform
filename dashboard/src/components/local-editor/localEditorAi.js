import { resolveAiBaseUrl } from "../../lib/aiProvider";

export const getLocalAiHeaders = () => {
  const provider = localStorage.getItem("ai_provider_v1") || "gemini";
  const apiKey =
    localStorage.getItem("ai_api_key_v1") ||
    localStorage.getItem("gemini_key") ||
    "";
  const headers = {
    "X-AI-Provider": provider,
    "X-AI-Model": localStorage.getItem("ai_text_model_v1") || "auto",
    "X-AI-Analyze-Model": localStorage.getItem("ai_analyze_model_v1") || "auto",
    "X-AI-Vision-Model": localStorage.getItem("ai_vision_model_v1") || "auto",
    "X-AI-Image-Model": localStorage.getItem("ai_image_model_v1") || "auto",
    "X-AI-Reasoning-Effort":
      localStorage.getItem("ai_text_effort_v1") || "auto",
    "X-AI-Analyze-Reasoning-Effort":
      localStorage.getItem("ai_analyze_effort_v1") || "auto",
    "X-AI-Vision-Reasoning-Effort":
      localStorage.getItem("ai_vision_effort_v1") || "auto",
    "X-AI-Transcription-Model":
      localStorage.getItem("ai_transcription_model_v1") ||
      "openai/whisper-large-v3",
    "X-AI-Transcription-Language":
      localStorage.getItem("ai_transcription_language_v1") || "auto",
  };
  const transcriptionOpenRouterProvider = (
    localStorage.getItem("ai_transcription_openrouter_provider_v1") || ""
  ).trim();
  if (transcriptionOpenRouterProvider) {
    headers["X-AI-Transcription-OpenRouter-Provider"] =
      transcriptionOpenRouterProvider;
  }
  const baseUrl = resolveAiBaseUrl(
    provider,
    localStorage.getItem("ai_base_url_v1") || "",
  );
  if (baseUrl) headers["X-AI-Base-Url"] = baseUrl;
  if (apiKey)
    headers[provider === "gemini" ? "X-Gemini-Key" : "X-AI-Api-Key"] = apiKey;
  return headers;
};

export const subtitleTextFromCues = (cues = []) =>
  cues
    .map((cue) => String(cue?.text || cue?.label || "").trim())
    .filter(Boolean)
    .join(" ");
