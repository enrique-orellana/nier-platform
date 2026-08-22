import type { RenderRequestProps } from "./render-props.js";

type VersionManifest = Record<string, any>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null));

const trackItems = (track: Record<string, any> | undefined) => {
  const cues = Array.isArray(track?.cues) ? track.cues : [];
  const captions = Array.isArray(track?.captions) ? track.captions : [];
  return cues.length ? cues : captions;
};

const trackCaptions = (track: Record<string, any> | undefined) =>
  trackItems(track).map((cue: Record<string, any>) => ({
    text: cue.text || cue.word || "",
    startMs: Number(cue.startMs || 0),
    endMs: Number(cue.endMs ?? cue.startMs ?? 0),
  }));

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
  const subtitleTracks = Array.isArray(manifest.subtitle_tracks)
    ? clone(manifest.subtitle_tracks)
    : [];
  const activeSubtitleTrackId = manifest.active_subtitle_track_id || null;
  const activeTrack = subtitleTracks.find(
    (track: Record<string, any>) => track.id === activeSubtitleTrackId,
  );
  const activeCaptions = trackCaptions(activeTrack);
  const subtitles =
    activeTrack && activeCaptions.length
      ? {
          ...(clone(manifest.layers?.subtitles) || {}),
          captions: activeCaptions,
          style:
            activeTrack.style || manifest.layers?.subtitles?.style || undefined,
        }
      : null;

  return {
    videoUrl: String(manifest.timeline?.source_video_url || ""),
    ...renderSpec,
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
