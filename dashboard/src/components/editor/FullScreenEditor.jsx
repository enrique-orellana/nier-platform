import React, { useCallback, useEffect, useMemo, useState } from "react";
import { X, Save } from "lucide-react";
import { getApiUrl } from "../../config";
import RemotionPreview from "../RemotionPreview";
import {
  manifestToEditorState,
  editorStateToManifest,
  manifestWithTranscriptCaptions,
} from "../../editor/designcomboAdapter";
import { createSubtitleCue } from "../../editor/timelineModel";
import TransportControls from "./TransportControls";
import VersionHistory from "./VersionHistory";
import DesignComboTimeline from "./DesignComboTimeline";
import MediaPool from "./MediaPool";
import InspectorPanel from "./InspectorPanel";
import SubtitleTranslationPanel from "../SubtitleTranslationPanel";
import { saveAndRenderVersion } from "../../editor/renderVersion";
import EditorActionToolbar from "./EditorActionToolbar";

const proxyUrl = (url) => {
  if (!url || url.startsWith("blob:") || !url.startsWith("http")) return url;
  const parsed = new URL(url);
  const name = decodeURIComponent(
    parsed.pathname.split("/").pop() || "video.mp4",
  );
  return getApiUrl(
    `/api/video-proxy/${encodeURIComponent(name)}?url=${encodeURIComponent(url)}`,
  );
};

const defaultSubtitleTrackId = (nextManifest) =>
  nextManifest?.active_subtitle_track_id ||
  nextManifest?.subtitle_tracks?.[0]?.id ||
  (nextManifest?.timeline?.transcript?.segments?.length ? "original" : null);

