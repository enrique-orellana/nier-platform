import React, { useEffect, useMemo, useState } from "react";
import { Clock3, Download, FileText, Loader2, X } from "lucide-react";
import { getApiUrl } from "../../config";
import RemotionPreview from "../RemotionPreview";
import { normalizeSubtitleStyle } from "../local-editor/localEditorStyles";

const toCueList = (track) =>
  (track?.cues || track?.captions || [])
    .flatMap((cue) => {
      if (Array.isArray(cue?.captions) && !cue.text && !cue.word) {
        return cue.captions;
      }
      return [cue];
    })
    .map((cue, index) => ({
      id: cue.id || `subtitle-${index}`,
      text: String(cue.text || cue.word || "").trim(),
      startMs: Math.max(0, Math.round(Number(cue.startMs || 0))),
      endMs: Math.max(0, Math.round(Number(cue.endMs || cue.startMs || 0))),
    }))
    .filter((cue) => cue.text && cue.endMs > cue.startMs);

const formatTimestamp = (milliseconds) => {
  const totalMs = Math.max(0, Math.round(Number(milliseconds) || 0));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
};

const trackFromClip = (clip) => {
  const tracks = Array.isArray(clip?.subtitle_tracks)
    ? clip.subtitle_tracks
    : [];
  const activeId = clip?.active_subtitle_track_id || tracks[0]?.id;
  const activeTrack =
    tracks.find((track) => track.id === activeId) || tracks[0];
  if (activeTrack) return activeTrack;
  if (clip?.subtitles) return clip.subtitles;
  return null;
};

const styleFromTrack = (track, clip) => {
  const savedStyle = track?.style || clip?.layers?.subtitles?.style || {};
  return normalizeSubtitleStyle({
    ...savedStyle,
    bgColor: savedStyle.bgColor ?? savedStyle.backgroundColor,
    bgOpacity: savedStyle.bgOpacity ?? savedStyle.backgroundOpacity,
  });
};

export default function SubtitleDetailsModal({
  isOpen,
  onClose,
  clip = {},
  videoUrl,
  jobId,
  clipIndex,
  initialLayer = null,
}) {
  const savedTrack = trackFromClip(clip);
  const [track, setTrack] = useState(savedTrack);
  const [durationSec, setDurationSec] = useState(
    Math.max(0, Number(clip.end || 0) - Number(clip.start || 0)) || 30,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    const currentTrack = trackFromClip(clip);
    if (currentTrack || initialLayer?.captions?.length) {
      setTrack(
        currentTrack || {
          id: "current",
          label: "Current subtitles",
          captions: initialLayer.captions,
        },
      );
      setDurationSec(
        Math.max(0, Number(clip.end || 0) - Number(clip.start || 0)) || 30,
      );
      return;
    }
    if (!jobId || clipIndex === undefined) {
      setTrack(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetch(getApiUrl(`/api/clip/${jobId}/${clipIndex}/transcript`))
      .then((response) =>
        response.ok
          ? response.json()
          : response
              .json()
              .then((body) =>
                Promise.reject(
                  new Error(body.detail || "Subtitle transcript unavailable."),
                ),
              ),
      )
      .then((data) => {
        if (cancelled) return;
        setTrack({
          id: "transcript",
          label: "Transcript preview",
          language: data.language,
          captions: data.captions || [],
        });
        setDurationSec(Number(data.durationSec) || 30);
      })
      .catch((fetchError) => {
        if (!cancelled) {
          setTrack(null);
          setError(fetchError.message || "Subtitle transcript unavailable.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, jobId, clipIndex, clip, initialLayer]);

  const cues = useMemo(() => toCueList(track), [track]);
  const subtitleConfig = useMemo(
    () => ({
      captions: cues,
      position:
        track?.position || clip?.layers?.subtitles?.position || "bottom",
      style: styleFromTrack(track, clip),
    }),
    [clip, cues, track],
  );
  const masterStartMs = Math.max(0, Math.round(Number(clip.start || 0) * 1000));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#121214] shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-white">
              <FileText className="text-cyan-300" size={19} /> Subtitle details
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Verify the saved cues and their exact timing before rendering.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close subtitle details"
            className="rounded-lg p-2 text-zinc-500 hover:bg-white/10 hover:text-white"
          >
            <X size={20} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[minmax(240px,0.7fr)_minmax(420px,1.3fr)]">
          <section className="flex min-h-[420px] items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Loader2 size={16} className="animate-spin" />
                Loading subtitle cues…
              </div>
            ) : cues.length > 0 ? (
              <RemotionPreview
                videoUrl={videoUrl}
                durationInSeconds={durationSec}
                fps={clip.output_fps || 30}
                width={clip.output_width || 1080}
                height={clip.output_height || 1920}
                subtitles={subtitleConfig}
              />
            ) : (
              <div className="px-8 text-center text-sm text-zinc-500">
                No subtitle cues are saved for this clip yet.
              </div>
            )}
          </section>

          <section className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
                <Clock3 size={14} className="text-cyan-300" />
                {cues.length} {cues.length === 1 ? "cue" : "cues"}
                {track?.language ? ` · ${track.language}` : ""}
              </div>
              {clip.subtitle_url && (
                <a
                  href={getApiUrl(clip.subtitle_url)}
                  download
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 hover:bg-white/10"
                >
                  <Download size={13} />
                  Download SRT
                </a>
              )}
            </div>
            {error && (
              <div className="mb-3 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                {error}
              </div>
            )}
            <div className="overflow-hidden rounded-xl border border-white/10">
              <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-white/10 bg-white/5 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                <span>Caption</span>
                <span>Clip time · Master time</span>
              </div>
              <div className="max-h-[52vh] overflow-y-auto">
                {cues.map((cue) => (
                  <div
                    key={cue.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-white/5 px-3 py-3 last:border-b-0"
                  >
                    <span className="min-w-0 break-words text-sm text-white">
                      {cue.text}
                    </span>
                    <span className="whitespace-nowrap text-right font-mono text-[10px] leading-5 text-zinc-400">
                      <span className="block">
                        {formatTimestamp(cue.startMs)} →{" "}
                        {formatTimestamp(cue.endMs)}
                      </span>
                      <span className="block text-cyan-300/70">
                        {formatTimestamp(masterStartMs + cue.startMs)} →{" "}
                        {formatTimestamp(masterStartMs + cue.endMs)}
                      </span>
                    </span>
                  </div>
                ))}
                {!loading && !cues.length && (
                  <div className="px-4 py-10 text-center text-sm text-zinc-500">
                    Generate subtitles first, then reopen this detail view.
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
