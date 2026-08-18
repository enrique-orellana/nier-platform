export const HOOK_PREVIEW_WIDTH = 360;
export const HOOK_FONT_FAMILY = "Arial, Helvetica, sans-serif";
export const HOOK_SIZE_SCALE = { S: 0.8, M: 1, L: 1.3 };
export const FACECAM_HEIGHT_RATIOS = { small: 0.3, medium: 0.38, large: 0.46 };

const widthScale = (renderWidth = HOOK_PREVIEW_WIDTH) => {
  const width = Number(renderWidth);
  return Number.isFinite(width) && width > 0 ? width / HOOK_PREVIEW_WIDTH : 1;
};

export const getHookFontSize = (
  fontSize = 48,
  size = "M",
  renderWidth = HOOK_PREVIEW_WIDTH,
) =>
  Math.max(
    14,
    ((Number(fontSize) || 48) / 2.6) *
      (HOOK_SIZE_SCALE[size] || HOOK_SIZE_SCALE.M),
  ) * widthScale(renderWidth);

export const getStreamerBoundaryRatio = (facecamSize = "medium") =>
  FACECAM_HEIGHT_RATIOS[facecamSize] || FACECAM_HEIGHT_RATIOS.medium;

export const getHookPositionStyle = (
  position = "top",
  layoutFormat = "standard",
  facecamSize = "medium",
) => {
  if (position === "center")
    return { top: "50%", bottom: "auto", transform: "translate(-50%, -50%)" };
  if (position === "bottom")
    return { top: "auto", bottom: "18%", transform: "translateX(-50%)" };
  if (layoutFormat === "streamer_stack") {
    return {
      top: `${getStreamerBoundaryRatio(facecamSize) * 100}%`,
      bottom: "auto",
      transform: "translate(-50%, -50%)",
    };
  }
  return { top: "8%", bottom: "auto", transform: "translateX(-50%)" };
};

export const getHookAnimationStyle = (
  entranceAnimation = "spring",
  elapsedMs = 0,
  renderWidth = HOOK_PREVIEW_WIDTH,
) => {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const scale = widthScale(renderWidth);
  if (entranceAnimation === "fade")
    return { opacity: Math.min(1, elapsed / 500) };
  if (entranceAnimation === "slide-up") {
    return {
      opacity: Math.min(1, elapsed / 500),
      transform: `translateY(${Math.max(0, 24 - elapsed / 20) * scale}px)`,
    };
  }
  if (entranceAnimation === "spring") {
    return {
      opacity: Math.min(1, elapsed / 250),
      transform: `scale(${0.82 + Math.min(1, elapsed / 350) * 0.18})`,
    };
  }
  return {};
};

export const getHookBoxStyle = (
  hook = {},
  renderWidth = HOOK_PREVIEW_WIDTH,
) => {
  const scale = widthScale(renderWidth);
  const isStreamer = hook.layoutFormat === "streamer_stack";
  return {
    color: isStreamer ? "#FFE840" : hook.color || "#FFFFFF",
    backgroundColor: isStreamer ? "transparent" : hook.background || "#111111",
    fontFamily: hook.fontFamily || HOOK_FONT_FAMILY,
    fontSize: `${getHookFontSize(hook.fontSize, hook.size, renderWidth)}px`,
    fontWeight: 700,
    lineHeight: 1.5,
    padding: `${8 * scale}px ${12 * scale}px`,
    borderRadius: isStreamer ? "0px" : `${8 * scale}px`,
    boxShadow: isStreamer
      ? "none"
      : "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)",
    WebkitTextStroke: isStreamer
      ? `${Math.max(2, Math.round(2 * scale))}px #000000`
      : undefined,
    textShadow: isStreamer
      ? "1px 1px 0 #000000, -1px -1px 0 #000000, 1px -1px 0 #000000, -1px 1px 0 #000000"
      : undefined,
    textAlign: "center",
  };
};
