import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Save, X } from "lucide-react";
import { getApiUrl } from "../../config";
import { useRenewableMediaUrl } from "../../lib/videoUrls";
import LocalEditorTab from "../local-editor/LocalEditorTab";
import {
  DEFAULT_SUBTITLE_STYLE,
  normalizeSubtitleStyle,
} from "../local-editor/localEditorStyles";
import { SUBTITLE_LANGUAGES } from "../subtitleLanguages";
import {
  applySourceEditorCues,
  transcriptToSourceEditorState,
} from "./sourceTranscriptEditorState";
import { Button } from "../ui";

const readClipSubtitleStyle = async (projectId, signal) => {
  const fallbackStyle = normalizeSubtitleStyle(DEFAULT_SUBTITLE_STYLE);

  try {
    const clipsResponse = await fetch(
      getApiUrl(`/api/projects/clips/${encodeURIComponent(projectId)}`),
      { signal },
    );
    if (!clipsResponse.ok) return fallbackStyle;

    const clipsPayload = await clipsResponse.json();
    const clips = Array.isArray(clipsPayload?.clips)
      ? clipsPayload.clips.slice(0, 4)
      : [];

    for (const [index, clip] of clips.entries()) {
      const clipIndex =
        clip?.index != null && Number.isInteger(Number(clip.index))
          ? Number(clip.index)
          : index;
      const manifestResponse = await fetch(
        getApiUrl(
          `/api/clip/${encodeURIComponent(projectId)}/${clipIndex}/manifest`,
        ),
        { signal },
      );
      if (!manifestResponse.ok) continue;

      const responsePayload = await manifestResponse.json();
      const manifest = responsePayload?.manifest || responsePayload;
      const tracks = Array.isArray(manifest?.subtitle_tracks)
        ? manifest.subtitle_tracks
        : [];
      const originalTrack =
        tracks.find((track) => track?.id === "original") ||
        tracks.find((track) => track?.origin !== "translation");
      const trackStyle = originalTrack?.style;
      const layerStyle = manifest?.layers?.subtitles?.style;
      const savedStyle = trackStyle || layerStyle;
      if (!savedStyle || typeof savedStyle !== "object") continue;

      const isBaseEditorStyle =
        Boolean(trackStyle) || manifest?.subtitle_tracks_edited === true;
      const fontSize = Number(savedStyle.fontSize);
      const borderWidth = Number(savedStyle.borderWidth);
      return normalizeSubtitleStyle({
        ...savedStyle,
        fontSize:
          Number.isFinite(fontSize) && fontSize > 0
            ? isBaseEditorStyle
              ? fontSize
              : fontSize / 2.2
            : fallbackStyle.fontSize,
        borderWidth:
          Number.isFinite(borderWidth) && borderWidth >= 0
            ? isBaseEditorStyle
              ? borderWidth
              : borderWidth / 1.5
            : fallbackStyle.borderWidth,
        position:
          savedStyle.position ||
          manifest?.layers?.subtitles?.position ||
          fallbackStyle.position,
        fontColor: savedStyle.fontColor || fallbackStyle.fontColor,
        bgColor:
          savedStyle.bgColor ||
          savedStyle.backgroundColor ||
          fallbackStyle.bgColor,
        bgOpacity:
          savedStyle.bgOpacity ??
          savedStyle.backgroundOpacity ??
          fallbackStyle.bgOpacity,
      });
    }
  } catch (readError) {
    if (readError?.name === "AbortError") throw readError;
  }

  return fallbackStyle;
};

const readError = async (response) => {
  const payload = await response.json().catch(() => null);
  return (
    payload?.detail || payload?.error || `Request failed (${response.status})`
  );
};

