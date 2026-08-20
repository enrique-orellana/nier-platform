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

  it("requires a key because transcription is always remote", () => {
    expect(requiresAiApiKey("lmstudio")).toBe(true);
    expect(requiresAiApiKey("openai-codex")).toBe(true);
  });

  it("does not forward a provider key to Codex-only requests", () => {
    expect(shouldForwardApiKey("openai-codex")).toBe(false);
  });

  it("forwards the key to Codex requests that require remote transcription", () => {
    expect(
      shouldForwardApiKey("openai-codex", {
        requiresRemoteTranscription: true,
      }),
    ).toBe(true);
  });
});
