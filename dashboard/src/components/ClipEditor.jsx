import React, { useMemo, useRef, useState } from "react";
import { X, Save, GitBranch, Loader2 } from "lucide-react";
import { getApiUrl } from "../config";
import RemotionPreview from "./RemotionPreview";
import SubtitleTranslationPanel from "./SubtitleTranslationPanel";
import Timeline from "./editor/Timeline";
import HookInspector from "./editor/HookInspector";
import SubtitleCueInspector from "./editor/SubtitleCueInspector";
import VersionHistory from "./editor/VersionHistory";
import { makeEditorDraft, msToFrame } from "../editor/timelineModel";

const proxyUrl = (url) => {
  return url;
};

const normalizeTracks = (manifest) => {
  const tracks = manifest?.subtitle_tracks || [];
  const normalize = (track) => {
    const cues = track.cues || track.captions || [];
    const captions =
      track.captions?.length && !track.cues
        ? track.captions
        : cues.flatMap((cue) =>
            cue.captions?.length
              ? cue.captions
              : [
                  {
                    text: cue.text || "",
                    startMs: cue.startMs,
                    endMs: cue.endMs,
                  },
                ],
          );
    return { ...track, cues, captions };
  };
  if (tracks.length) return tracks.map(normalize);
  const captions = manifest?.layers?.subtitles?.captions || [];
  return captions.length
    ? [
        {
          id: "original",
          language: "en",
          label: "Original",
          origin: "original",
          cues: captions,
          captions,
        },
      ]
    : [];
};