const sourceTrackFromEditorState = (trackId, state, existingTrack = {}) => {
  const language = String(state?.subtitleLanguage || "en").toLowerCase();
  const languageName = SUBTITLE_LANGUAGES[language] || language;
  const cues = (
    Array.isArray(state?.subtitleCues) ? state.subtitleCues : []
  ).map((cue) => ({
    ...(cue?.id ? { id: String(cue.id) } : {}),
    ...(cue?.sourceSegmentIndex != null &&
    Number.isInteger(Number(cue.sourceSegmentIndex))
      ? { sourceSegmentIndex: Number(cue.sourceSegmentIndex) }
      : {}),
    text: String(cue?.text || cue?.label || ""),
    startMs: Math.round(Number(cue?.startMs || 0)),
    endMs: Math.round(Number(cue?.endMs || cue?.startMs || 0)),
    ...(Array.isArray(cue?.captions) && cue.captions.length
      ? { captions: cue.captions }
      : {}),
  }));
  return {
    ...existingTrack,
    id: trackId,
    language,
    label:
      existingTrack.label ||
      (trackId === "original" ? "Original" : `${languageName} translation`),
    origin: trackId === "original" ? "original" : "translation",
    cues,
    style: state?.subtitleStyle || existingTrack.style || null,
    reactions: state?.subtitleReactions || existingTrack.reactions || [],
    reactionStyle:
      state?.subtitleReactionStyle || existingTrack.reactionStyle || null,
    use_word_level_subtitle_timing: state?.useWordLevelSubtitleTiming === true,
  };
};

const upsertSourceTrack = (tracks, nextTrack) => {
  const next = [
    ...(Array.isArray(tracks) ? tracks : []).filter(
      (track) => track.id !== nextTrack.id,
    ),
    nextTrack,
  ];
  return next.sort((left, right) =>
    left.id === "original" ? -1 : right.id === "original" ? 1 : 0,
  );
};

const sourceEditorStateForTrack = (track, baseState) => ({
  ...baseState,
  subtitleLanguage: String(track?.language || "en").toLowerCase(),
  subtitleCues: (Array.isArray(track?.cues) ? track.cues : []).map(
    (cue, index) => {
      const text = String(cue?.text || cue?.label || "");
      return {
        id: cue?.id || `${track?.id || "subtitle"}-${index}`,
        type: "subtitle",
        ...(cue?.sourceSegmentIndex != null &&
        Number.isInteger(Number(cue.sourceSegmentIndex))
          ? { sourceSegmentIndex: Number(cue.sourceSegmentIndex) }
          : {}),
        text,
        label: text,
        startMs: Number(cue?.startMs || 0),
        endMs: Number(cue?.endMs || cue?.startMs || 0),
        ...(Array.isArray(cue?.captions) ? { captions: cue.captions } : {}),
      };
    },
  ),
  subtitleStyle: track?.style || baseState.subtitleStyle,
  subtitleReactions: track?.reactions || [],
  subtitleReactionStyle: track?.reactionStyle || null,
  useWordLevelSubtitleTiming: track?.use_word_level_subtitle_timing === true,
});

