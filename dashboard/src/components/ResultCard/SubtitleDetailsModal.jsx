import React, { useEffect, useMemo, useState } from "react";
import { Clock3, Download, FileText, Loader2, X } from "lucide-react";
import { getApiUrl } from "../../config";
import RemotionPreview from "../RemotionPreview";
import { normalizeSubtitleStyle } from "../local-editor/localEditorStyles";
import { formatClock } from "../local-editor/localEditorExport";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui";

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

const formatTimestamp = (milliseconds, fps) => formatClock(milliseconds, fps);

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
  const fps = Math.max(1, Number(clip.output_fps || clip.fps) || 30);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showClose={false}
        closeOnEscape={false}
        closeOnInteractOutside={false}
        overlayClassName="z-[110]"
        className="relative z-[110] flex max-h-[92vh] w-[calc(100%-2rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="flex flex-row items-start justify-between gap-4 border-b px-5 py-4 text-left sm:text-left">
          <div>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <FileText className="size-4 text-primary" /> Subtitle details
            </DialogTitle>
            <DialogDescription className="mt-1">
              Verify the saved cues and their exact timing before rendering.
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            type="button"
            onClick={onClose}
            aria-label="Close subtitle details"
            size="icon"
          >
            <X className="size-4" />
          </Button>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[minmax(240px,0.7fr)_minmax(420px,1.3fr)]">
          <section className="flex min-h-[420px] items-center justify-center overflow-hidden rounded-md border bg-black">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading subtitle cues…
              </div>
            ) : cues.length > 0 ? (
              <RemotionPreview
                videoUrl={videoUrl}
                videoStartSeconds={clip.start || 0}
                durationInSeconds={durationSec}
                fps={clip.output_fps || 30}
                width={clip.output_width || 1080}
                height={clip.output_height || 1920}
                subtitles={subtitleConfig}
              />
            ) : (
              <div className="px-8 text-center text-sm text-muted-foreground">
                No subtitle cues are saved for this clip yet.
              </div>
            )}
          </section>

          <section className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock3 className="size-4 text-primary" />
                {cues.length} {cues.length === 1 ? "cue" : "cues"}
                {track?.language ? ` · ${track.language}` : ""}
              </div>
              {clip.subtitle_url && (
                <Button asChild variant="outline" size="sm">
                  <a href={getApiUrl(clip.subtitle_url)} download>
                    <Download className="size-4" /> Download SRT
                  </a>
                </Button>
              )}
            </div>
            {error && (
              <div
                role="alert"
                className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </div>
            )}
            <div className="overflow-hidden rounded-md border">
              <div className="grid grid-cols-[1fr_auto] gap-3 border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
                <span>Caption</span>
                <span>Clip time · Master time</span>
              </div>
              <div className="max-h-[52vh] overflow-y-auto">
                {cues.map((cue) => (
                  <div
                    key={cue.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b px-3 py-3 last:border-b-0"
                  >
                    <span className="min-w-0 break-words text-sm">
                      {cue.text}
                    </span>
                    <span className="whitespace-nowrap text-right font-mono text-xs leading-5 text-muted-foreground">
                      <span className="block">
                        {formatTimestamp(cue.startMs, fps)} →{" "}
                        {formatTimestamp(cue.endMs, fps)}
                      </span>
                      <span className="block text-primary">
                        {formatTimestamp(masterStartMs + cue.startMs, fps)} →{" "}
                        {formatTimestamp(masterStartMs + cue.endMs, fps)}
                      </span>
                    </span>
                  </div>
                ))}
                {!loading && !cues.length && (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Generate subtitles first, then reopen this detail view.
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
