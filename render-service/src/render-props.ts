export interface RenderRequestProps {
  videoUrl: string;
  videoStartSeconds?: number;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  videoFit?: "cover" | "contain";
  subtitles?: unknown;
  subtitleTracks?: unknown[];
  activeSubtitleTrackId?: string | null;
  layout?: unknown;
  audio?: unknown;
  hook?: unknown;
  effects?: unknown;
  versionId?: string;
  manifestPath?: string;
  manifestRevision?: string;
}

export function buildRenderProps(
  props: RenderRequestProps,
  resolvedVideoUrl: string,
): RenderRequestProps {
  return {
    ...props,
    videoUrl: resolvedVideoUrl,
    subtitles: props.subtitles ?? null,
    subtitleTracks: props.subtitleTracks ?? [],
    activeSubtitleTrackId: props.activeSubtitleTrackId ?? null,
    layout: props.layout ?? null,
    audio: props.audio ?? null,
    hook: props.hook ?? null,
    effects: props.effects ?? null,
  };
}
