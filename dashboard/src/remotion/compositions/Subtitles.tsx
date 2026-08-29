import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import type { SubtitleBlock, SubtitleConfig } from "../lib/types";
import {
  getActiveWordIndex,
  getSubtitleWordsForDisplay,
  groupCaptionsIntoBlocks,
} from "../lib/captions";
import { getFontStack, subtitleFontFace } from "../lib/fonts";

export { getSubtitleWordsForDisplay } from "../lib/captions";

interface SubtitlesProps {
  config: SubtitleConfig;
  mediaTimeMs?: number | null;
}

const POSITION_MAP: Record<string, React.CSSProperties> = {
  top: { top: "12%", bottom: "auto" },
  middle: { top: "45%", bottom: "auto" },
  bottom: { bottom: "10%", top: "auto" },
};

const DEFAULT_SUBTITLE_STYLE: SubtitleConfig["style"] = {
  fontFamily: "Arial",
  fontSize: 52,
  fontColor: "#FFFFFF",
  highlightColor: "#FFDD00",
  borderColor: "#000000",
  borderWidth: 3,
  bgColor: "#000000",
  bgOpacity: 0,
  animation: "none",
  displayMode: "phrase",
};

export const getSubtitleFrameRange = (
  cue: { startMs: number; endMs: number },
  fps: number,
) => {
  const startFrame = Math.round((cue.startMs / 1000) * fps);
  const endFrame = Math.max(
    startFrame + 1,
    Math.round((cue.endMs / 1000) * fps),
  );
  return { startFrame, endFrame, durationFrames: endFrame - startFrame };
};

export const getSubtitleTimeMs = (
  blockStartFrame: number,
  relativeFrame: number,
  fps: number,
) => ((blockStartFrame + relativeFrame) / fps) * 1000;

export const isSubtitleBlockActiveAt = (
  block: { startMs: number; endMs: number },
  timeMs: number,
) => timeMs >= block.startMs && timeMs < block.endMs;

export function normalizeSubtitleConfig(
  config: Partial<SubtitleConfig> | null | undefined,
): SubtitleConfig {
  return {
    captions: Array.isArray(config?.captions) ? config.captions : [],
    blocks: Array.isArray(config?.blocks) ? config.blocks : undefined,
    position: config?.position || "bottom",
    style: {
      ...DEFAULT_SUBTITLE_STYLE,
      ...(config?.style || {}),
      displayMode:
        config?.style?.displayMode === "single-word" ? "single-word" : "phrase",
    },
  };
}

