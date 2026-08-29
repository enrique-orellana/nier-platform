import type { CSSProperties } from "react";
import type { SourcePoint, SourceRegion } from "./types";

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

export interface GameplayFramingInput {
  region: SourceRegion;
  sourceAspect: number;
  panelAspect: number;
  zoom?: number;
  focus?: SourcePoint;
}

export const normalizeRegion = (
  region: SourceRegion | null | undefined,
): SourceRegion | null => {
  if (!region) return null;
  const values = [region.x, region.y, region.width, region.height].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [x, y, width, height] = values;
  if (x < 0 || y < 0 || width <= 0 || height <= 0) return null;
  if (x + width > 1 || y + height > 1) return null;
  return { x, y, width, height };
};

export const resolveGameplayCrop = ({
  region,
  sourceAspect,
  panelAspect,
  zoom = 1,
  focus,
}: GameplayFramingInput): SourceRegion => {
  const selectedAspect = (region.width * sourceAspect) / region.height;
  let width = region.width;
  let height = region.height;
  if (selectedAspect >= panelAspect) {
    width = (height * panelAspect) / sourceAspect;
  } else {
    height = (width * sourceAspect) / panelAspect;
  }

  const normalizedZoom = clamp(Number(zoom) || 1, 0.6, 2);
  width = Math.min(region.width, width / normalizedZoom);
  height = Math.min(region.height, height / normalizedZoom);
  const focusX = clamp(
    Number(focus?.x ?? region.x + region.width / 2),
    region.x,
    region.x + region.width,
  );
  const focusY = clamp(
    Number(focus?.y ?? region.y + region.height / 2),
    region.y,
    region.y + region.height,
  );
  const x = clamp(
    focusX - width / 2,
    region.x,
    region.x + region.width - width,
  );
  const y = clamp(
    focusY - height / 2,
    region.y,
    region.y + region.height - height,
  );
  return { x, y, width, height };
};

export const cropVideoStyle = (crop: SourceRegion): CSSProperties => ({
  position: "absolute",
  width: `${(1 / crop.width) * 100}%`,
  height: `${(1 / crop.height) * 100}%`,
  left: `${(-crop.x / crop.width) * 100}%`,
  top: `${(-crop.y / crop.height) * 100}%`,
  maxWidth: "none",
  maxHeight: "none",
  objectFit: "fill",
});
