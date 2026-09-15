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
  getHookCardBorderRadius,
  getHookCardOverlap,
  getHookCardStackStyle,
  getHookPositionStyle,
  getHookTextLines,
  normalizeHookBoxStyle,
} from "../lib/hookVisual";

interface HookOverlayProps {
  config: HookConfig;
}

export const HookOverlay: React.FC<HookOverlayProps> = ({ config }) => {
  const { fps, width, height } = useVideoConfig();
  const fromFrames = Math.max(0, Math.round(((config.startMs || 0) / 1000) * fps));
  const displayFrames = Math.max(1, Math.round((((config.endMs ?? ((config.startMs || 0) + config.displayDurationSec * 1000)) - (config.startMs || 0)) / 1000) * fps));

  return (
    <AbsoluteFill>
      <style>{notoSerifFontFace}</style>
      <Sequence from={fromFrames} durationInFrames={displayFrames} layout="none">
        <HookBox
          config={config}
          displayFrames={displayFrames}
          width={width}
          height={height}
        />
      </Sequence>
    </AbsoluteFill>
  );
};

interface HookBoxProps {
  config: HookConfig;
  displayFrames: number;
  width: number;
  height: number;
}

const HookBox: React.FC<HookBoxProps> = ({
  config,
  displayFrames,
  width,
  height,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const elapsedMs = (frame / fps) * 1000;
  const positionStyle = getHookPositionStyle(
    config,
    config.layoutFormat,
    config.facecamSize,
    width,
    height,
  );
  const boxStyle = getHookBoxStyle(
    {
      ...config,
      color: config.color || "#000000",
      background: config.background || "rgba(255, 255, 255, 0.94)",
      fontFamily: config.fontFamily || getHookFontStack() || HOOK_FONT_FAMILY,
      fontSize: config.fontSize || 46.8,
    },
    width,
  );
  const animationStyle = getHookAnimationStyle(
    config.entranceAnimation,
    elapsedMs,
    width,
  );
  const isHeadlineCards =
    normalizeHookBoxStyle(config.boxStyle) === "headline_cards";
  const textLines = getHookTextLines(config.text, config.boxStyle);

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
      {isHeadlineCards ? (
        <div
          style={{
            maxWidth: "88%",
            ...getHookCardStackStyle(config.boxStyle, width),
            ...animationStyle,
          }}
        >
          {textLines.map((line, index) => (
            <div
              key={`${index}-${line}`}
              style={{
                maxWidth: "100%",
                ...boxStyle,
                borderRadius: getHookCardBorderRadius(
                  config.boxStyle,
                  index,
                  textLines.length,
                  width,
                ),
                marginTop:
                  index === 0
                    ? "0px"
                    : `-${getHookCardOverlap(config.boxStyle, width)}px`,
              }}
            >
              <span style={{ overflowWrap: "break-word" }}>{line}</span>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            maxWidth: "88%",
            ...boxStyle,
            ...animationStyle,
          }}
        >
          <span style={{ overflowWrap: "break-word" }}>{config.text}</span>
        </div>
      )}
    </div>
  );
};
