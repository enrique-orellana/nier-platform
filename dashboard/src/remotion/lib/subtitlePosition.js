export const SUBTITLE_OUTPUT_WIDTH = 1080;
export const SUBTITLE_OUTPUT_HEIGHT = 1920;

const PRESET_Y_RATIOS = Object.freeze({
  top: 0.12,
  middle: 0.45,
  bottom: 0.9,
});

export const clampSubtitleCoordinate = (value, maximum, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.round(fallback);
  return Math.round(Math.max(0, Math.min(maximum, numeric)));
};

export const getSubtitlePositionCoordinates = (
  style = {},
  width = SUBTITLE_OUTPUT_WIDTH,
  height = SUBTITLE_OUTPUT_HEIGHT,
) => {
  const outputWidth = Math.max(1, Number(width) || SUBTITLE_OUTPUT_WIDTH);
  const outputHeight = Math.max(1, Number(height) || SUBTITLE_OUTPUT_HEIGHT);
  if (style.position === "custom") {
    return {
      x: clampSubtitleCoordinate(style.positionX, outputWidth, outputWidth / 2),
      y: clampSubtitleCoordinate(style.positionY, outputHeight, outputHeight / 2),
    };
  }
  const ratio = PRESET_Y_RATIOS[style.position] ?? PRESET_Y_RATIOS.bottom;
  return { x: Math.round(outputWidth / 2), y: Math.round(outputHeight * ratio) };
};

export const getSubtitlePositionStyle = (
  style = {},
  width = SUBTITLE_OUTPUT_WIDTH,
  height = SUBTITLE_OUTPUT_HEIGHT,
) => {
  const outputWidth = Math.max(1, Number(width) || SUBTITLE_OUTPUT_WIDTH);
  const outputHeight = Math.max(1, Number(height) || SUBTITLE_OUTPUT_HEIGHT);
  const { x, y } = getSubtitlePositionCoordinates(
    style,
    outputWidth,
    outputHeight,
  );
  return {
    left: `${(x / outputWidth) * 100}%`,
    top: `${(y / outputHeight) * 100}%`,
    bottom: "auto",
    transform: "translate(-50%, -50%)",
  };
};
