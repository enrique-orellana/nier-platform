import { beforeEach, describe, expect, it } from "vitest";
import {
  readActiveSourceSubtitleTrackId,
  saveActiveSourceSubtitleTrackId,
} from "./sourceTranscriptTrackPreference";

describe("source transcript active track preference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("restores the selected translation for the same project", () => {
    const tracks = [
      { id: "original" },
      { id: "translation-it" },
      { id: "translation-en" },
    ];

    saveActiveSourceSubtitleTrackId("project-1", "translation-it");

    expect(readActiveSourceSubtitleTrackId("project-1", tracks)).toBe(
      "translation-it",
    );
    expect(readActiveSourceSubtitleTrackId("project-2", tracks)).toBe(
      "original",
    );
  });

  it("falls back to the original track if the saved translation no longer exists", () => {
    saveActiveSourceSubtitleTrackId("project-1", "translation-it");

    expect(
      readActiveSourceSubtitleTrackId("project-1", [{ id: "original" }]),
    ).toBe("original");
  });
});
