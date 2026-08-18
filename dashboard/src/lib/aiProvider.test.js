import { describe, expect, it } from "vitest";
import {
  requiresAiApiKey,
  resolveAiBaseUrl,
  shouldForwardApiKey,
} from "./aiProvider";

describe("AI provider URL resolution", () => {
  it("does not reuse a saved local endpoint for OpenRouter", () => {
    expect(
      resolveAiBaseUrl("openrouter", "http://host.docker.internal:1234"),
    ).toBe("https://openrouter.ai/api/v1");
  });

  it("preserves the configured endpoint for local providers", () => {
    expect(
      resolveAiBaseUrl("lmstudio", "http://host.docker.internal:1234"),
    ).toBe("http://host.docker.internal:1234");
  });

  it("requires a key when transcription uses OpenRouter with a local main provider", () => {
    expect(requiresAiApiKey("lmstudio", "openrouter")).toBe(true);
    expect(requiresAiApiKey("lmstudio", "local")).toBe(false);
  });

  it("forwards the key for OpenRouter transcription even with Codex as the main provider", () => {
    expect(shouldForwardApiKey("openai-codex", "openrouter")).toBe(true);
    expect(shouldForwardApiKey("openai-codex", "local")).toBe(false);
  });
});
