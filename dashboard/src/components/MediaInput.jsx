import React, { useState } from "react";
import { Database, Upload, FileVideo, X } from "lucide-react";
import MinioObjectPicker from "./MinioObjectPicker";
import { SUBTITLE_LANGUAGES } from "./subtitleLanguages";

export default function MediaInput({
  onProcess,
  isProcessing,
  targetClipCount,
  onTargetClipCountChange,
}) {
  const [mode, setMode] = useState("minio"); // 'minio' | 'file'
  const [selectedObject, setSelectedObject] = useState(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [file, setFile] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [layoutFormat, setLayoutFormat] = useState("standard");
  const [facecamSize, setFacecamSize] = useState("medium");
  const [transcriptionLanguage, setTranscriptionLanguage] = useState("auto");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!acknowledged) return;
    if (mode === "minio" && selectedObject) {
      onProcess({
        type: "minio-object",
        payload: { bucket: selectedObject.bucket, key: selectedObject.key },
        sourceUrl: sourceUrl.trim(),
        acknowledged: true,
        layoutFormat,
        facecamSize,
        transcriptionLanguage,
      });
    } else if (mode === "file" && file) {
      onProcess({
        type: "file",
        payload: file,
        sourceUrl: sourceUrl.trim(),
        acknowledged: true,
        layoutFormat,
        facecamSize,
        transcriptionLanguage,
      });
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setMode("file");
    }
  };

  return (
    <div className="bg-surface border border-white/5 rounded-2xl p-6 animate-[fadeIn_0.6s_ease-out]">
      <div className="flex gap-4 mb-6 border-b border-white/5 pb-4">
        <button
          type="button"
          onClick={() => setMode("minio")}
          className={`flex items-center gap-2 pb-2 px-2 transition-all ${
            mode === "minio"
              ? "text-primary border-b-2 border-primary -mb-[17px]"
              : "text-zinc-400 hover:text-white"
          }`}
        >
          <Database size={18} />
          Select from MinIO
        </button>
        <button
          type="button"
          onClick={() => setMode("file")}
          className={`flex items-center gap-2 pb-2 px-2 transition-all ${
            mode === "file"
              ? "text-primary border-b-2 border-primary -mb-[17px]"
              : "text-zinc-400 hover:text-white"
          }`}
        >
          <Upload size={18} />
          Upload File
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        {mode === "minio" ? (
          <MinioObjectPicker
            selected={selectedObject}
            onSelect={setSelectedObject}
          />
        ) : (
          <div
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
              file
                ? "border-primary/50 bg-primary/5"
                : "border-zinc-700 hover:border-zinc-500 bg-white/5"
            }`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            {file ? (
              <div className="flex items-center justify-center gap-3 text-white">
                <FileVideo className="text-primary" />
                <span className="font-medium">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="p-1 hover:bg-white/10 rounded-full"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <label className="cursor-pointer block">
                <input
                  type="file"
                  accept="video/*"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                <Upload className="mx-auto mb-3 text-zinc-500" size={24} />
                <p className="text-zinc-400">
                  Click to upload or drag and drop
                </p>
                <p className="text-xs text-zinc-600 mt-1">
                  MP4, MOV up to 500MB
                </p>
              </label>
            )}
          </div>
        )}

        <div className="mt-5 space-y-2">
          <label
            htmlFor="original-source-url"
            className="text-xs uppercase tracking-[0.2em] text-zinc-500"
          >
            Original Source URL{" "}
            <span className="normal-case tracking-normal text-zinc-600">
              (optional)
            </span>
          </label>
          <input
            id="original-source-url"
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://www.twitch.tv/videos/2842570758"
            className="input-field"
          />
          <p className="text-xs text-zinc-500">
            Add the original YouTube or Twitch page to improve creator, topic,
            event, and location accuracy. It is used for context only, not to
            download the processing video.
          </p>
        </div>

        <div className="mt-5">
          <label
            htmlFor="transcription-source-language"
            className="text-xs uppercase tracking-[0.2em] text-zinc-500"
          >
            Transcription source language
          </label>
          <select
            id="transcription-source-language"
            aria-label="Transcription source language"
            value={transcriptionLanguage}
            onChange={(e) => setTranscriptionLanguage(e.target.value)}
            className="input-field mt-2"
          >
            <option value="auto">Auto-detect</option>
            {Object.entries(SUBTITLE_LANGUAGES).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-zinc-500">
            Choose the spoken language to keep the transcript in its original
            language for this generation only.
          </p>
        </div>

        <div className="mt-5">
          <label
            htmlFor="video-format"
            className="text-xs uppercase tracking-[0.2em] text-zinc-500"
          >
            Video format
          </label>
          <select
            id="video-format"
            value={layoutFormat}
            onChange={(e) => setLayoutFormat(e.target.value)}
            className="input-field mt-2"
          >
            <option value="standard">Standard 9:16</option>
            <option value="streamer_stack">Streamer Stack</option>
          </select>
          {layoutFormat === "streamer_stack" && (
            <>
              <label
                htmlFor="facecam-size"
                className="block text-xs uppercase tracking-[0.2em] text-zinc-500 mt-4"
              >
                Facecam size
              </label>
              <select
                id="facecam-size"
                value={facecamSize}
                onChange={(e) => setFacecamSize(e.target.value)}
                className="input-field mt-2"
              >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </>
          )}
        </div>

        <div className="mt-5">
          <label className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-zinc-500 mb-2">
            <span>Target clips</span>
            <span className="text-zinc-400 normal-case tracking-normal">
              {targetClipCount} clips
            </span>
          </label>
          <select
            value={targetClipCount}
            onChange={(e) => onTargetClipCountChange(Number(e.target.value))}
            className="input-field"
          >
            {Array.from({ length: 13 }, (_, i) => i + 3).map((count) => (
              <option key={count} value={count}>
                {count} clips
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-zinc-500">
            The model will aim for this many viral moments. Longer videos can
            still return fewer if the content is weak.
          </p>
        </div>

        <label className="flex items-start gap-2 mt-5 text-xs text-zinc-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 accent-primary cursor-pointer"
          />
          <span>
            I confirm I own this content or have the rights to process it. I am
            responsible for any content I submit. See our{" "}
            <a
              href="/#legal"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
              onClick={(e) => e.stopPropagation()}
            >
              Terms & Privacy
            </a>
            .
          </span>
        </label>

        <button
          type="submit"
          disabled={
            isProcessing ||
            !acknowledged ||
            (mode === "minio" && !selectedObject) ||
            (mode === "file" && !file)
          }
          className="w-full btn-primary mt-4 flex items-center justify-center gap-2"
        >
          {isProcessing ? (
            <>
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Processing Video...
            </>
          ) : (
            <>Generate Clips</>
          )}
        </button>
      </form>
    </div>
  );
}
