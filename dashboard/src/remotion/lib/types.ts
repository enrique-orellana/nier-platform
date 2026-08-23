import { z } from "zod";

// --- Word-level caption ---
export interface CaptionWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface SubtitleBlock {
  words: CaptionWord[];
  startMs: number;
  endMs: number;
  text: string;
}

// --- Subtitle config ---
export type SubtitleAnimation = "none" | "word-highlight" | "pop" | "karaoke";
export type SubtitlePosition = "top" | "middle" | "bottom";
export type SubtitleDisplayMode = "phrase" | "single-word";

export interface SubtitleStyle {
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  highlightColor: string;
  borderColor: string;
  borderWidth: number;
  bgColor: string;
  bgOpacity: number;
  animation: SubtitleAnimation;
  displayMode: SubtitleDisplayMode;
}

export interface SubtitleConfig {
  captions: CaptionWord[];
  blocks?: SubtitleBlock[];
  position: SubtitlePosition;
  style: SubtitleStyle;
}

export interface SubtitleTrack {
  id: string;
  language: string;
  label: string;
  sourceTrackId?: string;
  origin: "original" | "translation" | "manual";
  captions: CaptionWord[];
  style?: SubtitleStyle;
}

// --- Hook config ---
export type HookPosition = "top" | "center" | "bottom";
export type HookSize = "S" | "M" | "L";
export type HookEntrance = "spring" | "fade" | "slide-up" | "none";

export interface HookConfig {
  text: string;
  position: HookPosition;
  size: HookSize;
  entranceAnimation: HookEntrance;
  displayDurationSec: number;
  color?: string;
  background?: string;
  fontSize?: number;
  fontFamily?: string;
  startMs?: number;
  endMs?: number;
  layoutFormat?: "standard" | "streamer_stack";
  facecamSize?: "small" | "medium" | "large";
}

// --- Effects config ---
export interface EffectSegment {
  startSec: number;
  endSec: number;
  zoom: number;
  zoomCenterX: number;
  zoomCenterY: number;
  brightness: number;
  contrast: number;
  saturate: number;
}

export interface EffectsConfig {
  segments: EffectSegment[];
}

export interface LayoutConfig {
  format: "standard" | "streamer_stack";
  facecam_size?: "small" | "medium" | "large";
}

// --- Main composition props ---
export interface ShortVideoProps {
  videoUrl: string;
  videoStartSeconds?: number;
  playbackRate?: number;
  onAutoPlayError?: () => void;
  onMediaTimeChange?: (mediaTimeMs: number | null) => void;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  videoFit?: "cover" | "contain";
  subtitles: SubtitleConfig | null;
  subtitleTracks?: SubtitleTrack[];
  activeSubtitleTrackId?: string | null;
  layout?: LayoutConfig | null;
  hook: HookConfig | null;
  effects: EffectsConfig | null;
}

// --- Zod schemas for validation (used by render service) ---
export const captionWordSchema = z.object({
  text: z.string(),
  startMs: z.number(),
  endMs: z.number(),
});

export const subtitleStyleSchema = z.object({
  fontFamily: z.string(),
  fontSize: z.number(),
  fontColor: z.string(),
  highlightColor: z.string(),
  borderColor: z.string(),
  borderWidth: z.number(),
  bgColor: z.string(),
  bgOpacity: z.number().min(0).max(1),
  animation: z.enum(["none", "word-highlight", "pop", "karaoke"]),
  displayMode: z.enum(["phrase", "single-word"]).default("phrase"),
});

export const subtitleConfigSchema = z.object({
  captions: z.array(captionWordSchema),
  position: z.enum(["top", "middle", "bottom"]),
  style: subtitleStyleSchema,
});

export const subtitleTrackSchema = z.object({
  id: z.string(),
  language: z.string(),
  label: z.string(),
  sourceTrackId: z.string().optional(),
  origin: z.enum(["original", "translation", "manual"]),
  captions: z.array(captionWordSchema),
  style: subtitleStyleSchema.optional(),
});

export const hookConfigSchema = z.object({
  text: z.string(),
  position: z.enum(["top", "center", "bottom"]),
  size: z.enum(["S", "M", "L"]),
  entranceAnimation: z.enum(["spring", "fade", "slide-up", "none"]),
  displayDurationSec: z.number().positive(),
  startMs: z.number().min(0).optional(),
  endMs: z.number().positive().optional(),
  layoutFormat: z.enum(["standard", "streamer_stack"]).optional(),
  facecamSize: z.enum(["small", "medium", "large"]).optional(),
});

export const effectSegmentSchema = z.object({
  startSec: z.number().min(0),
  endSec: z.number().positive(),
  zoom: z.number().min(0.5).max(3),
  zoomCenterX: z.number().min(0).max(1),
  zoomCenterY: z.number().min(0).max(1),
  brightness: z.number().min(0).max(3),
  contrast: z.number().min(0).max(3),
  saturate: z.number().min(0).max(3),
});

export const effectsConfigSchema = z.object({
  segments: z.array(effectSegmentSchema),
});

export const layoutConfigSchema = z.object({
  format: z.enum(["standard", "streamer_stack"]),
  facecam_size: z.enum(["small", "medium", "large"]).optional(),
});

export const shortVideoPropsSchema = z.object({
  videoUrl: z.string(),
  videoStartSeconds: z.number().min(0).optional(),
  durationInFrames: z.number().int().positive(),
  fps: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  subtitles: subtitleConfigSchema.nullable(),
  subtitleTracks: z.array(subtitleTrackSchema).optional(),
  activeSubtitleTrackId: z.string().nullable().optional(),
  layout: layoutConfigSchema.nullable().optional(),
  hook: hookConfigSchema.nullable(),
  effects: effectsConfigSchema.nullable(),
});
