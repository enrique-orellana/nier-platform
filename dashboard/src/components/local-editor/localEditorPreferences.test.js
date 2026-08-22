import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_PREFERENCES,
  EDITOR_LAYOUT_STORAGE_KEY,
  EDITOR_PREFERENCES_STORAGE_KEY,
  readEditorLayout,
  readEditorPreferences,
  saveEditorLayout,
  saveEditorPreferences,
  updateEditorPreferencesFromState,
} from "./localEditorPreferences";

describe("local editor preferences", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns built-in defaults when no preferences have been saved", () => {
    expect(readEditorPreferences()).toEqual(DEFAULT_EDITOR_PREFERENCES);
  });

  it("round trips the remembered local editor layout", () => {
    saveEditorLayout({ timelineHeight: 352, inspectorWidth: 420 });

    expect(readEditorLayout()).toEqual({
      timelineHeight: 352,
      inspectorWidth: 420,
    });
  });

  it("ignores malformed or unusable layout data", () => {
    localStorage.setItem(EDITOR_LAYOUT_STORAGE_KEY, "{bad json");
    expect(readEditorLayout()).toEqual({ timelineHeight: null });

    localStorage.setItem(
      EDITOR_LAYOUT_STORAGE_KEY,
      JSON.stringify({ timelineHeight: -10 }),
    );
    expect(readEditorLayout()).toEqual({ timelineHeight: null });
  });

  it("round trips remembered settings and fills omitted values from defaults", () => {
    saveEditorPreferences({
      version: 1,
      subtitleStyle: { position: "top", fontSize: 36 },
      subtitleLanguage: "ES",
      hookDefaults: { position: "center", size: "L" },
    });

    expect(readEditorPreferences()).toEqual({
      ...DEFAULT_EDITOR_PREFERENCES,
      subtitleStyle: {
        ...DEFAULT_EDITOR_PREFERENCES.subtitleStyle,
        position: "top",
        fontSize: 36,
      },
      subtitleLanguage: "es",
      hookDefaults: {
        ...DEFAULT_EDITOR_PREFERENCES.hookDefaults,
        position: "center",
        size: "L",
      },
    });
  });

  it("falls back safely for malformed or incompatible stored data", () => {
    localStorage.setItem(EDITOR_PREFERENCES_STORAGE_KEY, "{bad json");
    expect(readEditorPreferences()).toEqual(DEFAULT_EDITOR_PREFERENCES);

    localStorage.setItem(
      EDITOR_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ version: 2, subtitleLanguage: "fr" }),
    );
    expect(readEditorPreferences()).toEqual(DEFAULT_EDITOR_PREFERENCES);
  });

  it("remembers settings without persisting subtitle or hook content", () => {
    const next = updateEditorPreferencesFromState(DEFAULT_EDITOR_PREFERENCES, {
      subtitleCues: [{ id: "cue-1", text: "private subtitle" }],
      subtitleStyle: { position: "middle", fontSize: 40 },
      subtitleLanguage: "fr",
      hook: {
        id: "hook",
        text: "private hook text",
        startMs: 300,
        endMs: 1800,
        position: "bottom",
        size: "S",
        entranceAnimation: "fade",
        durationMs: 1500,
        color: "#ff0000",
        fontSize: 52,
        background: "#000000",
        fontFamily: "Arial",
      },
    });

    expect(next.subtitleStyle).toMatchObject({
      position: "middle",
      fontSize: 40,
    });
    expect(next.subtitleLanguage).toBe("fr");
    expect(next.hookDefaults).toMatchObject({
      position: "bottom",
      size: "S",
      entranceAnimation: "fade",
      durationMs: 1500,
      color: "#ff0000",
      fontSize: 52,
      background: "#000000",
      fontFamily: "Arial",
    });
    expect(next.hookDefaults).not.toHaveProperty("id");
    expect(next.hookDefaults).not.toHaveProperty("text");
    expect(next.hookDefaults).not.toHaveProperty("startMs");
    expect(next.hookDefaults).not.toHaveProperty("endMs");
    expect(JSON.stringify(next)).not.toContain("private subtitle");
    expect(JSON.stringify(next)).not.toContain("private hook text");
  });
});
