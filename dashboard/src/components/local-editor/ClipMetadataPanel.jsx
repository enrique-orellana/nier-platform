import { useEffect, useState } from "react";
import { Instagram, Loader2, Video, Wand2, Youtube } from "lucide-react";
import { getApiUrl } from "../../config";
import { getLocalAiHeaders, subtitleTextFromCues } from "./localEditorAi";

const finiteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatDuration = (seconds) => {
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainder = String(rounded % 60).padStart(2, "0");
  return `${minutes}m ${remainder}s`;
};

export default function ClipMetadataPanel({
  clip = {},
  subtitleCues = [],
  videoName = "",
  fps = null,
  width = null,
  height = null,
  hashtags,
  onHashtagsChange,
}) {
  const metadata = clip || {};
  const title = metadata.video_title_for_youtube_short || metadata.title || "";
  const caption =
    metadata.video_description_for_tiktok ||
    metadata.video_description_for_instagram ||
    metadata.description ||
    "";
  const start = finiteNumber(metadata.start);
  const end = finiteNumber(metadata.end);
  const duration = end > start ? end - start : finiteNumber(metadata.duration);
  const fallbackHashtags =
    Array.isArray(metadata.hashtags) && metadata.hashtags.length
      ? metadata.hashtags
      : ["#shorts", "#viral"];
  const initialHashtags =
    Array.isArray(hashtags) && hashtags.length ? hashtags : fallbackHashtags;
  const hasExplicitHashtags =
    (Array.isArray(hashtags) && hashtags.length > 0) ||
    (Array.isArray(metadata.hashtags) && metadata.hashtags.length > 0);
  const [generatedHashtags, setGeneratedHashtags] = useState(initialHashtags);
  const [generatingHashtags, setGeneratingHashtags] = useState(false);
  const [hashtagError, setHashtagError] = useState("");
  const outputWidth = finiteNumber(width || metadata.output_width);
  const outputHeight = finiteNumber(height || metadata.output_height);
  const frameRate = finiteNumber(fps || metadata.output_fps || metadata.fps);
  const sourceName =
    videoName ||
    metadata.source_file_name ||
    metadata.file_name ||
    metadata.filename ||
    "Project video";
  const projectName =
    metadata.name || metadata.project_name || title || "Local project";
  const timelineName = metadata.timeline_name || "Timeline 01";
  const resolution =
    outputWidth > 0 && outputHeight > 0
      ? `${outputWidth} × ${outputHeight}`
      : metadata.resolution || "Adapted";
  let aspectRatio = metadata.aspect_ratio || "9:16";
  if (outputWidth > 0 && outputHeight > 0) {
    let ratioWidth = outputWidth;
    let ratioHeight = outputHeight;
    while (ratioHeight) {
      const remainder = ratioWidth % ratioHeight;
      ratioWidth = ratioHeight;
      ratioHeight = remainder;
    }
    aspectRatio = `${outputWidth / ratioWidth}:${outputHeight / ratioWidth}`;
  }

  useEffect(() => {
    if (Array.isArray(hashtags) && hashtags.length)
      setGeneratedHashtags(hashtags);
  }, [hashtags]);

  const generateHashtags = async () => {
    setGeneratingHashtags(true);
    setHashtagError("");
    try {
      const response = await fetch(getApiUrl("/api/local-editor/hashtags"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getLocalAiHeaders() },
        body: JSON.stringify({
          title,
          caption,
          subtitle_text: subtitleTextFromCues(subtitleCues),
          source_context: metadata.source_context || null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(payload.detail || "Could not generate hashtags.");
      const nextHashtags = Array.isArray(payload.hashtags)
        ? payload.hashtags
        : [];
      if (!nextHashtags.length) throw new Error("The AI returned no hashtags.");
      setGeneratedHashtags(nextHashtags);
      onHashtagsChange?.(nextHashtags);
    } catch (error) {
      setHashtagError(error.message || "Could not generate hashtags.");
    } finally {
      setGeneratingHashtags(false);
    }
  };

  if (!title && !caption && duration <= 0 && !hasExplicitHashtags) return null;

  return (
    <section
      className="min-w-0 border-b border-white/10 pb-3"
      aria-label="Clip metadata"
    >
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300/80">
        Clip details
      </p>
      {title && (
        <h3 className="break-words text-base font-semibold leading-snug text-zinc-100">
          {title}
        </h3>
      )}
      <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono text-zinc-500">
        {duration > 0 && (
          <span className="rounded-sm border border-white/10 px-1.5 py-0.5">
            {formatDuration(duration)}
          </span>
        )}
        <div
          className="flex flex-wrap items-center gap-1.5 rounded-sm border border-white/10 px-1.5 py-0.5"
          role="group"
          aria-label="Hashtags"
        >
          {generatedHashtags.map((hashtag) => (
            <span key={hashtag}>{hashtag}</span>
          ))}
        </div>
      </div>
      <div className="mt-2.5">
        <button
          type="button"
          onClick={generateHashtags}
          disabled={generatingHashtags}
          className="flex items-center gap-1.5 rounded-sm border border-cyan-400/30 px-2 py-1 text-[10px] font-semibold text-cyan-300 transition-colors hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {generatingHashtags ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Wand2 size={12} />
          )}
          {generatingHashtags ? "Generating…" : "Generate hashtags"}
        </button>
        {hashtagError && (
          <p role="alert" className="mt-1.5 text-[10px] leading-4 text-red-300">
            {hashtagError}
          </p>
        )}
      </div>

      {title && (
        <div className="mt-3 border-t border-white/10 pt-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-red-300/90">
            <Youtube size={11} className="shrink-0" />
            <span>YouTube Title</span>
          </div>
          <p className="break-words text-xs leading-5 text-zinc-300">{title}</p>
        </div>
      )}

      {caption && (
        <div className="mt-3 border-t border-white/10 pt-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-zinc-400">
            <Video size={11} className="shrink-0 text-cyan-400" />
            <span className="text-zinc-600">/</span>
            <Instagram size={11} className="shrink-0 text-pink-400" />
            <span>Caption</span>
          </div>
          <p className="break-words text-xs leading-5 text-zinc-300">
            {caption}
          </p>
        </div>
      )}

      <dl className="mt-3 border-t border-white/10 pt-2.5 text-xs">
        {[
          ["Name", projectName],
          ["Timeline", timelineName],
          ["Source", sourceName],
          ["Aspect ratio", aspectRatio],
          ["Resolution", resolution],
          ["Frame rate", `${frameRate || 30} fps`],
          ["Subtitles", `${subtitleCues.length} cues`],
        ].map(([label, value]) => (
          <div
            key={label}
            className="grid grid-cols-[minmax(84px,0.8fr)_minmax(0,1.4fr)] gap-3 border-b border-white/5 py-1.5 last:border-b-0"
          >
            <dt className="text-zinc-500">{label}</dt>
            <dd className="min-w-0 break-words text-zinc-300">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
