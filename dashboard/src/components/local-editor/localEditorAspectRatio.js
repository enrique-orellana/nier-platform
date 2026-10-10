export const LOCAL_EDITOR_ASPECT_RATIOS = Object.freeze([
  Object.freeze({ value: "9:16", label: "9:16", width: 1080, height: 1920 }),
  Object.freeze({ value: "16:9", label: "16:9", width: 1920, height: 1080 }),
  Object.freeze({ value: "1:1", label: "1:1", width: 1080, height: 1080 }),
  Object.freeze({ value: "4:5", label: "4:5", width: 1080, height: 1350 }),
  Object.freeze({ value: "original", label: "Original" }),
]);

export const normalizeAspectRatio = (value) =>
  LOCAL_EDITOR_ASPECT_RATIOS.some((option) => option.value === value)
    ? value
    : "9:16";

export const formatAspectRatio = (width, height) => {
  const safeWidth = Math.round(Number(width));
  const safeHeight = Math.round(Number(height));
  if (
    !Number.isFinite(safeWidth) ||
    !Number.isFinite(safeHeight) ||
    safeWidth <= 0 ||
    safeHeight <= 0
  )
    return "—";

  let left = safeWidth;
  let right = safeHeight;
  while (right) {
    [left, right] = [right, left % right];
  }
  return `${safeWidth / left}:${safeHeight / left}`;
};

export const resolveAspectRatioDimensions = (
  aspectRatio,
  sourceWidth,
  sourceHeight,
) => {
  const selected = normalizeAspectRatio(aspectRatio);
  if (selected !== "original") {
    const { width, height } = LOCAL_EDITOR_ASPECT_RATIOS.find(
      (option) => option.value === selected,
    );
    return { width, height };
  }

  const evenDimension = (value, fallback) => {
    const numeric = Number(value);
    const safe = Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
    return Math.max(2, Math.floor(safe / 2) * 2);
  };
  return {
    width: evenDimension(sourceWidth, 1080),
    height: evenDimension(sourceHeight, 1920),
  };
};

export const scaleCanvasCoordinate = (value, fromSize, toSize) => {
  const sourceSize = Number(fromSize);
  const targetSize = Number(toSize);
  const coordinate = Number(value);
  if (
    !Number.isFinite(sourceSize) ||
    !Number.isFinite(targetSize) ||
    !Number.isFinite(coordinate) ||
    sourceSize <= 0 ||
    targetSize <= 0
  )
    return 0;

  const clamped = Math.max(0, Math.min(sourceSize, coordinate));
  return Math.round((clamped / sourceSize) * targetSize);
};
