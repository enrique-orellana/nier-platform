import type { RenderRequestProps } from "./render-props.js";

type VersionManifest = Record<string, any>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null));

const isGeneratedSourceClip = (url: string) => {
  try {
    return /(?:^|\/)source_clip_[^/]+\.mp4$/i.test(
      new URL(url, "http://localhost").pathname,
    );
  } catch {
    return /(?:^|\/)source_clip_[^/]+\.mp4(?:[?#]|$)/i.test(url);
  }
};

const trackItems = (track: Record<string, any> | undefined) => {
  const cues = Array.isArray(track?.cues) ? track.cues : [];
  const captions = Array.isArray(track?.captions) ? track.captions : [];
  return cues.length ? cues : captions;
};

const trackCaptions = (track: Record<string, any> | undefined) =>
  trackItems(track).flatMap((cue: Record<string, any>) => {
    const captions =
      Array.isArray(cue?.captions) && cue.captions.length
        ? cue.captions
        : [cue];
    return captions.map((caption: Record<string, any>) => ({
      text: caption.text || caption.word || "",
      startMs: Number(caption.startMs || 0),
      endMs: Number(caption.endMs ?? caption.startMs ?? 0),
    }));
  });

const requireRenderSpec = (manifest: VersionManifest) => {
  const source = manifest.render_spec;
  const durationInFrames = Number(source?.duration_in_frames);
  const fps = Number(source?.fps);
  const width = Number(source?.width);
  const height = Number(source?.height);
  if (
    !source ||
    !Number.isFinite(durationInFrames) ||
    durationInFrames < 1 ||
    !Number.isFinite(fps) ||
    fps <= 0 ||
    !Number.isFinite(width) ||
    width < 1 ||
    !Number.isFinite(height) ||
    height < 1
  )
    throw new Error("version manifest render_spec is incomplete");
  return {
    videoStartSeconds: Math.max(0, Number(source.video_start_seconds) || 0),
    durationInFrames: Math.max(1, Math.round(durationInFrames)),
    fps,
    width: Math.round(width),
    height: Math.round(height),
    videoFit: source.video_fit === "contain" ? "contain" : "cover",
  } as const;
};

export function manifestToVersionRenderProps(
  manifest: VersionManifest,
  metadata: { versionId: string; manifestRevision: string },
): RenderRequestProps {
  const renderSpec = requireRenderSpec(manifest);
  const videoUrl = String(manifest.timeline?.source_video_url || "");
  const videoStartSeconds = isGeneratedSourceClip(videoUrl)
    ? 0
    : renderSpec.videoStartSeconds;
  const subtitleTracks = Array.isArray(manifest.subtitle_tracks)
    ? clone(manifest.subtitle_tracks)
    : [];
  const activeSubtitleTrackId = manifest.active_subtitle_track_id || null;
  const activeTrack = subtitleTracks.find(
    (track: Record<string, any>) => track.id === activeSubtitleTrackId,
  );
  const activeCaptions = trackCaptions(activeTrack);
  const subtitleStyle =
    activeTrack?.style ||
    manifest.layers?.subtitles?.style ||
    null;
  const subtitles =
    activeTrack && activeCaptions.length
      ? {
          ...(clone(manifest.layers?.subtitles) || {}),
          captions: activeCaptions,
          position:
            subtitleStyle?.position ||
            manifest.layers?.subtitles?.position ||
            "bottom",
          style: subtitleStyle || undefined,
        }
      : null;

  return {
    videoUrl,
    ...renderSpec,
    videoStartSeconds,
    subtitles,
    subtitleTracks,
    activeSubtitleTrackId: subtitles ? activeSubtitleTrackId : null,
    layout: clone(manifest.layers?.layout || null),
    hook: clone(manifest.layers?.hook || null),
    effects: clone(manifest.layers?.effects || null),
    audio: clone(manifest.layers?.audio || null),
    versionId: metadata.versionId,
    manifestRevision: metadata.manifestRevision,
  };
}
