import { describe, expect, it } from "vitest";

import {
  DEFAULT_CODEX_EFFORT,
  DEFAULT_CODEX_MODEL,
  DEFAULT_TRANSCRIPTION_LANGUAGE,
  DEFAULT_TRANSCRIPTION_MODEL,
  DEFAULT_TRANSCRIPTION_OPENROUTER_PROVIDER,
  defaultAiModelForProvider,
  defaultReasoningEffortForProvider,
} from "./aiDefaults";

describe("AI defaults", () => {
  it("matches the connected Codex and transcription defaults", () => {
    expect(DEFAULT_CODEX_MODEL).toBe("gpt-5.6-luna");
    expect(DEFAULT_CODEX_EFFORT).toBe("high");
    expect(DEFAULT_TRANSCRIPTION_MODEL).toBe("openai/whisper-large-v3-turbo");
    expect(DEFAULT_TRANSCRIPTION_LANGUAGE).toBe("auto");
    expect(DEFAULT_TRANSCRIPTION_OPENROUTER_PROVIDER).toBe("deepinfra");
  });

  it("uses Codex defaults only for the Codex provider", () => {
    expect(defaultAiModelForProvider("openai-codex")).toBe("gpt-5.6-luna");
    expect(defaultReasoningEffortForProvider("openai-codex")).toBe("high");
    expect(defaultAiModelForProvider("openrouter")).toBe("auto");
    expect(defaultReasoningEffortForProvider("openrouter")).toBe("auto");
  });
});
