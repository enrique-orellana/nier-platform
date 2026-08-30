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
export type HookPosition = "top" | "center" | "bottom" | "custom";
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
  positionX?: number;
  positionY?: number;
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

export type LayoutFormat = "standard" | "streamer_stack";
export type LayoutTransition = "cut" | "crossfade";

export interface SourceRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourcePoint {
  x: number;
  y: number;
}

export interface FaceTrackingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceTrackingKeyframe {
  time_sec: number;
  rect: FaceTrackingRect;
}

export interface FaceTrackingScene {
  start_sec: number;
  end_sec: number;
  strategy: "TRACK" | "GENERAL";
  keyframes: FaceTrackingKeyframe[];
}

export interface FaceTrackingCache {
  cache_key: string;
  algorithm_version: string;
  source_fingerprint: string;
  source_start_seconds: number;
  source_end_seconds: number;
  source_width: number;
  source_height: number;
  track: { scenes: FaceTrackingScene[] };
}

export interface LayoutSegmentConfig {
  id: string;
  startMs: number;
  endMs: number;
  format: LayoutFormat;
  transition?: LayoutTransition;
  transitionDurationMs?: number;
  gameplay_focus?: SourcePoint;
  gameplay_zoom?: number;
  face_tracking_enabled?: boolean;
  face_tracking_cache?: FaceTrackingCache;
}

export interface LayoutConfig {
  [key: string]: unknown;
  format: LayoutFormat;
  facecam_size?: "small" | "medium" | "large";
  source_width?: number;
  source_height?: number;
  webcam_region?: SourceRegion;
  gameplay_region?: SourceRegion;
  gameplay_focus?: SourcePoint;
  gameplay_zoom?: number;
  streamer_tracking_enabled?: boolean;
  segments?: LayoutSegmentConfig[];
}

// --- Main composition props ---
export interface ShortVideoProps {
  videoUrl: string;
  standardBackgroundVideoUrl?: string;
  videoStartSeconds?: number;
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
  blocks: z.array(z.object({
    words: z.array(captionWordSchema),
    startMs: z.number(),
    endMs: z.number(),
    text: z.string(),
  })).optional(),
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
  position: z.enum(["top", "center", "bottom", "custom"]),
  size: z.enum(["S", "M", "L"]),
  entranceAnimation: z.enum(["spring", "fade", "slide-up", "none"]),
  displayDurationSec: z.number().positive(),
  startMs: z.number().min(0).optional(),
  endMs: z.number().positive().optional(),
  positionX: z.number().optional(),
  positionY: z.number().optional(),
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

const sourceRegionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
});

const sourcePointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

const gameplayZoomSchema = z.number().min(0.6).max(2);

const faceTrackingRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
});

const faceTrackingCacheSchema = z.object({
  cache_key: z.string().min(1),
  algorithm_version: z.string().min(1),
  source_fingerprint: z.string().min(1),
  source_start_seconds: z.number().min(0),
  source_end_seconds: z.number().positive(),
  source_width: z.number().positive(),
  source_height: z.number().positive(),
  track: z.object({
    scenes: z.array(
      z.object({
        start_sec: z.number().min(0),
        end_sec: z.number().positive(),
        strategy: z.enum(["TRACK", "GENERAL"]),
        keyframes: z.array(
          z.object({ time_sec: z.number().min(0), rect: faceTrackingRectSchema }),
        ),
      }),
    ),
  }),
});

export const layoutConfigSchema = z.object({
  format: z.enum(["standard", "streamer_stack"]),
  facecam_size: z.enum(["small", "medium", "large"]).optional(),
  source_width: z.number().positive().optional(),
  source_height: z.number().positive().optional(),
  webcam_region: sourceRegionSchema.optional(),
  gameplay_region: sourceRegionSchema.optional(),
  gameplay_focus: sourcePointSchema.optional(),
  gameplay_zoom: gameplayZoomSchema.optional(),
  streamer_tracking_enabled: z.boolean().optional(),
  segments: z
    .array(
      z.object({
        id: z.string(),
        startMs: z.number().min(0),
        endMs: z.number().positive(),
        format: z.enum(["standard", "streamer_stack"]),
        transition: z.enum(["cut", "crossfade"]).optional(),
        transitionDurationMs: z.number().min(0).optional(),
        gameplay_focus: sourcePointSchema.optional(),
        gameplay_zoom: gameplayZoomSchema.optional(),
        face_tracking_enabled: z.boolean().optional(),
        face_tracking_cache: faceTrackingCacheSchema.optional(),
      }),
    )
    .optional(),
}).passthrough();

export const shortVideoPropsSchema = z.object({
  videoUrl: z.string(),
  standardBackgroundVideoUrl: z.string().optional(),
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
