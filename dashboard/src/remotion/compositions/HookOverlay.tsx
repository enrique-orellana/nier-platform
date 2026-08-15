import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { HookConfig } from "../lib/types";
import { getHookFontStack, notoSerifFontFace } from "../lib/fonts";
import {
  HOOK_FONT_FAMILY,
  getHookAnimationStyle,
  getHookBoxStyle,
  getHookPositionStyle,
} from "../lib/hookVisual";

interface HookOverlayProps {
  config: HookConfig;
}

export const HookOverlay: React.FC<HookOverlayProps> = ({ config }) => {
  const { fps, width } = useVideoConfig();
  const fromFrames = Math.max(0, Math.round(((config.startMs || 0) / 1000) * fps));
  const displayFrames = Math.max(1, Math.round((((config.endMs ?? ((config.startMs || 0) + config.displayDurationSec * 1000)) - (config.startMs || 0)) / 1000) * fps));

  return (
    <AbsoluteFill>
      <style>{notoSerifFontFace}</style>
      <Sequence from={fromFrames} durationInFrames={displayFrames} layout="none">
        <HookBox config={config} displayFrames={displayFrames} width={width} />
      </Sequence>
    </AbsoluteFill>
  );
};

interface HookBoxProps {
  config: HookConfig;
  displayFrames: number;
  width: number;
}

const HookBox: React.FC<HookBoxProps> = ({ config, displayFrames, width }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const elapsedMs = (frame / fps) * 1000;
  const positionStyle = getHookPositionStyle(config.position, config.layoutFormat, config.facecamSize);
  const boxStyle = getHookBoxStyle({
    ...config,
    color: config.color || "#000000",
    background: config.background || "rgba(255, 255, 255, 0.94)",
    fontFamily: config.fontFamily || getHookFontStack() || HOOK_FONT_FAMILY,
    fontSize: config.fontSize || 46.8,
  }, width);
  const animationStyle = getHookAnimationStyle(config.entranceAnimation, elapsedMs, width);

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        width: "100%",
        display: "flex",
        justifyContent: "center",
        ...positionStyle,
      }}
    >
      <div
        style={{
          maxWidth: "88%",
          ...boxStyle,
          ...animationStyle,
        }}
      >
        <span style={{ overflowWrap: "break-word" }}>{config.text}</span>
      </div>
    </div>
  );
};