export default function SourceTranscriptEditor({ projectId, onClose }) {
  const [source, setSource] = useState(null);
  const [editorState, setEditorState] = useState(null);
  const [subtitleTracks, setSubtitleTracks] = useState([]);
  const [baselineSubtitleTracks, setBaselineSubtitleTracks] = useState([]);
  const [activeTrackId, setActiveTrackId] = useState("original");
  const [editorStateRevision, setEditorStateRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { url: videoUrl } = useRenewableMediaUrl(
    source?.source_video_url ? getApiUrl(source.source_video_url) : "",
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setNotice("");

    fetch(
      getApiUrl(
        `/api/projects/${encodeURIComponent(projectId)}/source-transcript`,
      ),
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return response.json();
      })
      .then(async (payload) => {
        if (!payload?.transcript || !payload?.source_video_url) {
          throw new Error(
            "The complete source video or transcript is unavailable.",
          );
        }
        const [nextEditorState, subtitleStyle] = await Promise.all([
          Promise.resolve(transcriptToSourceEditorState(payload.transcript)),
          readClipSubtitleStyle(projectId, controller.signal),
        ]);
        const savedTracks = Array.isArray(payload.subtitle_tracks)
          ? payload.subtitle_tracks
          : [];
        const originalTrack =
          savedTracks.find((track) => track?.id === "original") || {};
        nextEditorState.useWordLevelSubtitleTiming =
          originalTrack.use_word_level_subtitle_timing ??
          payload.use_word_timings === true;
        nextEditorState.subtitleStyle = originalTrack.style || subtitleStyle;
        nextEditorState.subtitleReactions = originalTrack.reactions || [];
        nextEditorState.subtitleReactionStyle =
          originalTrack.reactionStyle || null;
        const nextSubtitleTracks = upsertSourceTrack(
          savedTracks.filter((track) => track?.id !== "original"),
          sourceTrackFromEditorState(
            "original",
            nextEditorState,
            originalTrack,
          ),
        );
        setSource(payload);
        setEditorState(nextEditorState);
        setSubtitleTracks(nextSubtitleTracks);
        setBaselineSubtitleTracks(nextSubtitleTracks);
        setActiveTrackId("original");
        setEditorStateRevision((current) => current + 1);
      })
      .catch((fetchError) => {
        if (fetchError?.name !== "AbortError") {
          setError(
            fetchError.message || "Could not load the source transcript.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [projectId]);

  const currentSubtitleTracks = useMemo(() => {
    if (!editorState) return subtitleTracks;
    return upsertSourceTrack(
      subtitleTracks,
      sourceTrackFromEditorState(
        activeTrackId,
        editorState,
        subtitleTracks.find((track) => track.id === activeTrackId),
      ),
    );
  }, [activeTrackId, editorState, subtitleTracks]);
  const isDirty = useMemo(
    () =>
      JSON.stringify(currentSubtitleTracks) !==
      JSON.stringify(baselineSubtitleTracks),
    [baselineSubtitleTracks, currentSubtitleTracks],
  );

  const saveTranscript = useCallback(async () => {
    if (!source?.transcript || !editorState || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    let nextTracks = currentSubtitleTracks;
    const originalTrack = currentSubtitleTracks.find(
      (track) => track.id === "original",
    );
    const originalBaseline = baselineSubtitleTracks.find(
      (track) => track.id === "original",
    );
    const originalCuesChanged =
      JSON.stringify(originalTrack?.cues || []) !==
      JSON.stringify(originalBaseline?.cues || []);
    const transcript = originalCuesChanged
      ? applySourceEditorCues(
          source.transcript,
          sourceEditorStateForTrack(originalTrack, editorState).subtitleCues,
        )
      : null;

    try {
      const response = await fetch(
        getApiUrl(
          `/api/projects/${encodeURIComponent(projectId)}/source-transcript`,
        ),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subtitle_tracks: nextTracks,
            ...(transcript
              ? {
                  transcript,
                  synchronize_word_timings: false,
                  use_word_timings: false,
                }
              : {}),
          }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));
      const payload = await response.json();
      const savedTranscript = payload?.transcript || transcript;
      let nextEditorState = editorState;
      if (savedTranscript) {
        const savedState = sourceEditorStateForTrack(
          {
            ...originalTrack,
            cues: transcriptToSourceEditorState(savedTranscript).subtitleCues,
          },
          editorState,
        );
        nextTracks = upsertSourceTrack(
          nextTracks,
          sourceTrackFromEditorState("original", savedState, originalTrack),
        );
        setSource((current) => ({
          ...current,
          transcript: savedTranscript,
          use_word_timings: false,
        }));
        if (activeTrackId === "original") nextEditorState = savedState;
      }
      setEditorState(nextEditorState);
      setSubtitleTracks(nextTracks);
      setBaselineSubtitleTracks(nextTracks);
      setNotice(
        savedTranscript
          ? "Original transcript saved. Original subtitles on existing clips were updated; translated master tracks stay separate."
          : "Subtitle track saved for the master video. Clip subtitles stay unchanged.",
      );
    } catch (saveError) {
      setError(saveError.message || "Could not save the transcript.");
    } finally {
      setSaving(false);
    }
  }, [
    activeTrackId,
    baselineSubtitleTracks,
    currentSubtitleTracks,
    editorState,
    projectId,
    saving,
    source,
  ]);

  const originalEditorState = () => {
    const originalTrack = currentSubtitleTracks.find(
      (track) => track.id === "original",
    );
    const transcriptState = transcriptToSourceEditorState(source?.transcript);
    return {
      ...editorState,
      ...transcriptState,
      subtitleStyle:
        originalTrack?.style ||
        editorState?.subtitleStyle ||
        DEFAULT_SUBTITLE_STYLE,
      subtitleReactions: originalTrack?.reactions || [],
      subtitleReactionStyle: originalTrack?.reactionStyle || null,
      useWordLevelSubtitleTiming:
        originalTrack?.use_word_level_subtitle_timing === true,
    };
  };

  const handleSubtitleTrackChange = (trackId) => {
    if (!trackId || trackId === activeTrackId) return;
    const currentTrack = currentSubtitleTracks.find(
      (track) => track.id === trackId,
    );
    if (!currentTrack) return;
    const baseState = originalEditorState();
    const nextState = sourceEditorStateForTrack(currentTrack, baseState);
    setSubtitleTracks(currentSubtitleTracks);
    setActiveTrackId(trackId);
    setEditorState(nextState);
    setEditorStateRevision((current) => current + 1);
  };

  const handleSubtitleTrackCreate = (track) => {
    if (!track?.id || !editorState) return;
    const nextTracks = upsertSourceTrack(currentSubtitleTracks, track);
    const nextState = sourceEditorStateForTrack(track, originalEditorState());
    setSubtitleTracks(nextTracks);
    setActiveTrackId(track.id);
    setEditorState(nextState);
    setEditorStateRevision((current) => current + 1);
  };

  const saveAction = (
    <Button
      variant="ghost"
      type="button"
      onClick={saveTranscript}
      disabled={!isDirty || saving}
      className="flex items-center gap-1 rounded-md bg-emerald-500 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {saving ? (
        <Loader2 size={13} className="animate-spin" />
      ) : (
        <Save size={13} />
      )}
      {saving
        ? "Saving…"
        : activeTrackId === "original"
          ? "Save subtitle tracks"
          : "Save master track"}
    </Button>
  );

  return (
    <div className="fixed inset-0 z-[70] flex h-[100dvh] flex-col bg-[#0d0d0f] text-white">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/10 px-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-white">
            Full source video · {projectId}
          </p>
          <p className="text-[10px] text-zinc-500">
            Original transcript edits update original subtitles on existing
            clips; translated master tracks stay separate.
          </p>
        </div>
        <Button
          variant="ghost"
          type="button"
          onClick={onClose}
          aria-label="Close full source editor"
          className="ml-3 rounded-md p-2 text-zinc-400 hover:bg-white/10 hover:text-white"
        >
          <X size={16} />
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="mx-3 mt-2 shrink-0 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="mx-3 mt-2 shrink-0 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100"
        >
          {notice}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {loading || !editorState || !videoUrl ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-400">
            <Loader2 size={18} className="animate-spin" />
            {error || "Loading the full video and transcript…"}
          </div>
        ) : (
          <LocalEditorTab
            initialVideoUrl={videoUrl}
            initialVideoName={`Full source · ${projectId}`}
            initialProjectId={projectId}
            initialClipIndex={null}
            initialPlaybackStartMs={0}
            initialPlaybackDurationMs={
              Number(source.source_duration_seconds) * 1000
            }
            initialEditorState={editorState}
            initialStateKey={`source:${activeTrackId}:${editorStateRevision}`}
            scaleSubtitlePreviewToOutput
            activeSubtitleTrackId={activeTrackId}
            subtitleTracks={currentSubtitleTracks}
            onSubtitleTrackChange={handleSubtitleTrackChange}
            onSubtitleTrackCreate={handleSubtitleTrackCreate}
            allowFullSourceTranscription
            onStateChange={setEditorState}
            onClose={onClose}
            headerActions={saveAction}
            persistHistory={false}
            allowLocalUpload={false}
            editorTitle="Full Video Transcript"
            hideExport
            initialFeature="subtitles"
            initialSubtitleView="table"
          />
        )}
      </div>
    </div>
  );
}