export const Subtitles: React.FC<SubtitlesProps> = ({
  config,
  mediaTimeMs,
}) => {
  const { fps } = useVideoConfig();
  const normalizedConfig = normalizeSubtitleConfig(config);
  const blocks = normalizedConfig.blocks?.length
    ? normalizedConfig.blocks
    : groupCaptionsIntoBlocks(normalizedConfig.captions);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <style>{subtitleFontFace}</style>
      {blocks.map((block, i) => {
        const { startFrame, durationFrames } = getSubtitleFrameRange(
          block,
          fps,
        );

        const subtitleBlock = (
          <SubtitleBlock
            block={block}
            config={normalizedConfig}
            blockStartFrame={startFrame}
            mediaTimeMs={mediaTimeMs}
          />
        );

        if (mediaTimeMs != null) {
          return <React.Fragment key={i}>{subtitleBlock}</React.Fragment>;
        }

        return (
          <Sequence
            key={i}
            from={startFrame}
            durationInFrames={durationFrames}
            layout="none"
          >
            {subtitleBlock}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

interface SubtitleBlockProps {
  block: ReturnType<typeof groupCaptionsIntoBlocks>[number];
  config: SubtitleConfig;
  blockStartFrame: number;
  mediaTimeMs?: number | null;
}

const SubtitleBlock: React.FC<SubtitleBlockProps> = ({
  block,
  config,
  blockStartFrame,
  mediaTimeMs,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { style, position } = config;

  // Current time relative to composition start (sequence-relative frame)
  const currentTimeMs =
    mediaTimeMs ?? getSubtitleTimeMs(blockStartFrame, frame, fps);
  if (mediaTimeMs != null && !isSubtitleBlockActiveAt(block, currentTimeMs)) {
    return null;
  }
  const subtitleFrame =
    mediaTimeMs == null
      ? frame
      : Math.max(0, (currentTimeMs / 1000) * fps - blockStartFrame);
  const activeIndex = getActiveWordIndex(block.words, currentTimeMs);
  const visibleWords = getSubtitleWordsForDisplay(
    block.words,
    activeIndex,
    style.displayMode,
  );

  if (style.displayMode === "single-word" && activeIndex < 0) return null;

  const positionStyle = POSITION_MAP[position] ?? POSITION_MAP.bottom;
  const fontStack = getFontStack(style.fontFamily);

  // Background box style
  const hasBg = style.bgOpacity > 0;
  const bgStyle: React.CSSProperties = hasBg
    ? {
        backgroundColor: `${style.bgColor}${Math.round(style.bgOpacity * 255)
          .toString(16)
          .padStart(2, "0")}`,
        borderRadius: 8,
        padding: "8px 16px",
      }
    : {};

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        ...positionStyle,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "6px 8px",
          maxWidth: "85%",
          ...bgStyle,
        }}
      >
        {visibleWords.map((word, i) => (
          <WordSpan
            key={i}
            word={word.text}
            isActive={style.displayMode === "single-word" || i === activeIndex}
            style={style}
            fontStack={fontStack}
            animation={style.animation}
            frame={subtitleFrame}
            fps={fps}
            wordStartMs={word.startMs}
            blockStartFrame={blockStartFrame}
          />
        ))}
      </div>
    </div>
  );
};

interface WordSpanProps {
  word: string;
  isActive: boolean;
  style: SubtitleConfig["style"];
  fontStack: string;
  animation: SubtitleConfig["style"]["animation"];
  frame: number;
  fps: number;
  wordStartMs: number;
  blockStartFrame: number;
}

const WordSpan: React.FC<WordSpanProps> = ({
  word,
  isActive,
  style,
  fontStack,
  animation,
  frame,
  fps,
  wordStartMs,
  blockStartFrame,
}) => {
  const wordStartFrame =
    Math.round((wordStartMs / 1000) * fps) - blockStartFrame;

  let transform = "";
  let color = style.fontColor;
  let extraStyle: React.CSSProperties = {};

  if (isActive) {
    color = style.highlightColor;

    switch (animation) {
      case "pop": {
        const scale = spring({
          frame: frame - wordStartFrame,
          fps,
          config: { mass: 0.5, stiffness: 300, damping: 12 },
          durationInFrames: 10,
        });
        const scaleValue = interpolate(scale, [0, 1], [1, 1.25]);
        transform = `scale(${scaleValue})`;
        break;
      }
      case "karaoke": {
        extraStyle = {
          backgroundColor: style.highlightColor,
          color: style.bgColor || "#000000",
          borderRadius: 4,
          padding: "2px 6px",
        };
        break;
      }
      case "word-highlight": {
        extraStyle = {
          textShadow: `0 0 12px ${style.highlightColor}, 0 0 24px ${style.highlightColor}40`,
        };
        break;
      }
      default:
        break;
    }
  }

  // Text stroke via textShadow (CSS paint-order not reliable in Remotion)
  const strokeShadow =
    style.borderWidth > 0
      ? [
          `${style.borderWidth}px 0 0 ${style.borderColor}`,
          `-${style.borderWidth}px 0 0 ${style.borderColor}`,
          `0 ${style.borderWidth}px 0 ${style.borderColor}`,
          `0 -${style.borderWidth}px 0 ${style.borderColor}`,
        ].join(", ")
      : "none";

  return (
    <span
      style={{
        fontFamily: fontStack,
        fontSize: style.fontSize,
        fontWeight: 700,
        color: animation === "karaoke" && isActive ? undefined : color,
        textShadow:
          animation !== "karaoke"
            ? [strokeShadow, extraStyle.textShadow].filter(Boolean).join(", ")
            : strokeShadow,
        transform,
        display: "inline-block",
        transition: "none",
        ...extraStyle,
      }}
    >
      {word}
    </span>
  );
};
