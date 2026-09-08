import React from "react";
import { interpolate, spring } from "remotion";
import type {
  SubtitleReaction,
  SubtitleReactionAnimation,
  SubtitleReactionPosition,
  SubtitleReactionStyle,
} from "../lib/types";

export interface SubtitleReactionsProps {
  reactions?: SubtitleReaction[];
  style?: SubtitleReactionStyle;
  subtitleFontSize?: number;
  currentTimeMs: number;
  fps: number;
}

const DEFAULT_STYLE: SubtitleReactionStyle = {
  position: "above",
  animation: "pop",
  scale: 1,
  spacing: 16,
};

const positionStyle = (
  position: SubtitleReactionPosition,
  spacing: number,
): React.CSSProperties => {
  const gap = `calc(100% + ${spacing}px)`;
  switch (position) {
    case "left":
      return {
        right: gap,
        top: "50%",
        transform: "translateY(-50%)",
      };
    case "right":
      return {
        left: gap,
        top: "50%",
        transform: "translateY(-50%)",
      };
    default:
      return {
        bottom: gap,
        left: "50%",
        transform: "translateX(-50%)",
      };
  }
};

const normalizeStyle = (
  style?: SubtitleReactionStyle,
): SubtitleReactionStyle => {
  const scale = Number(style?.scale);
  const spacing = Number(style?.spacing);
  return {
    ...DEFAULT_STYLE,
    ...(style || {}),
    scale: Number.isFinite(scale) ? Math.min(4, Math.max(1, scale)) : 1,
    spacing: Number.isFinite(spacing) ? Math.min(96, Math.max(0, spacing)) : 16,
  };
};

const reactionAnimationStyle = (
  reaction: SubtitleReaction,
  style: SubtitleReactionStyle,
  subtitleFontSize: number,
  currentTimeMs: number,
  fps: number,
): React.CSSProperties => {
  const localFrame = Math.max(
    0,
    ((currentTimeMs - reaction.startMs) / 1000) * fps,
  );
  const popProgress = spring({
    frame: localFrame,
    fps,
    config: { mass: 0.5, stiffness: 300, damping: 12 },
    durationInFrames: 10,
  });
  const animationScale = interpolate(popProgress, [0, 1], [0.7, 1]);
  let transform = `scale(${animationScale})`;
  let opacity = 1;

  if (style.animation === "shake") {
    const offset = Math.sin(localFrame * 1.8) * 5;
    transform = `translateX(${offset}px) scale(${animationScale})`;
  } else if (style.animation === "fade") {
    opacity = interpolate(popProgress, [0, 1], [0, 1]);
    transform = "scale(1)";
  }

  return {
    display: "inline-block",
    fontSize: `${subtitleFontSize * style.scale}px`,
    lineHeight: 1,
    transform,
    opacity,
  };
};

const animationValues: SubtitleReactionAnimation[] = ["pop", "shake", "fade"];

export const SubtitleReactions: React.FC<SubtitleReactionsProps> = ({
  reactions = [],
  style,
  subtitleFontSize = 52,
  currentTimeMs,
  fps,
}) => {
  const normalizedStyle = normalizeStyle(style);
  const normalizedSubtitleFontSize =
    Number.isFinite(subtitleFontSize) && subtitleFontSize > 0
      ? subtitleFontSize
      : 52;
  const safeAnimation = animationValues.includes(normalizedStyle.animation)
    ? normalizedStyle.animation
    : DEFAULT_STYLE.animation;
  const active = reactions.filter(
    (reaction) =>
      reaction.enabled !== false &&
      currentTimeMs >= reaction.startMs &&
      currentTimeMs < reaction.endMs,
  );

  if (!active.length) return null;

  return (
    <div
      style={{
        position: "absolute",
        pointerEvents: "none",
        display: "flex",
        gap: 4,
        zIndex: 2,
        ...positionStyle(
          normalizedStyle.position,
          normalizedStyle.spacing ?? 16,
        ),
      }}
    >
      {active.map((reaction) => (
        <span
          key={reaction.id}
          style={reactionAnimationStyle(
            reaction,
            { ...normalizedStyle, animation: safeAnimation },
            normalizedSubtitleFontSize,
            currentTimeMs,
            fps,
          )}
        >
          {reaction.emojis.join(" ")}
        </span>
      ))}
    </div>
  );
};

export default SubtitleReactions;
