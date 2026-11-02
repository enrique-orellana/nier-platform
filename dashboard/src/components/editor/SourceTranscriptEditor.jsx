import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Save, X } from "lucide-react";
import { getApiUrl } from "../../config";
import { useRenewableMediaUrl } from "../../lib/videoUrls";
import LocalEditorTab from "../local-editor/LocalEditorTab";
import {
  applySourceEditorCues,
  transcriptToSourceEditorState,
} from "./sourceTranscriptEditorState";

const readError = async (response) => {
  const payload = await response.json().catch(() => null);
  return (
    payload?.detail || payload?.error || `Request failed (${response.status})`
  );
};

export default function SourceTranscriptEditor({ projectId, onClose }) {
  const [source, setSource] = useState(null);
  const [editorState, setEditorState] = useState(null);
  const [baselineCues, setBaselineCues] = useState([]);
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
      .then((payload) => {
        if (!payload?.transcript || !payload?.source_video_url) {
          throw new Error(
            "The complete source video or transcript is unavailable.",
          );
        }
        const nextEditorState = transcriptToSourceEditorState(
          payload.transcript,
        );
        setSource(payload);
        setEditorState(nextEditorState);
        setBaselineCues(nextEditorState.subtitleCues);
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

  const isDirty = useMemo(
    () =>
      JSON.stringify(editorState?.subtitleCues || []) !==
      JSON.stringify(baselineCues),
    [baselineCues, editorState],
  );

  const saveTranscript = useCallback(async () => {
    if (!source?.transcript || !editorState || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    const transcript = applySourceEditorCues(
      source.transcript,
      editorState.subtitleCues,
    );

    try {
      const response = await fetch(
        getApiUrl(
          `/api/projects/${encodeURIComponent(projectId)}/source-transcript`,
        ),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));
      const payload = await response.json();
      const savedTranscript = payload?.transcript || transcript;
      const nextEditorState = transcriptToSourceEditorState(savedTranscript);
      setSource((current) => ({ ...current, transcript: savedTranscript }));
      setEditorState((current) => ({
        ...current,
        subtitleCues: nextEditorState.subtitleCues,
      }));
      setBaselineCues(nextEditorState.subtitleCues);
      setNotice(
        "Transcript saved. Original subtitles are updated on the clips.",
      );
    } catch (saveError) {
      setError(saveError.message || "Could not save the transcript.");
    } finally {
      setSaving(false);
    }
  }, [editorState, projectId, saving, source]);

  const saveAction = (
    <button
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
      {saving ? "Saving…" : "Save subtitles to clips"}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[70] flex h-[100dvh] flex-col bg-[#0d0d0f] text-white">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/10 px-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-white">
            Full source video · {projectId}
          </p>
          <p className="text-[10px] text-zinc-500">
            Transcript edits update original subtitles on existing clips; clip
            cuts stay unchanged.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close full source editor"
          className="ml-3 rounded-md p-2 text-zinc-400 hover:bg-white/10 hover:text-white"
        >
          <X size={16} />
        </button>
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
            activeSubtitleTrackId="original"
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
