import { HOOK_FONT_FAMILY } from "../../remotion/lib/hookVisual";
import {
  DEFAULT_SUBTITLE_STYLE,
  normalizeSubtitleStyle,
} from "./localEditorStyles";

export const EDITOR_PREFERENCES_STORAGE_KEY =
  "openshorts_local_editor_preferences_v1";
export const EDITOR_LAYOUT_STORAGE_KEY = "openshorts_local_editor_layout_v1";
export const EDITOR_PREFERENCES_VERSION = 1;

export const DEFAULT_HOOK_DEFAULTS = {
  position: "top",
  size: "M",
  entranceAnimation: "spring",
  durationMs: 2500,
  color: "#ffffff",
  fontSize: 48,
  background: "#111111",
  fontFamily: HOOK_FONT_FAMILY,
};

export const DEFAULT_EDITOR_PREFERENCES = {
  version: EDITOR_PREFERENCES_VERSION,
  subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE },
  subtitleLanguage: "en",
  hookDefaults: { ...DEFAULT_HOOK_DEFAULTS },
};

const HOOK_SETTING_KEYS = Object.keys(DEFAULT_HOOK_DEFAULTS);

const isRecord = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const cloneDefaultPreferences = () => ({
  version: EDITOR_PREFERENCES_VERSION,
  subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE },
  subtitleLanguage: "en",
  hookDefaults: { ...DEFAULT_HOOK_DEFAULTS },
});

const normalizeHookDefaults = (defaults = {}) => {
  const source = isRecord(defaults) ? defaults : {};
  return HOOK_SETTING_KEYS.reduce(
    (result, key) => {
      if (source[key] !== undefined) result[key] = source[key];
      return result;
    },
    { ...DEFAULT_HOOK_DEFAULTS },
  );
};

export const normalizeEditorPreferences = (preferences) => {
  if (
    !isRecord(preferences) ||
    Number(preferences.version) !== EDITOR_PREFERENCES_VERSION
  ) {
    return cloneDefaultPreferences();
  }
  return {
    version: EDITOR_PREFERENCES_VERSION,
    subtitleStyle: normalizeSubtitleStyle(
      isRecord(preferences.subtitleStyle) ? preferences.subtitleStyle : {},
    ),
    subtitleLanguage: String(
      preferences.subtitleLanguage || "en",
    ).toLowerCase(),
    hookDefaults: normalizeHookDefaults(preferences.hookDefaults),
  };
};

export const readEditorPreferences = () => {
  try {
    const stored = localStorage.getItem(EDITOR_PREFERENCES_STORAGE_KEY);
    return stored
      ? normalizeEditorPreferences(JSON.parse(stored))
      : cloneDefaultPreferences();
  } catch {
    return cloneDefaultPreferences();
  }
};

export const saveEditorPreferences = (preferences) => {
  try {
    localStorage.setItem(
      EDITOR_PREFERENCES_STORAGE_KEY,
      JSON.stringify(normalizeEditorPreferences(preferences)),
    );
  } catch {
    // Browser storage can be unavailable or full; editing remains usable in memory.
  }
};

export const readEditorLayout = () => {
  try {
    const stored = localStorage.getItem(EDITOR_LAYOUT_STORAGE_KEY);
    if (!stored) return { timelineHeight: null };
    const parsed = JSON.parse(stored);
    const timelineHeight = Number(parsed?.timelineHeight);
    const layout = {
      timelineHeight:
        Number.isFinite(timelineHeight) && timelineHeight > 0
          ? Math.round(timelineHeight)
          : null,
    };
    const inspectorWidth = Number(parsed?.inspectorWidth);
    if (Number.isFinite(inspectorWidth) && inspectorWidth > 0)
      layout.inspectorWidth = Math.round(inspectorWidth);
    return layout;
  } catch {
    return { timelineHeight: null };
  }
};

export const saveEditorLayout = (layout) => {
  const current = readEditorLayout();
  const next = { ...current };
  const timelineHeight = Number(layout?.timelineHeight);
  const inspectorWidth = Number(layout?.inspectorWidth);
  if (Number.isFinite(timelineHeight) && timelineHeight > 0)
    next.timelineHeight = Math.round(timelineHeight);
  if (Number.isFinite(inspectorWidth) && inspectorWidth > 0)
    next.inspectorWidth = Math.round(inspectorWidth);
  const storedLayout = {};
  if (next.timelineHeight > 0)
    storedLayout.timelineHeight = next.timelineHeight;
  if (next.inspectorWidth > 0)
    storedLayout.inspectorWidth = next.inspectorWidth;
  if (!Object.keys(storedLayout).length) return;
  try {
    localStorage.setItem(
      EDITOR_LAYOUT_STORAGE_KEY,
      JSON.stringify(storedLayout),
    );
  } catch {
    // Browser storage can be unavailable or full; editing remains usable in memory.
  }
};

export const updateEditorPreferencesFromState = (preferences, state = {}) => {
  const current = normalizeEditorPreferences(preferences);
  return {
    version: EDITOR_PREFERENCES_VERSION,
    subtitleStyle: normalizeSubtitleStyle(
      isRecord(state.subtitleStyle)
        ? state.subtitleStyle
        : current.subtitleStyle,
    ),
    subtitleLanguage: String(
      state.subtitleLanguage || current.subtitleLanguage || "en",
    ).toLowerCase(),
    hookDefaults: state.hook
      ? normalizeHookDefaults(state.hook)
      : { ...current.hookDefaults },
  };
};