export default function ClipEditor({
  isOpen,
  onClose,
  clip,
  jobId,
  clipIndex,
  aiHeaders = {},
  onRendered,
}) {
  const [versions, setVersions] = useState([]);
  const [currentVersionId, setCurrentVersionId] = useState(null);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [draft, setDraft] = useState(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [selectedCue, setSelectedCue] = useState(null);
  const [activeTrackId, setActiveTrackId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const durationMs = Math.max(
    1000,
    Math.round(
      (clip?.end && clip?.start
        ? clip.end - clip.start
        : clip?.duration || 30) * 1000,
    ),
  );
  const tracks = useMemo(() => normalizeTracks(draft), [draft]);
  const activeTrack =
    tracks.find((track) => track.id === activeTrackId) || tracks[0];

  const loadHistory = async () => {
    const response = await fetch(
      getApiUrl(`/api/clip/${jobId}/${clipIndex}/versions`),
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.detail || "Could not load versions.");
    setVersions(data.versions || []);
    setCurrentVersionId(data.current_version_id || null);
    const initial =
      data.current_version_id ||
      data.versions?.[data.versions.length - 1]?.version_id;
    if (initial) await loadVersion(initial);
  };
  const loadVersion = async (versionId) => {
    const response = await fetch(
      getApiUrl(`/api/clip/${jobId}/${clipIndex}/versions/${versionId}`),
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Could not load version.");
    setSelectedVersion(data.version);
    setDraft(makeEditorDraft(data.manifest));
    const nextTracks = normalizeTracks(data.manifest);
    setActiveTrackId(
      data.manifest.active_subtitle_track_id || nextTracks[0]?.id || null,
    );
    setSelectedCue(null);
  };
  const loadedKeyRef = useRef("");
  const currentKey = isOpen ? `${jobId}-${clipIndex}` : "";

  if (isOpen && loadedKeyRef.current !== currentKey) {
    loadedKeyRef.current = currentKey;
    loadHistory().catch((e) => setError(e.message));
  } else if (!isOpen && loadedKeyRef.current !== "") {
    loadedKeyRef.current = "";
  }

  const updateDraft = (next) =>
    setDraft((current) => ({ ...current, ...next }));
  const updateHook = (hook) =>
    updateDraft({ layers: { ...(draft.layers || {}), hook } });
  const updateCue = (cue) => {
    if (!activeTrack) return;
    setSelectedCue((previous) => (previous ? { ...previous, ...cue } : cue));
    const nextTracks = tracks.map((track) => {
      if (track.id !== activeTrack.id) return track;
      const nextCues = (track.cues || track.captions)
        .filter(
          (item, i) =>
            !(cue.__delete && (item.id === cue.id || i === selectedCue?.index)),
        )
        .map((item, i) =>
          item.id === cue.id || i === selectedCue?.index
            ? { ...item, ...cue }
            : item,
        );
      return {
        ...track,
        cues: nextCues,
        captions: nextCues.flatMap((item) =>
          item.captions?.length
            ? item.captions
            : [
                {
                  text: item.text || "",
                  startMs: item.startMs,
                  endMs: item.endMs,
                },
              ],
        ),
      };
    });
    updateDraft({
      subtitle_tracks: nextTracks,
      active_subtitle_track_id: activeTrack.id,
    });
    if (cue.__delete) setSelectedCue(null);
  };
  const handleCueChange = (next, index) => {
    const track = tracks.find((item) => item.id === activeTrackId) || tracks[0];
    if (!track) return;
    const cue = { ...track.captions[index], ...next };
    setSelectedCue({ ...cue, index, trackId: track.id });
    updateCue(cue);
  };
  const handleTimelineChange = (next, index) => {
    if (selectedCue?.trackId === "hook") updateHook(next);
    else handleCueChange(next, index);
  };
  const saveVersion = async () => {
    if (!draft || !selectedVersion) return;
    setBusy(true);
    setError(null);
    try {
      const create = await fetch(
        getApiUrl(`/api/clip/${jobId}/${clipIndex}/versions`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            manifest: { ...draft, active_subtitle_track_id: activeTrackId },
            parent_version_id: selectedVersion.version_id,
          }),
        },
      );
      const created = await create.json();
      if (!create.ok)
        throw new Error(created.detail || "Could not create version.");
      const versionId = created.version.version_id;
      const source = proxyUrl(
        draft.timeline?.source_video_url ||
          clip.original_video_url ||
          clip.video_url,
      );
      const fps = clip.output_fps || 30;
      const render = await fetch(
        getApiUrl(
          `/api/clip/${jobId}/${clipIndex}/versions/${versionId}/render`,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            props: {
              videoUrl: source,
              durationInFrames: Math.max(
                1,
                Math.round((durationMs / 1000) * fps),
              ),
              fps,
              width: clip.output_width || 1080,
              height: clip.output_height || 1920,
              subtitles: draft.layers?.subtitles || null,
              subtitleTracks: tracks,
              activeSubtitleTrackId: activeTrackId,
              hook: draft.layers?.hook || null,
              effects: draft.layers?.effects || null,
            },
          }),
        },
      );
      const renderData = await render.json();
      if (!render.ok)
        throw new Error(renderData.detail || "Could not start render.");
      let status;
      do {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const poll = await fetch(
          getApiUrl(`/api/render/${renderData.renderId}`),
        );
        status = await poll.json();
        if (status.status === "error")
          throw new Error(status.error || "Render failed.");
      } while (status.status !== "done");
      const outputUrl = status.outputUrl?.split(/[\\/]/).filter(Boolean).pop();
      if (!outputUrl)
        throw new Error("Render completed without an output file.");
      const complete = await fetch(
        getApiUrl(
          `/api/clip/${jobId}/${clipIndex}/versions/${versionId}/complete`,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ output_url: `/videos/${jobId}/${outputUrl}` }),
        },
      );
      const completed = await complete.json();
      if (!complete.ok)
        throw new Error(completed.detail || "Could not finalize version.");
      await loadHistory();
      await loadVersion(versionId);
      onRendered?.(getApiUrl(`/videos/${jobId}/${outputUrl}`));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const branch = async (versionId) => {
    setBusy(true);
    try {
      const response = await fetch(
        getApiUrl(`/api/clip/${jobId}/${clipIndex}/versions/branch`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version_id: versionId }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Branch failed.");
      setSelectedVersion(data.version);
      setDraft(makeEditorDraft(data.manifest));
      const nextTracks = normalizeTracks(data.manifest);
      setActiveTrackId(nextTracks[0]?.id || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleTrackAdded = (track, nextManifest, mergedTracks) => {
    if (nextManifest) setDraft(makeEditorDraft(nextManifest));
    else
      updateDraft({
        subtitle_tracks: mergedTracks || [...tracks, track],
        active_subtitle_track_id: track.id,
      });
    setActiveTrackId(track.id);
    setSelectedCue(null);
  };
  const deleteSubtitleTrack = (trackId) => {
    const nextTracks = tracks.filter((track) => track.id !== trackId);
    const nextActiveTrackId =
      activeTrackId === trackId
        ? nextTracks.find((track) => track.origin !== "translation")?.id ||
          nextTracks[0]?.id ||
          null
        : activeTrackId;
    updateDraft({
      subtitle_tracks: nextTracks,
      active_subtitle_track_id: nextActiveTrackId,
    });
    setActiveTrackId(nextActiveTrackId);
    setSelectedCue(null);
  };

  if (!isOpen) return null;
  const hook = draft?.layers?.hook;
  const previewSubtitles = draft?.layers?.subtitles || null;
  return (
    <div className="fixed inset-0 z-50 bg-black/80 p-4 md:p-8">
      <div className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#121214]">
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div>
            <h2 className="text-lg font-bold text-white">Timeline editor</h2>
            <p className="text-xs text-zinc-500">
              Edits are saved as immutable versions
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <X />
          </button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-4 lg:grid-cols-[1fr_280px]">
          <main className="min-w-0 space-y-4">
            <div className="aspect-[9/16] max-h-[52vh] rounded-xl bg-black">
              <RemotionPreview
                videoUrl={proxyUrl(
                  draft?.timeline?.source_video_url || clip?.video_url,
                )}
                durationInSeconds={durationMs / 1000}
                fps={clip.output_fps || 30}
                width={clip.output_width || 1080}
                height={clip.output_height || 1920}
                subtitles={previewSubtitles}
                subtitleTracks={tracks}
                activeSubtitleTrackId={activeTrackId}
                hook={hook}
                effects={draft?.layers?.effects || null}
                currentFrame={msToFrame(playheadMs, clip.output_fps || 30)}
              />
            </div>
            <Timeline
              durationMs={durationMs}
              tracks={tracks}
              hook={hook}
              selectedCue={selectedCue}
              onSelectCue={(cue, index) => {
                setSelectedCue(
                  cue.id === "hook"
                    ? { ...cue, trackId: "hook" }
                    : { ...cue, index, trackId: activeTrack?.id },
                );
              }}
              onChangeCue={handleTimelineChange}
              playheadMs={playheadMs}
              onSeek={setPlayheadMs}
            />
            <SubtitleTranslationPanel
              jobId={jobId}
              clipIndex={clipIndex}
              versionId={selectedVersion?.version_id}
              tracks={tracks}
              activeTrackId={activeTrackId}
              aiHeaders={aiHeaders}
              onSelectTrack={setActiveTrackId}
              onTrackAdded={handleTrackAdded}
              onTrackRemoved={deleteSubtitleTrack}
            />
          </main>
          <aside className="space-y-4">
            <section className="rounded-xl border border-white/10 p-3">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold text-zinc-300">
                <span>Version history</span>
                <button
                  onClick={() =>
                    selectedVersion && branch(selectedVersion.version_id)
                  }
                  className="text-cyan-300"
                >
                  <GitBranch size={14} />
                </button>
              </div>
              <VersionHistory
                versions={versions}
                currentVersionId={currentVersionId}
                selectedVersionId={selectedVersion?.version_id}
                onSelect={(v) => loadVersion(v.version_id)}
                onBranch={branch}
                getVersionDownloadUrl={(versionId) =>
                  getApiUrl(
                    `/api/clip/${jobId}/${clipIndex}/versions/${versionId}/download`,
                  )
                }
              />
            </section>
            <section className="rounded-xl border border-white/10 p-3">
              <h3 className="mb-2 text-xs font-semibold text-zinc-300">
                Inspector
              </h3>
              {selectedCue?.trackId === "hook" ? (
                <HookInspector hook={hook} onChange={updateHook} />
              ) : (
                <SubtitleCueInspector
                  cue={selectedCue}
                  tracks={tracks}
                  activeTrackId={activeTrackId}
                  onTrackChange={setActiveTrackId}
                  onChange={updateCue}
                />
              )}
            </section>
          </aside>
        </div>
        <footer className="flex items-center justify-between border-t border-white/10 px-5 py-3">
          <span className="text-xs text-red-300">{error}</span>
          <div className="flex gap-2">
            <button
              onClick={() =>
                selectedVersion && loadVersion(selectedVersion.version_id)
              }
              className="rounded-lg px-4 py-2 text-xs text-zinc-300"
            >
              Cancel
            </button>
            <button
              onClick={saveVersion}
              disabled={busy || !selectedVersion}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white"
            >
              {busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}{" "}
              Save as new version
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
