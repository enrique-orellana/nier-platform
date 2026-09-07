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
  currentTimeMs: number;
  fps: number;
}

const DEFAULT_STYLE: SubtitleReactionStyle = {
  position: "above",
  animation: "pop",
  scale: 1,
};

const positionStyle = (
  position: SubtitleReactionPosition,
): React.CSSProperties => {
  switch (position) {
    case "left":
      return {
        right: "calc(100% + 8px)",
        top: "50%",
        transform: "translateY(-50%)",
      };
    case "right":
      return {
        left: "calc(100% + 8px)",
        top: "50%",
        transform: "translateY(-50%)",
      };
    default:
      return {
        bottom: "calc(100% + 8px)",
        left: "50%",
        transform: "translateX(-50%)",
      };
  }
};

const normalizeStyle = (
  style?: SubtitleReactionStyle,
): SubtitleReactionStyle => ({
  ...DEFAULT_STYLE,
  ...(style || {}),
  scale: Math.min(2, Math.max(1, Number(style?.scale) || 1)),
});

const reactionAnimationStyle = (
  reaction: SubtitleReaction,
  style: SubtitleReactionStyle,
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
  const scale = style.scale * interpolate(popProgress, [0, 1], [0.7, 1]);
  let transform = `scale(${scale})`;
  let opacity = 1;

  if (style.animation === "shake") {
    const offset = Math.sin(localFrame * 1.8) * 5;
    transform = `translateX(${offset}px) scale(${scale})`;
  } else if (style.animation === "fade") {
    opacity = interpolate(popProgress, [0, 1], [0, 1]);
    transform = `scale(${style.scale})`;
  }

  return {
    display: "inline-block",
    fontSize: "2.2em",
    lineHeight: 1,
    transform,
    opacity,
  };
};

const animationValues: SubtitleReactionAnimation[] = ["pop", "shake", "fade"];

export const SubtitleReactions: React.FC<SubtitleReactionsProps> = ({
  reactions = [],
  style,
  currentTimeMs,
  fps,
}) => {
  const normalizedStyle = normalizeStyle(style);
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
        ...positionStyle(normalizedStyle.position),
      }}
    >
      {active.map((reaction) => (
        <span
          key={reaction.id}
          style={reactionAnimationStyle(
            reaction,
            { ...normalizedStyle, animation: safeAnimation },
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
