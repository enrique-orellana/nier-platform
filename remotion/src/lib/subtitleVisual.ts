import type { CSSProperties } from "react";

export const SUBTITLE_OUTPUT_WIDTH = 1080;
export const SUBTITLE_OUTPUT_HEIGHT = 1920;

export type SubtitlePositionConfig = {
  position?: string;
  positionX?: number;
  positionY?: number;
};

export const clampSubtitleCoordinate = (
  value: number | string,
  maximum: number,
  fallback: number,
) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.round(fallback);
  return Math.round(Math.max(0, Math.min(maximum, numeric)));
};

export const getSubtitlePositionCoordinates = (
  subtitle: SubtitlePositionConfig = {},
  renderWidth = SUBTITLE_OUTPUT_WIDTH,
  renderHeight = SUBTITLE_OUTPUT_HEIGHT,
) => {
  const width = Math.max(
    1,
    Number(renderWidth) || SUBTITLE_OUTPUT_WIDTH,
  );
  const height = Math.max(
    1,
    Number(renderHeight) || SUBTITLE_OUTPUT_HEIGHT,
  );
  if (subtitle.position === "custom") {
    return {
      x: clampSubtitleCoordinate(subtitle.positionX ?? NaN, width, width / 2),
      y: clampSubtitleCoordinate(subtitle.positionY ?? NaN, height, height / 2),
    };
  }

  const y =
    subtitle.position === "top"
      ? height * 0.12
      : subtitle.position === "middle"
        ? height * 0.45
        : height * 0.78;
  return { x: Math.round(width / 2), y: Math.round(y) };
};

export const getSubtitlePositionStyle = (
  subtitle: SubtitlePositionConfig = {},
  renderWidth = SUBTITLE_OUTPUT_WIDTH,
  renderHeight = SUBTITLE_OUTPUT_HEIGHT,
): CSSProperties => {
  if (subtitle.position !== "custom") {
    return subtitle.position === "top"
      ? { top: "12%", bottom: "auto" }
      : subtitle.position === "middle"
        ? { top: "45%", bottom: "auto" }
        : { bottom: "10%", top: "auto" };
  }

  const width = Math.max(
    1,
    Number(renderWidth) || SUBTITLE_OUTPUT_WIDTH,
  );
  const height = Math.max(
    1,
    Number(renderHeight) || SUBTITLE_OUTPUT_HEIGHT,
  );
  const { x, y } = getSubtitlePositionCoordinates(subtitle, width, height);
  return {
    left: `${(x / width) * 100}%`,
    right: "auto",
    top: `${(y / height) * 100}%`,
    bottom: "auto",
    transform: "translate(-50%, -50%)",
  };
};
