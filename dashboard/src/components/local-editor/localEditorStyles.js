export const HOOK_SIZE_OPTIONS = [
  { value: "S", label: "Small" },
  { value: "M", label: "Medium" },
  { value: "L", label: "Large" },
];

export const HOOK_ENTRANCE_OPTIONS = [
  { value: "spring", label: "Bounce" },
  { value: "fade", label: "Fade" },
  { value: "slide-up", label: "Slide Up" },
  { value: "none", label: "None" },
];

export const HOOK_SIZE_SCALE = { S: 0.8, M: 1, L: 1.3 };

export const SUBTITLE_FONT_OPTIONS = [
  "Verdana",
  "Arial",
  "Impact",
  "Helvetica",
  "Georgia",
  "Courier New",
];
export const SUBTITLE_COLOR_PRESETS = [
  { color: "#FFFFFF", label: "White" },
  { color: "#FFFF00", label: "Yellow" },
  { color: "#00FFFF", label: "Cyan" },
  { color: "#00FF00", label: "Green" },
  { color: "#FF0000", label: "Red" },
  { color: "#FF69B4", label: "Pink" },
];
export const SUBTITLE_HIGHLIGHT_PRESETS = [
  { color: "#FFDD00", label: "Gold" },
  { color: "#FF4444", label: "Red" },
  { color: "#00FF88", label: "Green" },
  { color: "#00BBFF", label: "Blue" },
  { color: "#FF69B4", label: "Pink" },
];
export const SUBTITLE_ANIMATION_OPTIONS = [
  { value: "pop", label: "Pop" },
  { value: "word-highlight", label: "Glow" },
  { value: "karaoke", label: "Karaoke" },
  { value: "none", label: "None" },
];

export const SUBTITLE_STYLE_TEMPLATES = [
  {
    id: "bold-highlight",
    label: "Bold highlight",
    description: "Punchy keyword emphasis",
    ariaLabel: "Apply Bold highlight subtitle style",
    preview: {
      backgroundColor: "#20202a",
      color: "#FFFFFF",
      accent: "#FFDD00",
    },
    style: {
      position: "bottom",
      fontFamily: "Impact",
      fontSize: 30,
      fontColor: "#FFFFFF",
      highlightColor: "#FFDD00",
      borderColor: "#000000",
      borderWidth: 3,
      bgColor: "#000000",
      bgOpacity: 0,
      animation: "pop",
    },
  },
  {
    id: "clean",
    label: "Clean",
    description: "Simple and readable",
    ariaLabel: "Apply Clean subtitle style",
    preview: {
      backgroundColor: "#2a3542",
      color: "#FFFFFF",
      accent: "#FFFFFF",
    },
    style: {
      position: "bottom",
      fontFamily: "Verdana",
      fontSize: 24,
      fontColor: "#FFFFFF",
      highlightColor: "#FFFFFF",
      borderColor: "#000000",
      borderWidth: 1,
      bgColor: "#000000",
      bgOpacity: 0,
      animation: "none",
    },
  },
  {
    id: "karaoke",
    label: "Karaoke",
    description: "Word-by-word color",
    ariaLabel: "Apply Karaoke subtitle style",
    preview: {
      backgroundColor: "#34233d",
      color: "#FFFFFF",
      accent: "#FF69B4",
    },
    style: {
      position: "bottom",
      fontFamily: "Arial",
      fontSize: 26,
      fontColor: "#FFFFFF",
      highlightColor: "#FF69B4",
      borderColor: "#000000",
      borderWidth: 2,
      bgColor: "#000000",
      bgOpacity: 0,
      animation: "karaoke",
    },
  },
  {
    id: "glow",
    label: "Glow",
    description: "Soft neon emphasis",
    ariaLabel: "Apply Glow subtitle style",
    preview: {
      backgroundColor: "#182d38",
      color: "#FFFFFF",
      accent: "#00BBFF",
    },
    style: {
      position: "bottom",
      fontFamily: "Helvetica",
      fontSize: 24,
      fontColor: "#FFFFFF",
      highlightColor: "#00BBFF",
      borderColor: "#00BBFF",
      borderWidth: 1,
      bgColor: "#000000",
      bgOpacity: 0,
      animation: "word-highlight",
    },
  },
  {
    id: "boxed",
    label: "Boxed",
    description: "High-contrast panel",
    ariaLabel: "Apply Boxed subtitle style",
    preview: {
      backgroundColor: "#2b2925",
      color: "#FFFFFF",
      accent: "#FFDD00",
    },
    style: {
      position: "bottom",
      fontFamily: "Arial",
      fontSize: 24,
      fontColor: "#FFFFFF",
      highlightColor: "#FFDD00",
      borderColor: "#000000",
      borderWidth: 0,
      bgColor: "#000000",
      bgOpacity: 0.75,
      animation: "none",
    },
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Quiet editorial look",
    ariaLabel: "Apply Minimal subtitle style",
    preview: {
      backgroundColor: "#303030",
      color: "#F4F4F5",
      accent: "#A1A1AA",
    },
    style: {
      position: "bottom",
      fontFamily: "Georgia",
      fontSize: 20,
      fontColor: "#F4F4F5",
      highlightColor: "#A1A1AA",
      borderColor: "#000000",
      borderWidth: 0,
      bgColor: "#000000",
      bgOpacity: 0,
      animation: "none",
    },
  },
];

export const DEFAULT_SUBTITLE_STYLE = {
  position: "bottom",
  fontFamily: "Verdana",
  fontSize: 24,
  fontColor: "#FFFFFF",
  highlightColor: "#FFDD00",
  borderColor: "#000000",
  borderWidth: 2,
  bgColor: "#000000",
  bgOpacity: 0,
  animation: "pop",
  displayMode: "phrase",
};

export const normalizeSubtitleStyle = (style = {}) => ({
  ...DEFAULT_SUBTITLE_STYLE,
  ...style,
  displayMode: style.displayMode === "single-word" ? "single-word" : "phrase",
});

// SubtitleModal uses compact controls and scales them for the 1080x1920
// Remotion composition. Keep the local editor on that same render contract.
export const toClipGeneratorSubtitleStyle = (style = {}) => {
  const normalized = normalizeSubtitleStyle(style);
  return {
    ...normalized,
    fontSize: Number((Number(normalized.fontSize) * 2.2).toFixed(1)),
    borderWidth: Number(normalized.borderWidth) * 1.5,
  };
};

export const subtitlePositionClass = (position) =>
  position === "top"
    ? "top-[12%]"
    : position === "middle"
      ? "top-[45%]"
      : "bottom-[10%]";

export const hookPositionClass = (position) =>
  position === "top"
    ? "top-[8%]"
    : position === "center"
      ? "top-1/2 -translate-y-1/2"
      : "bottom-[18%]";

export const hexToRgba = (hex, opacity) => {
  const value = String(hex || "#000000").replace("#", "");
  const normalized =
    value.length === 3
      ? value
          .split("")
          .map((part) => `${part}${part}`)
          .join("")
      : value;
  const red = parseInt(normalized.slice(0, 2), 16) || 0;
  const green = parseInt(normalized.slice(2, 4), 16) || 0;
  const blue = parseInt(normalized.slice(4, 6), 16) || 0;
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, Number(opacity) || 0))})`;
};