export default function FullScreenEditor({
  isOpen = true,
  jobId,
  clipIndex,
  clip = {},
  initialVersion = null,
  initialManifest = null,
  onClose,
  onRendered,
  editorActions = null,
}) {
  const [version, setVersion] = useState(initialVersion);
  const [manifest, setManifest] = useState(initialManifest);
  const [versions, setVersions] = useState(
    initialVersion ? [initialVersion] : [],
  );
  const [editorState, setEditorState] = useState(() =>
    manifestToEditorState(
      initialManifest || {
        timeline: { trim: { start_sec: 0, end_sec: clip.duration || 30 } },
        layers: {},
        subtitle_tracks: [],
      },
      { fps: clip.output_fps || 30 },
    ),
  );
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [selectedItem, setSelectedItem] = useState(null);
  const [activeTrackId, setActiveTrackId] = useState(
    defaultSubtitleTrackId(initialManifest),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const durationSeconds = editorState.durationSec || 30;
  const fps = editorState.fps || clip.output_fps || 30;

  const hydrateManifest = useCallback(
    async (baseManifest) => {
      if (
        baseManifest?.timeline?.transcript?.segments?.length ||
        baseManifest?.subtitle_tracks?.length ||
        !jobId
      )
        return baseManifest;
      try {
        const response = await fetch(
          getApiUrl(`/api/clip/${jobId}/${clipIndex}/transcript`),
        );
        if (!response.ok) return baseManifest;
        return manifestWithTranscriptCaptions(
          baseManifest,
          await response.json(),
        );
      } catch {
        return baseManifest;
      }
    },
    [clipIndex, jobId],
  );

  useEffect(() => {
    if (!isOpen || initialManifest) return;
    let cancelled = false;
    const load = async () => {
      const historyResponse = await fetch(
        getApiUrl(`/api/clip/${jobId}/${clipIndex}/versions`),
      );
      const history = await historyResponse.json();
      const currentId =
        history.current_version_id || history.versions?.at(-1)?.version_id;
      if (!currentId) return;
      const versionResponse = await fetch(
        getApiUrl(`/api/clip/${jobId}/${clipIndex}/versions/${currentId}`),
      );
      const payload = await versionResponse.json();
      if (cancelled) return;
      const hydratedManifest = await hydrateManifest(payload.manifest);
      if (cancelled) return;
      setVersions(history.versions || []);
      setVersion(payload.version);
      setManifest(hydratedManifest);
      setEditorState(
        manifestToEditorState(hydratedManifest, { fps: clip.output_fps || 30 }),
      );
      setActiveTrackId(defaultSubtitleTrackId(hydratedManifest));
    };
    load().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    clip.output_fps,
    clipIndex,
    hydrateManifest,
    initialManifest,
    isOpen,
    jobId,
  ]);

  const inputProps = useMemo(() => {
    const nextManifest = editorStateToManifest(
      editorState,
      manifest || initialManifest || {},
    );
    return {
      videoUrl: proxyUrl(
        nextManifest.timeline?.source_video_url || clip.video_url,
      ),
      subtitles: nextManifest.layers?.subtitles || null,
      subtitleTracks: nextManifest.subtitle_tracks || [],
      activeSubtitleTrackId: nextManifest.active_subtitle_track_id || null,
      hook: nextManifest.layers?.hook || null,
      effects: nextManifest.layers?.effects || null,
    };
  }, [clip.video_url, editorState, initialManifest, manifest]);

  const currentManifest = useMemo(
    () => editorStateToManifest(editorState, manifest || initialManifest || {}),
    [editorState, initialManifest, manifest],
  );
  const subtitleTracks = currentManifest.subtitle_tracks || [];
  const updateSelectedItem = (nextItem) => {
    if (nextItem.__delete) {
      deleteSelectedItem(nextItem);
      return;
    }
    setSelectedItem(nextItem);
    setEditorState((previous) => ({
      ...previous,
      tracks: previous.tracks.map((track) => ({
        ...track,
        items: track.items.map((item) =>
          item.id === nextItem.id ? nextItem : item,
        ),
      })),
    }));
  };
  const deleteSelectedItem = (item) => {
    setEditorState((previous) => ({
      ...previous,
      tracks: previous.tracks.map((track) => ({
        ...track,
        items: track.items.filter((candidate) => candidate.id !== item.id),
      })),
    }));
    setSelectedItem(null);
  };
  const addSubtitleCue = useCallback(() => {
    const subtitleTrack =
      editorState.tracks.find(
        (track) =>
          track.type === "subtitle" &&
          track.id === `subtitles-${activeTrackId}`,
      ) || editorState.tracks.find((track) => track.type === "subtitle");
    if (!subtitleTrack) return;
    const cue = createSubtitleCue({
      playheadMs: Math.round((currentFrame / fps) * 1000),
      durationMs: Math.round(editorState.durationSec * 1000),
      fps,
      existingIds: subtitleTrack.items.map((item) => item.id),
    });
    const selectedCue = { ...cue, trackId: subtitleTrack.id, isNew: true };
    setEditorState((previous) => ({
      ...previous,
      tracks: previous.tracks.map((track) =>
        track.id === subtitleTrack.id
          ? { ...track, items: [...track.items, selectedCue] }
          : track,
      ),
    }));
    setActiveTrackId(subtitleTrack.id.replace(/^subtitles-/, ""));
    setSelectedItem(selectedCue);
  }, [activeTrackId, currentFrame, editorState, fps]);
  useEffect(() => {
    const handleAddSubtitleCue = () => addSubtitleCue();
    window.addEventListener(
      "openshorts:add-subtitle-cue",
      handleAddSubtitleCue,
    );
    return () =>
      window.removeEventListener(
        "openshorts:add-subtitle-cue",
        handleAddSubtitleCue,
      );
  }, [addSubtitleCue]);
  const loadVersion = async (nextVersion) => {
    if (!nextVersion?.version_id) return;
    try {
      const response = await fetch(
        getApiUrl(
          `/api/clip/${jobId}/${clipIndex}/versions/${nextVersion.version_id}`,
        ),
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.detail || "Unable to load version");
      const hydratedManifest = await hydrateManifest(payload.manifest);
      setVersion(payload.version || nextVersion);
      setManifest(hydratedManifest);
      setEditorState(
        manifestToEditorState(hydratedManifest, { fps: clip.output_fps || 30 }),
      );
      setActiveTrackId(defaultSubtitleTrackId(hydratedManifest));
      setSelectedItem(null);
    } catch {
      /* keep the current draft active when a historical version cannot be loaded */
    }
  };
  const translationPanel = (
    <SubtitleTranslationPanel
      jobId={jobId}
      clipIndex={clipIndex}
      versionId={version?.version_id}
      tracks={subtitleTracks}
      activeTrackId={activeTrackId}
      onSelectTrack={setActiveTrackId}
      onTrackAdded={(track, nextManifest, mergedTracks) => {
        const next = nextManifest || {
          ...currentManifest,
          subtitle_tracks: mergedTracks || [...subtitleTracks, track],
        };
        setManifest(next);
        setEditorState(manifestToEditorState(next, { fps }));
        setActiveTrackId(track?.id || activeTrackId);
      }}
    />
  );
  const branchVersion = async (versionId) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        getApiUrl(`/api/clip/${jobId}/${clipIndex}/versions/branch`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version_id: versionId }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "Branch failed.");
      const hydratedManifest = await hydrateManifest(payload.manifest);
      setVersion(payload.version);
      setManifest(hydratedManifest);
      setEditorState(manifestToEditorState(hydratedManifest, { fps }));
      setActiveTrackId(defaultSubtitleTrackId(hydratedManifest));
      setSelectedItem(null);
    } catch (branchError) {
      setError(branchError.message);
    } finally {
      setBusy(false);
    }
  };
  const saveVersion = async () => {
    if (!version?.version_id || busy) return;
    setBusy(true);
    setError(null);
    const props = {
      ...inputProps,
      durationInFrames: editorState.durationFrames,
      fps,
      width: clip.output_width || 1080,
      height: clip.output_height || 1920,
    };
    const result = await saveAndRenderVersion({
      jobId,
      clipIndex,
      manifest: { ...currentManifest, active_subtitle_track_id: activeTrackId },
      parentVersionId: version.version_id,
      props,
    });
    if (result.status === "done") {
      const outputUrl = result.outputUrl?.startsWith("http")
        ? result.outputUrl
        : getApiUrl(result.outputUrl);
      onRendered?.(outputUrl);
      setVersion(result.version || version);
    } else
      setError(
        result.error || "Render failed. The previous version is still active.",
      );
    setBusy(false);
  };

  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-background text-white"
      data-testid="full-screen-editor"
    >
      <header className="glass-panel flex h-16 shrink-0 items-center justify-between px-6 m-2 mb-0 z-10">
        <div className="flex items-center gap-4">
          <span className="text-lg font-bold tracking-tight text-white drop-shadow-sm">
            OpenShorts Editor
          </span>
          <span className="rounded-full bg-primary/20 px-3 py-1 text-xs font-semibold text-primary drop-shadow-sm border border-primary/30">
            {version ? `Version ${version.version_id.slice(0, 8)}` : "Draft"}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="close editor"
          className="rounded-full p-2.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={20} />
        </button>
      </header>
      {editorActions && <EditorActionToolbar {...editorActions} />}
      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_320px] grid-rows-[minmax(320px,1fr)_minmax(220px,38vh)] gap-2 p-2">
        <section
          className="glass-panel row-span-2 flex flex-col overflow-auto p-5 shadow-lg"
          aria-label="Media Pool"
        >
          <h2 className="mb-5 text-xs font-bold uppercase tracking-widest text-primary drop-shadow-sm">
            Media Pool
          </h2>
          <MediaPool
            sourceUrl={inputProps.videoUrl}
            versions={versions}
            tracks={subtitleTracks}
            onSelectVersion={loadVersion}
            onSelectTrack={setActiveTrackId}
          />
        </section>
        <section
          className="glass-panel min-w-0 overflow-hidden relative shadow-inner border border-white/[0.05] bg-black"
          aria-label="Viewer"
        >
          <RemotionPreview
            videoUrl={inputProps.videoUrl}
            durationInSeconds={durationSeconds}
            fps={fps}
            width={clip.output_width || 1080}
            height={clip.output_height || 1920}
            subtitles={inputProps.subtitles}
            subtitleTracks={inputProps.subtitleTracks}
            activeSubtitleTrackId={
              activeTrackId || inputProps.activeSubtitleTrackId
            }
            hook={inputProps.hook}
            effects={inputProps.effects}
            currentFrame={currentFrame}
            playing={playing}
            onFrameChange={setCurrentFrame}
            onPlayingChange={setPlaying}
          />
        </section>
        <aside
          className="glass-panel row-span-2 flex flex-col overflow-auto p-5 shadow-lg"
          aria-label="Inspector"
        >
          <h2 className="mb-5 text-xs font-bold uppercase tracking-widest text-primary drop-shadow-sm">
            Inspector
          </h2>
          <InspectorPanel
            selectedItem={selectedItem}
            editorState={editorState}
            activeTrackId={activeTrackId}
            onTrackChange={setActiveTrackId}
            onItemChange={updateSelectedItem}
            translationPanel={translationPanel}
          />
          <div className="mt-8 pt-6 border-t border-white/[0.08]">
            <h3 className="mb-4 text-xs font-bold tracking-widest text-zinc-500 uppercase">
              Version History
            </h3>
            <VersionHistory
              versions={versions}
              currentVersionId={version?.version_id}
              selectedVersionId={version?.version_id}
              onSelect={loadVersion}
              onBranch={branchVersion}
            />
          </div>
        </aside>
        <section
          className="glass-panel min-w-0 overflow-hidden flex flex-col shadow-inner"
          aria-label="Timeline"
        >
          <div className="border-b border-white/[0.08] bg-surfaceLight/40 px-3 py-2">
            <TransportControls
              currentFrame={currentFrame}
              durationFrames={editorState.durationFrames}
              fps={fps}
              playing={playing}
              onPlayingChange={setPlaying}
              onFrameChange={setCurrentFrame}
              zoom={zoom}
              onZoomChange={setZoom}
            />
          </div>
          <div className="flex-1 overflow-auto p-4 custom-scrollbar bg-black/20 inset-shadow-sm">
            <div className="mb-2 flex min-w-[760px] items-center justify-between text-xs text-primary/70 font-semibold tracking-wide">
              <span>00:00:00</span>
              <span>{durationSeconds.toFixed(2)}s</span>
            </div>
            <DesignComboTimeline
              state={editorState}
              onStateChange={setEditorState}
              onSelectItem={(item, track) => {
                setActiveTrackId(
                  track.type === "subtitle"
                    ? track.id.replace(/^subtitles-/, "")
                    : activeTrackId,
                );
                setSelectedItem({ ...item, trackId: track.id });
              }}
              playheadFrame={currentFrame}
              onSeek={(seconds) => setCurrentFrame(Math.round(seconds * fps))}
              zoom={zoom}
            />
          </div>
        </section>
      </div>
      <footer className="glass-panel flex h-16 shrink-0 items-center justify-end gap-3 m-2 mt-0 z-10 px-6">
        <span
          className="mr-auto max-w-[48%] truncate text-sm font-medium text-red-400"
          role="alert"
        >
          {error}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl px-5 py-2.5 text-sm font-semibold text-zinc-400 transition-colors hover:text-white hover:bg-white/10"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={saveVersion}
          disabled={busy || !version?.version_id}
          className="btn-primary flex items-center gap-2 drop-shadow-md"
        >
          <Save size={16} /> {busy ? "Rendering…" : "Save as new version"}
        </button>
      </footer>
    </div>
  );
}
