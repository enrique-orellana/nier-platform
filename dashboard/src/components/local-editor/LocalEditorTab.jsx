import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  Download,
  FastForward,
  FileText,
  Film,
  FolderOpen,
  Languages,
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Plus,
  Redo2,
  Repeat,
  Rewind,
  RotateCcw,
  Save,
  SkipBack,
  SkipForward,
  Square,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import LocalEditorTimeline from "./LocalEditorTimeline";
import ClipMetadataPanel from "./ClipMetadataPanel";
import SubtitleCueTable from "./SubtitleCueTable";
import SubtitleCueModal from "./SubtitleCueModal";
import RemotionPreview from "../RemotionPreview";
import { parseSubtitleFile, serializeSrt } from "./subtitleFormats";
import { activeCueAt, formatClock } from "./localEditorExport";
import {
  burnLocalEditorSubtitles,
  cueCaptionsForRender,
  cleanSubtitleCue,
  renderLocalVideoOnBackend,
  syncSubtitleCue,
} from "./localEditorRender";
import {
  detectEmbeddedSideBars,
  getFilledFrameDimensions,
} from "./localEditorVideo";
import {
  clipTimeToSourceTime,
  sourceTimeToClipTime,
} from "./localEditorPlayback";
import { getApiUrl } from "../../config";
import { createSubtitleCue } from "../../editor/timelineModel";
import { groupCaptionsIntoBlocks } from "../../remotion/lib/captions";
import {
  getHookAnimationStyle,
  getHookBoxStyle,
  getHookPositionStyle,
} from "../../remotion/lib/hookVisual";
import LocalEditorProjects from "./LocalEditorProjects";
import { getLocalAiHeaders } from "./localEditorAi";
import {
  createEmptyEditorHistory,
  createStoredProject,
  deleteStoredProject,
  EDITOR_HISTORY_LIMIT,
  EDITOR_HISTORY_STORAGE_KEY,
  getActiveProjectId,
  listStoredProjects,
  loadStoredProject,
  migrateLegacyProject,
  readEditorHistory,
  renameStoredProject,
  saveEditorHistory,
  saveStoredProject,
  setActiveProjectId,
} from "./localEditorPersistence";
import {
  readEditorPreferences,
  saveEditorPreferences,
  updateEditorPreferencesFromState,
} from "./localEditorPreferences";
import {
  DEFAULT_SUBTITLE_STYLE,
  HOOK_ENTRANCE_OPTIONS,
  HOOK_SIZE_OPTIONS,
  SUBTITLE_ANIMATION_OPTIONS,
  SUBTITLE_COLOR_PRESETS,
  SUBTITLE_FONT_OPTIONS,
  SUBTITLE_HIGHLIGHT_PRESETS,
  hexToRgba,
  normalizeSubtitleStyle,
  subtitlePositionClass,
  toClipGeneratorSubtitleStyle,
} from "./localEditorStyles";
import { SUBTITLE_LANGUAGES } from "../subtitleLanguages";

const DEFAULT_DURATION_MS = 30000;
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const clamp = (value, min, max) =>
  Math.max(min, Math.min(max, Number(value) || 0));

const clampCue = (cue, durationMs) => {
  const duration = Math.max(1, durationMs || DEFAULT_DURATION_MS);
  const startMs = clamp(cue.startMs, 0, Math.max(0, duration - 80));
  const endMs = clamp(cue.endMs, startMs + 80, duration);
  return { ...cue, startMs, endMs };
};

const normalizeGeneratedCues = (captions, durationMs) => {
  const wordCaptions = (Array.isArray(captions) ? captions : [])
    .map((caption) => ({
      text: String(caption?.text || caption?.word || "").trim(),
      startMs: Number(caption?.startMs ?? Number(caption?.start || 0) * 1000),
      endMs: Number(caption?.endMs ?? Number(caption?.end || 0) * 1000),
    }))
    .filter(
      (caption) =>
        caption.text &&
        Number.isFinite(caption.startMs) &&
        Number.isFinite(caption.endMs) &&
        caption.endMs > caption.startMs,
    )
    .sort((left, right) => left.startMs - right.startMs);
  const blocks = wordCaptions.length
    ? groupCaptionsIntoBlocks(wordCaptions).map((block) => ({
        text: block.text,
        startMs: block.startMs,
        endMs: block.endMs,
        captions: block.words.map((word) => ({
          text: word.text,
          startMs: word.startMs,
          endMs: word.endMs,
        })),
      }))
    : [];
  let previousEndMs = 0;
  return blocks
    .map((segment, index) => ({
      id: `generated-${Date.now()}-${index}`,
      type: "subtitle",
      label: segment.text,
      text: segment.text,
      startMs: segment.startMs,
      endMs: segment.endMs,
      captions: segment.captions,
    }))
    .filter(
      (cue) =>
        cue.text &&
        Number.isFinite(cue.startMs) &&
        Number.isFinite(cue.endMs) &&
        cue.endMs > cue.startMs,
    )
    .sort((left, right) => left.startMs - right.startMs)
    .map((cue) => {
      const normalized = clampCue(
        { ...cue, startMs: Math.max(cue.startMs, previousEndMs) },
        durationMs,
      );
      if (normalized.endMs <= normalized.startMs) return null;
      previousEndMs = normalized.endMs;
      return normalized;
    })
    .filter(Boolean);
};

const outlineTextShadow = (width, color) => {
  const borderWidth = Math.max(0, Number(width) || 0);
  if (!borderWidth) return "none";
  return [
    `${borderWidth}px 0 0 ${color}`,
    `-${borderWidth}px 0 0 ${color}`,
    `0 ${borderWidth}px 0 ${color}`,
    `0 -${borderWidth}px 0 ${color}`,
  ].join(", ");
};

const cleanChoiceClass = (selected) =>
  `rounded-lg border p-2 text-center text-xs font-medium transition-all ${selected ? "border-primary bg-primary/20 text-white" : "border-white/5 bg-white/5 text-zinc-400 hover:bg-white/10"}`;
const hookChoiceClass = (selected) =>
  `rounded-lg border px-1 py-2 text-center text-xs font-bold capitalize transition-all ${selected ? "border-white bg-white text-black" : "border-white/5 bg-white/5 text-zinc-400 hover:bg-white/10"}`;
const cleanLabelClass =
  "mb-2 block text-xs font-bold uppercase tracking-wider text-zinc-400";

const downloadBlob = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

const downloadUrl = (url, fileName) => {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
};

function UploadState({ onFile, error }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const chooseFile = (file) => file && onFile(file);
  return (
    <div className="mx-auto flex min-h-[65vh] max-w-2xl items-center justify-center p-6">
      <div
        className={`w-full rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${dragging ? "border-fuchsia-400 bg-fuchsia-500/10" : "border-white/15 bg-white/[.03] hover:border-white/30"}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          chooseFile(event.dataTransfer.files?.[0]);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          aria-label="Upload video"
          className="hidden"
          onChange={(event) => chooseFile(event.target.files?.[0])}
        />
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-fuchsia-500/15 text-fuchsia-300">
          <Upload size={26} />
        </div>
        <h2 className="text-xl font-semibold text-white">
          Upload a video to start editing
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-400">
          Your video stays in your browser. Nothing is uploaded to OpenShorts
          while you edit locally.
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-6 rounded-xl bg-fuchsia-500 px-5 py-3 text-sm font-semibold text-white hover:bg-fuchsia-400"
        >
          Choose local video
        </button>
        <p className="mt-4 text-xs text-zinc-600">
          Drag and drop a playable MP4, WebM, or MOV file
        </p>
        {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
      </div>
    </div>
  );
}

function SubtitleInspector({ cue, onChange, onDelete }) {
  if (!cue)
    return (
      <p className="text-xs text-zinc-500">
        Select a subtitle cue on the timeline to edit it.
      </p>
    );
  const wordTimings = Array.isArray(cue.captions)
    ? cue.captions.filter((word) => String(word?.text || "").trim())
    : [];
  const createWordTimings = () => onChange({ ...cue, captions: undefined });
  const updateWord = (index, field, value) => {
    const captions = wordTimings.map((word, wordIndex) =>
      wordIndex === index
        ? { ...word, [field]: field === "text" ? value : Number(value) }
        : word,
    );
    onChange({
      ...cue,
      text: captions
        .map((word) => word.text || "")
        .join(" ")
        .trim(),
      label: captions
        .map((word) => word.text || "")
        .join(" ")
        .trim(),
      captions,
    });
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-300">
          Subtitle cue
        </h3>
        <button
          type="button"
          onClick={() => onDelete(cue.id)}
          className="text-zinc-500 hover:text-red-300"
          aria-label="Delete subtitle cue"
        >
          <X size={14} />
        </button>
      </div>
      <label className="block text-xs text-zinc-400">
        Subtitle text
        <textarea
          aria-label="Subtitle text"
          rows={3}
          value={cue.text}
          onChange={(event) => onChange({ ...cue, text: event.target.value })}
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white outline-none focus:border-violet-400"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-zinc-400">
          Start (ms)
          <input
            aria-label="Subtitle start"
            type="number"
            value={cue.startMs}
            onChange={(event) =>
              onChange({ ...cue, startMs: Number(event.target.value) })
            }
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white"
          />
        </label>
        <label className="text-xs text-zinc-400">
          End (ms)
          <input
            aria-label="Subtitle end"
            type="number"
            value={cue.endMs}
            onChange={(event) =>
              onChange({ ...cue, endMs: Number(event.target.value) })
            }
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white"
          />
        </label>
      </div>
      <div className="border-t border-white/10 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">
            Word timings
          </h4>
          {!wordTimings.length && (
            <button
              type="button"
              onClick={createWordTimings}
              className="rounded-md border border-cyan-300/30 bg-cyan-400/10 px-2 py-1 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-400/20"
            >
              Create word timings
            </button>
          )}
        </div>
        {wordTimings.length ? (
          <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-cyan-300/15 bg-black/20 p-2">
            {wordTimings.map((word, index) => (
              <div
                key={`${word.startMs}-${index}`}
                className="grid grid-cols-[minmax(0,1fr)_74px_74px] gap-1.5"
              >
                <input
                  aria-label={`Word ${index + 1} text`}
                  value={word.text || ""}
                  onChange={(event) =>
                    updateWord(index, "text", event.target.value)
                  }
                  className="min-w-0 rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-white"
                />
                <input
                  aria-label={`Word ${index + 1} start`}
                  type="number"
                  value={word.startMs}
                  onChange={(event) =>
                    updateWord(index, "startMs", event.target.value)
                  }
                  className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white"
                />
                <input
                  aria-label={`Word ${index + 1} end`}
                  type="number"
                  value={word.endMs}
                  onChange={(event) =>
                    updateWord(index, "endMs", event.target.value)
                  }
                  className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white"
                />
              </div>
            ))}
            <div className="grid grid-cols-[minmax(0,1fr)_74px_74px] gap-1.5 px-2 pt-0.5 text-[9px] uppercase tracking-wider text-zinc-500">
              <span>Word</span>
              <span>Start</span>
              <span>End</span>
            </div>
          </div>
        ) : (
          <p className="text-[11px] leading-5 text-zinc-500">
            No word timings are attached to this cue yet. Create them to enable
            word-level highlighting in the preview and export.
          </p>
        )}
      </div>
    </div>
  );
}

function SubtitleStyleInspector({ style, onChange, onRemove, hasCues }) {
  const current = normalizeSubtitleStyle(style);
  const update = (key, value) => onChange({ ...current, [key]: value });
  return (
    <div className="mt-4 space-y-5 border-t border-white/10 pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">Subtitle Style</h3>
      </div>
      <div>
        <span className={cleanLabelClass}>Position</span>
        <div
          role="group"
          aria-label="Subtitle position"
          className="grid grid-cols-3 gap-2"
        >
          {["top", "middle", "bottom"].map((position) => (
            <button
              key={position}
              type="button"
              onClick={() => update("position", position)}
              className={cleanChoiceClass(current.position === position)}
            >
              {position.charAt(0).toUpperCase() + position.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className={cleanLabelClass}>Animation</span>
        <div className="grid grid-cols-2 gap-2">
          {SUBTITLE_ANIMATION_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => update("animation", option.value)}
              className={cleanChoiceClass(current.animation === option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className={cleanLabelClass}>
          Font
          <select
            aria-label="Subtitle font"
            value={current.fontFamily}
            onChange={(event) => update("fontFamily", event.target.value)}
            className="input-field mt-2"
          >
            {SUBTITLE_FONT_OPTIONS.map((font) => (
              <option key={font} value={font} style={{ fontFamily: font }}>
                {font}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-xs text-zinc-400">
        Font Size
        <input
          aria-label="Subtitle font size"
          type="number"
          min="12"
          max="120"
          value={current.fontSize}
          onChange={(event) => {
            const rawValue = event.target.value;
            update("fontSize", rawValue === "" ? "" : Number(rawValue));
          }}
          onBlur={(event) =>
            update(
              "fontSize",
              Math.min(120, Math.max(12, Number(event.target.value) || 12)),
            )
          }
          className="input-field mt-2"
        />
      </label>
      <div>
        <span className={cleanLabelClass}>Text Color</span>
        <div
          className="flex flex-wrap gap-2"
          aria-label="Subtitle text color presets"
        >
          {SUBTITLE_COLOR_PRESETS.map((preset) => (
            <button
              key={preset.color}
              type="button"
              aria-label={`Use subtitle color ${preset.label}`}
              title={preset.label}
              onClick={() => update("fontColor", preset.color)}
              className={`h-7 w-7 rounded-full border-2 transition-all ${current.fontColor.toUpperCase() === preset.color ? "scale-110 border-white" : "border-white/20 hover:border-white/50"}`}
              style={{ backgroundColor: preset.color }}
            />
          ))}
          <label
            className="relative flex h-7 w-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-white/20 transition-all hover:border-white/50"
            title="Custom color"
          >
            <span className="text-[10px] text-zinc-400">+</span>
            <input
              aria-label="Subtitle text color"
              type="color"
              value={current.fontColor}
              onChange={(event) => update("fontColor", event.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
        </div>
      </div>
      <div>
        <span className={cleanLabelClass}>Highlight Color</span>
        <div
          className="flex flex-wrap gap-2"
          aria-label="Subtitle highlight color presets"
        >
          {SUBTITLE_HIGHLIGHT_PRESETS.map((preset) => (
            <button
              key={preset.color}
              type="button"
              aria-label={`Use subtitle highlight color ${preset.label}`}
              title={preset.label}
              onClick={() => update("highlightColor", preset.color)}
              className={`h-7 w-7 rounded-full border-2 transition-all ${current.highlightColor.toUpperCase() === preset.color ? "scale-110 border-white" : "border-white/20 hover:border-white/50"}`}
              style={{ backgroundColor: preset.color }}
            />
          ))}
        </div>
        <input
          aria-label="Subtitle highlight color"
          type="color"
          value={current.highlightColor}
          onChange={(event) => update("highlightColor", event.target.value)}
          className="sr-only"
        />
      </div>
      <div>
        <span className={cleanLabelClass}>Border</span>
        <div className="flex items-center gap-3">
          <label
            className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-white/10"
            title="Border color"
          >
            <div
              className="h-full w-full"
              style={{ backgroundColor: current.borderColor }}
            />
            <input
              aria-label="Subtitle outline color"
              type="color"
              value={current.borderColor}
              onChange={(event) => update("borderColor", event.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <div className="flex-1">
            <input
              aria-label="Subtitle outline width"
              type="range"
              min="0"
              max="5"
              step="1"
              value={current.borderWidth}
              onChange={(event) =>
                update("borderWidth", Number(event.target.value))
              }
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-zinc-500">
              <span>None</span>
              <span>Thick</span>
            </div>
          </div>
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className={cleanLabelClass.replace("mb-2 ", "")}>
            Background Box
          </span>
          <button
            type="button"
            aria-label={
              current.bgOpacity > 0
                ? "Hide background box"
                : "Show background box"
            }
            aria-pressed={current.bgOpacity > 0}
            onClick={() => update("bgOpacity", current.bgOpacity > 0 ? 0 : 0.5)}
            className={`relative h-4 w-8 rounded-full transition-colors ${current.bgOpacity > 0 ? "bg-primary" : "bg-zinc-700"}`}
          >
            <span
              className={`absolute left-0 top-0 h-4 w-4 rounded-full border border-gray-300 bg-white transition-transform ${current.bgOpacity > 0 ? "translate-x-full" : ""}`}
            />
          </button>
        </div>
        {current.bgOpacity > 0 && (
          <div className="flex items-center gap-3">
            <label
              className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-white/10"
              title="Background color"
            >
              <div
                className="h-full w-full"
                style={{ backgroundColor: current.bgColor }}
              />
              <input
                aria-label="Subtitle background color"
                type="color"
                value={current.bgColor}
                onChange={(event) => update("bgColor", event.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
            <div className="flex-1">
              <input
                aria-label="Subtitle background opacity"
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={current.bgOpacity}
                onChange={(event) =>
                  update("bgOpacity", Number(event.target.value))
                }
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-[10px] text-zinc-500">
                <span>Transparent</span>
                <span>{Math.round(current.bgOpacity * 100)}%</span>
              </div>
            </div>
          </div>
        )}
      </div>
      {!hasCues && (
        <p className="text-[11px] text-zinc-500">
          Import subtitles to enable this style.
        </p>
      )}
      {hasCues && (
        <button
          type="button"
          onClick={onRemove}
          className="w-full rounded-lg border border-red-400/30 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-400/10"
        >
          Remove Subtitles
        </button>
      )}
    </div>
  );
}

function HookInspector({ hook, onChange, onRemove }) {
  if (!hook)
    return (
      <p className="text-xs text-zinc-500">
        Add a hook to place a bold opening message over the video.
      </p>
    );
  const displayDuration = Math.max(
    2,
    Math.round((hook.endMs - hook.startMs) / 1000),
  );
  const updateDuration = (value) =>
    onChange({
      ...hook,
      endMs: Math.max(hook.startMs + 80, hook.startMs + Number(value) * 1000),
    });
  return (
    <div className="space-y-5">
      <h3 className="text-sm font-bold text-white">Viral Hook</h3>
      <label className="block">
        <span className={cleanLabelClass}>Text</span>
        <textarea
          aria-label="Hook text"
          rows={4}
          value={hook.text}
          onChange={(event) => onChange({ ...hook, text: event.target.value })}
          className="w-full resize-none rounded-xl border border-white/10 bg-black/40 p-3 font-serif text-sm text-white placeholder-zinc-600 focus:border-amber-500/50 focus:outline-none"
          placeholder="Enter text that will stop the scroll..."
        />
      </label>
      <div>
        <span className={cleanLabelClass}>Position</span>
        <div className="grid grid-cols-3 gap-2">
          {["top", "center", "bottom"].map((position) => (
            <button
              key={position}
              type="button"
              aria-label={position.charAt(0).toUpperCase() + position.slice(1)}
              onClick={() => onChange({ ...hook, position })}
              className={hookChoiceClass(hook.position === position)}
            >
              {position}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className={cleanLabelClass}>Size</span>
        <div className="grid grid-cols-3 gap-2">
          {HOOK_SIZE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange({ ...hook, size: option.value })}
              className={hookChoiceClass((hook.size || "M") === option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className={cleanLabelClass}>Entrance</span>
        <div className="grid grid-cols-2 gap-2">
          {HOOK_ENTRANCE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() =>
                onChange({ ...hook, entranceAnimation: option.value })
              }
              className={hookChoiceClass(
                (hook.entranceAnimation || "spring") === option.value,
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label
          className={`${cleanLabelClass} flex items-center justify-between`}
        >
          <span>Duration</span>
          <span>{displayDuration}s</span>
        </label>
        <input
          aria-label="Hook duration"
          type="range"
          min="2"
          max="15"
          value={displayDuration}
          onChange={(event) => updateDuration(event.target.value)}
          className="w-full accent-amber-500"
        />
        <div className="flex justify-between text-[10px] text-zinc-500">
          <span>2s</span>
          <span>15s</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-zinc-400">
          Start (ms)
          <input
            aria-label="Hook start"
            type="number"
            value={hook.startMs}
            onChange={(event) =>
              onChange({ ...hook, startMs: Number(event.target.value) })
            }
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white"
          />
        </label>
        <label className="text-xs text-zinc-400">
          End (ms)
          <input
            aria-label="Hook end"
            type="number"
            value={hook.endMs}
            onChange={(event) =>
              onChange({ ...hook, endMs: Number(event.target.value) })
            }
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white"
          />
        </label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs text-zinc-400">
          Text color
          <input
            aria-label="Hook text color"
            type="color"
            value={hook.color}
            onChange={(event) =>
              onChange({ ...hook, color: event.target.value })
            }
            className="mt-1 h-9 w-full rounded border border-white/10 bg-black/30"
          />
        </label>
        <label className="text-xs text-zinc-400">
          Size
          <input
            aria-label="Hook font size"
            type="number"
            min="12"
            max="160"
            value={hook.fontSize}
            onChange={(event) =>
              onChange({ ...hook, fontSize: Number(event.target.value) })
            }
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white"
          />
        </label>
        <label className="text-xs text-zinc-400">
          Background
          <input
            aria-label="Hook background"
            type="color"
            value={hook.background}
            onChange={(event) =>
              onChange({ ...hook, background: event.target.value })
            }
            className="mt-1 h-9 w-full rounded border border-white/10 bg-black/30"
          />
        </label>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="w-full rounded-lg border border-red-400/30 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-400/10"
      >
        Remove Hook
      </button>
    </div>
  );
}

export default function LocalEditorTab({
  initialVideoUrl = "",
  initialExportVideoUrl = "",
  initialVideoName = "",
  initialProjectId = "",
  initialClipIndex = null,
  initialPlaybackStartMs = 0,
  initialPlaybackDurationMs = null,
  remotionPreviewProps = null,
  initialEditorState = null,
  initialStateKey = null,
  onStateChange,
  onClose = null,
  headerActions = null,
  sidePanel = null,
  footer = null,
  persistHistory = true,
  allowLocalUpload = true,
  clipMetadata = null,
  onHashtagsChange = null,
}) {
  const projectClipIndex = Number(initialClipIndex);
  const hasProjectClipSource = Boolean(
    initialProjectId &&
    initialVideoUrl &&
    initialClipIndex !== null &&
    Number.isInteger(projectClipIndex) &&
    projectClipIndex >= 0,
  );
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const remotionPlayerRef = useRef(null);
  const remotionPlayheadRef = useRef(0);
  const remotionPlayheadTimerRef = useRef(null);
  const objectUrlRef = useRef("");
  const previewObjectUrlRef = useRef("");
  const subtitleInputRef = useRef(null);
  const timelineDragRef = useRef(null);
  const videoRestoreGenerationRef = useRef(0);
  const videoLoadStartedRef = useRef(false);
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [previewVideoUrl, setPreviewVideoUrl] = useState("");
  const [durationMs, setDurationMs] = useState(DEFAULT_DURATION_MS);
  const [playheadMs, setPlayheadMs] = useState(0);
  const editorPreferencesRef = useRef(readEditorPreferences());
  const [editHistory, setEditHistory] = useState(() => {
    const history = createEmptyEditorHistory(editorPreferencesRef.current);
    if (initialEditorState)
      return {
        ...history,
        present: { ...history.present, ...initialEditorState },
      };
    try {
      return localStorage.getItem(EDITOR_HISTORY_STORAGE_KEY)
        ? readEditorHistory()
        : history;
    } catch {
      return history;
    }
  });
  const [selected, setSelected] = useState(null);
  const [editingSubtitle, setEditingSubtitle] = useState(null);
  const [pendingSubtitle, setPendingSubtitle] = useState(null);
  const [error, setError] = useState("");
  const [generatingSubtitles, setGeneratingSubtitles] = useState(false);
  const [translatingSubtitles, setTranslatingSubtitles] = useState(false);
  const [translationTarget, setTranslationTarget] = useState("es");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [videoViewMode, setVideoViewMode] = useState("auto");
  const [autoCrop, setAutoCrop] = useState(false);
  const [subtitlesOpen, setSubtitlesOpen] = useState(false);
  const [hookOpen, setHookOpen] = useState(false);
  const [subtitleView, setSubtitleView] = useState("timeline");
  const [subtitleTableLoop, setSubtitleTableLoop] = useState(false);
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectIdState] = useState(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [saveProjectDialogOpen, setSaveProjectDialogOpen] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [projectStorageWarning, setProjectStorageWarning] = useState("");
  const [projectSaveNotice, setProjectSaveNotice] = useState("");
  const [masterPersistDialogOpen, setMasterPersistDialogOpen] = useState(false);
  const [masterConfirmText, setMasterConfirmText] = useState("");
  const [masterPersisting, setMasterPersisting] = useState(false);
  const [masterPersistNotice, setMasterPersistNotice] = useState("");

  const playbackStartMs = Math.max(0, Number(initialPlaybackStartMs) || 0);
  const requestedPlaybackDurationMs =
    Number(initialPlaybackDurationMs) > 0
      ? Number(initialPlaybackDurationMs)
      : null;
  const remotionFps = Number(remotionPreviewProps?.fps || 30);

  const handleRemotionFrameChange = useCallback(
    (frame) => {
      remotionPlayheadRef.current = Math.min(
        durationMs,
        (frame / remotionFps) * 1000,
      );
      if (remotionPlayheadTimerRef.current) return;
      remotionPlayheadTimerRef.current = window.setTimeout(() => {
        remotionPlayheadTimerRef.current = null;
        setPlayheadMs(remotionPlayheadRef.current);
      }, 100);
    },
    [durationMs, remotionFps],
  );
  const handleRemotionPlayerReady = useCallback((player) => {
    remotionPlayerRef.current = player;
  }, []);

  useEffect(
    () => () => {
      if (remotionPlayheadTimerRef.current)
        window.clearTimeout(remotionPlayheadTimerRef.current);
    },
    [],
  );

  const { subtitleCues, subtitleStyle, subtitleLanguage, hook } =
    editHistory.present;
  const editHistoryRef = useRef(editHistory);
  const activeProjectIdRef = useRef(null);
  const activeProjectNameRef = useRef("");
  const appliedInitialStateKeyRef = useRef(null);
  const projectSaveTimerRef = useRef(null);
  const legacyHistoryPresentRef = useRef(
    (() => {
      try {
        return Boolean(localStorage.getItem(EDITOR_HISTORY_STORAGE_KEY));
      } catch {
        return false;
      }
    })(),
  );
  useEffect(() => {
    editHistoryRef.current = editHistory;
    if (persistHistory && !activeProjectIdRef.current)
      saveEditorHistory(editHistory);
    onStateChange?.(editHistory.present);
    const persistedProjectId = activeProjectIdRef.current || activeProjectId;
    if (!persistedProjectId || !videoFile) return undefined;
    if (projectSaveTimerRef.current)
      window.clearTimeout(projectSaveTimerRef.current);
    projectSaveTimerRef.current = window.setTimeout(async () => {
      const saved = await saveStoredProject(
        {
          id: persistedProjectId,
          name: activeProjectNameRef.current || videoFile.name,
          history: editHistoryRef.current,
          videoName: videoFile.name,
          durationMs,
        },
        null,
      );
      if (!saved)
        setProjectStorageWarning(
          "Could not save this project in browser storage. Your current edits are still available in memory.",
        );
      else {
        setProjectStorageWarning("");
        setProjects(await listStoredProjects());
      }
    }, 350);
    return () => {
      if (projectSaveTimerRef.current)
        window.clearTimeout(projectSaveTimerRef.current);
    };
  }, [
    activeProjectId,
    durationMs,
    editHistory,
    onStateChange,
    persistHistory,
    videoFile,
  ]);

  useEffect(() => {
    if (
      !initialEditorState ||
      initialStateKey === null ||
      appliedInitialStateKeyRef.current === initialStateKey
    )
      return;
    appliedInitialStateKeyRef.current = initialStateKey;
    setEditHistory((current) => ({
      ...createEmptyEditorHistory(editorPreferencesRef.current),
      present: { ...current.present, ...initialEditorState },
    }));
    setSelected(null);
  }, [initialEditorState, initialStateKey]);

  useEffect(() => {
    const persistCurrentHistory = () => {
      if (persistHistory && !activeProjectIdRef.current)
        saveEditorHistory(editHistoryRef.current);
    };
    window.addEventListener("pagehide", persistCurrentHistory);
    window.addEventListener("beforeunload", persistCurrentHistory);
    return () => {
      window.removeEventListener("pagehide", persistCurrentHistory);
      window.removeEventListener("beforeunload", persistCurrentHistory);
    };
  }, [persistHistory]);

  const refreshProjects = async () => {
    const storedProjects = await listStoredProjects();
    setProjects(storedProjects);
    return storedProjects;
  };

  useEffect(
    () => () => {
      if (projectSaveTimerRef.current)
        window.clearTimeout(projectSaveTimerRef.current);
    },
    [],
  );

  const commitEdit = (
    updater,
    { coalesce = false, transaction = null, recordAction = false } = {},
  ) =>
    setEditHistory((current) => {
      const next =
        typeof updater === "function" ? updater(current.present) : updater;
      if (next === current.present) return current;
      if (coalesce && transaction) {
        if (recordAction) {
          return {
            past: [...current.past, current.present].slice(
              -EDITOR_HISTORY_LIMIT,
            ),
            present: next,
            future: [],
          };
        }
        return { ...current, present: next, future: [] };
      }
      return {
        past: [...current.past, current.present].slice(-EDITOR_HISTORY_LIMIT),
        present: next,
        future: [],
      };
    });
  const rememberEditorSettings = (state) => {
    const next = updateEditorPreferencesFromState(
      editorPreferencesRef.current,
      state,
    );
    editorPreferencesRef.current = next;
    saveEditorPreferences(next);
  };
  const undo = () =>
    setEditHistory((current) => {
      if (!current.past.length) return current;
      const previous = current.past[current.past.length - 1];
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future].slice(
          0,
          EDITOR_HISTORY_LIMIT,
        ),
      };
    });
  const redo = () =>
    setEditHistory((current) => {
      if (!current.future.length) return current;
      const [next, ...future] = current.future;
      return {
        past: [...current.past, current.present].slice(-EDITOR_HISTORY_LIMIT),
        present: next,
        future,
      };
    });

  useEffect(
    () => () => {
      if (objectUrlRef.current && typeof URL.revokeObjectURL === "function")
        URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  useEffect(() => {
    const handleFullscreenChange = () =>
      setIsFullscreen(document.fullscreenElement === playerRef.current);
    document.addEventListener?.("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener?.(
        "fullscreenchange",
        handleFullscreenChange,
      );
  }, []);

  useEffect(() => {
    const handleHistoryKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        redo();
      }
    };
    document.addEventListener("keydown", handleHistoryKeyDown);
    return () => document.removeEventListener("keydown", handleHistoryKeyDown);
  });

  const selectedCue = useMemo(() => {
    if (!selected) return null;
    if (selected.type === "hook") return hook;
    return subtitleCues.find((cue) => cue.id === selected.id) || null;
  }, [hook, selected, subtitleCues]);

  const loadVideo = useCallback(
    (
      file,
      {
        persist = true,
        projectId = null,
        restoredDurationMs = null,
        previewFile = file,
        previewUrl = "",
      } = {},
    ) => {
      if (!file?.type?.startsWith("video/")) {
        setError("Please choose a playable video file.");
        return;
      }
      videoLoadStartedRef.current = true;
      if (persist && !projectId) {
        activeProjectIdRef.current = null;
        activeProjectNameRef.current = "";
        setActiveProjectIdState(null);
        void setActiveProjectId(null);
      }
      const nextUrl = URL.createObjectURL(file);
      if (objectUrlRef.current && typeof URL.revokeObjectURL === "function")
        URL.revokeObjectURL(objectUrlRef.current);
      if (
        previewObjectUrlRef.current &&
        previewObjectUrlRef.current !== objectUrlRef.current &&
        typeof URL.revokeObjectURL === "function"
      )
        URL.revokeObjectURL(previewObjectUrlRef.current);
      objectUrlRef.current = nextUrl;
      const nextPreviewUrl =
        previewUrl ||
        (previewFile === file ? nextUrl : URL.createObjectURL(previewFile));
      previewObjectUrlRef.current = previewUrl ? "" : nextPreviewUrl;
      setVideoFile(file);
      setVideoUrl(nextUrl);
      setPreviewVideoUrl(nextPreviewUrl);
      setError("");
      setDurationMs(
        requestedPlaybackDurationMs ||
          restoredDurationMs ||
          DEFAULT_DURATION_MS,
      );
      setPlayheadMs(0);
      setIsPlaying(false);
      setIsLooping(false);
      setIsMuted(false);
      setVideoViewMode("auto");
      setAutoCrop(false);
      if (videoRef.current) videoRef.current.loop = false;
      if (videoRef.current) videoRef.current.muted = false;
    },
    [requestedPlaybackDurationMs],
  );

  useEffect(() => {
    let active = true;
    const initializeProjects = async () => {
      await migrateLegacyProject({
        hasLegacyHistory: legacyHistoryPresentRef.current,
      });
      const storedProjects = await listStoredProjects();
      const storedActiveId = await getActiveProjectId();
      if (!active) return;
      setProjects(storedProjects);
      if (initialVideoUrl || !storedActiveId || videoLoadStartedRef.current)
        return;
      const stored = await loadStoredProject(storedActiveId);
      if (!active) return;
      if (!stored?.file) {
        await setActiveProjectId(null);
        return;
      }
      activeProjectIdRef.current = stored.project.id;
      activeProjectNameRef.current = stored.project.name;
      setActiveProjectIdState(stored.project.id);
      setEditHistory(stored.project.history);
      loadVideo(stored.file, {
        persist: false,
        projectId: stored.project.id,
        restoredDurationMs: stored.project.durationMs,
      });
    };
    void initializeProjects();
    return () => {
      active = false;
    };
  }, [initialVideoUrl, loadVideo]);

  useEffect(() => {
    if (!initialVideoUrl) return undefined;
    videoLoadStartedRef.current = true;
    const streamUrl = initialExportVideoUrl || initialVideoUrl;
    setVideoFile(null);
    setVideoUrl(streamUrl);
    setPreviewVideoUrl(streamUrl);
    setDurationMs(requestedPlaybackDurationMs || DEFAULT_DURATION_MS);
    setPlayheadMs(0);
    setIsPlaying(false);
    setError("");
    const videoElement = videoRef.current;
    return () => {
      if (videoElement) videoElement.pause();
    };
  }, [initialExportVideoUrl, initialVideoUrl, requestedPlaybackDurationMs]);

  const handleVideoError = () => {
    if (!videoFile) setError("Could not stream the project video from MinIO.");
  };

  const handleMetadata = () => {
    const sourceDurationMs = Math.max(
      1,
      Math.round((videoRef.current?.duration || 30) * 1000),
    );
    const availableClipDurationMs = Math.max(
      1,
      sourceDurationMs - playbackStartMs,
    );
    const nextDuration = requestedPlaybackDurationMs
      ? Math.min(requestedPlaybackDurationMs, availableClipDurationMs)
      : sourceDurationMs;
    if (videoRef.current && playbackStartMs > 0) {
      videoRef.current.currentTime = playbackStartMs / 1000;
    }
    setDurationMs(nextDuration);
    setEditHistory((current) => ({
      ...current,
      present: {
        ...current.present,
        subtitleCues: current.present.subtitleCues.map((cue) =>
          clampCue(cue, nextDuration),
        ),
        hook: current.present.hook
          ? clampCue(current.present.hook, nextDuration)
          : current.present.hook,
      },
    }));
  };

  const detectVideoFraming = () => {
    const video = videoRef.current;
    if (!video) return;
    const detect = () => {
      try {
        setAutoCrop(detectEmbeddedSideBars(video));
      } catch {
        setAutoCrop(false);
      }
    };
    if (typeof video.requestVideoFrameCallback === "function")
      video.requestVideoFrameCallback(detect);
    else window.setTimeout(detect, 0);
  };

  const cycleVideoViewMode = () =>
    setVideoViewMode((current) =>
      current === "auto" ? "fill" : current === "fill" ? "fit" : "auto",
    );

  const updateSubtitle = (cue, options) =>
    commitEdit(
      (current) => ({
        ...current,
        subtitleCues: current.subtitleCues.map((item) =>
          item.id === cue.id
            ? syncSubtitleCue(item, clampCue(cue, durationMs))
            : item,
        ),
      }),
      options,
    );
  const updateHook = (nextHook, options) => {
    const normalizedHook = clampCue(nextHook, durationMs);
    rememberEditorSettings({
      ...editHistoryRef.current.present,
      hook: normalizedHook,
    });
    return commitEdit(
      (current) => ({ ...current, hook: normalizedHook }),
      options,
    );
  };
  const updateSubtitleStyle = (nextStyle) => {
    rememberEditorSettings({
      ...editHistoryRef.current.present,
      subtitleStyle: nextStyle,
    });
    commitEdit((current) => ({ ...current, subtitleStyle: nextStyle }));
  };
  const updateSubtitleLanguage = (nextLanguage) => {
    rememberEditorSettings({
      ...editHistoryRef.current.present,
      subtitleLanguage: nextLanguage,
    });
    commitEdit((current) => ({ ...current, subtitleLanguage: nextLanguage }));
  };

  const handleTimelineSelect = (cue, type, { openEditor = true } = {}) => {
    setSelected({ id: cue.id, type });
    if (type === "subtitle" && openEditor) setEditingSubtitle(cue);
  };
  const beginTimelineEdit = () => {
    timelineDragRef.current = { recorded: false };
  };
  const endTimelineEdit = () => {
    timelineDragRef.current = null;
  };
  const handleTimelineChange = (cue, type) => {
    const transaction = timelineDragRef.current;
    const recordAction = Boolean(transaction && !transaction.recorded);
    if (transaction) transaction.recorded = true;
    const options = transaction
      ? { coalesce: true, transaction, recordAction }
      : {};
    return type === "hook"
      ? updateHook(cue, options)
      : updateSubtitle(cue, options);
  };

  const importSubtitleFile = async (file) => {
    if (!file) return;
    try {
      if (
        subtitleCues.length &&
        !window.confirm("Replace the current subtitle track?")
      )
        return;
      const cues = parseSubtitleFile(file.name, await file.text());
      const importedCues = cues.map((cue) => clampCue(cue, durationMs));
      commitEdit((current) => ({
        ...current,
        subtitleCues: importedCues,
        subtitleLanguage: "en",
      }));
      setPendingSubtitle(null);
      if (subtitleInputRef.current) subtitleInputRef.current.value = "";
      setSelected(null);
      setError("");
    } catch (importError) {
      setError(importError.message || "Could not import subtitles.");
    }
  };

  const generateSubtitles = async () => {
    if (
      subtitleCues.length &&
      !window.confirm("Replace the current subtitle track?")
    )
      return;
    setGeneratingSubtitles(true);
    setError("");
    try {
      let response;
      if (videoFile) {
        const formData = new FormData();
        formData.append("file", videoFile, videoFile.name);
        response = await fetch(getApiUrl("/api/local-editor/transcribe"), {
          method: "POST",
          body: formData,
        });
      } else if (hasProjectClipSource) {
        response = await fetch(
          getApiUrl(
            `/api/projects/${encodeURIComponent(initialProjectId)}/clips/${projectClipIndex}/transcribe`,
          ),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...getLocalAiHeaders(),
            },
            body: JSON.stringify({}),
          },
        );
      } else {
        throw new Error("Choose a video before generating subtitles.");
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(payload.detail || "Could not generate subtitles.");
      const generatedCues = normalizeGeneratedCues(
        payload.captions?.length ? payload.captions : payload.segments,
        durationMs,
      );
      if (!generatedCues.length)
        throw new Error("No speech was detected in this video.");
      commitEdit((current) => ({
        ...current,
        subtitleCues: generatedCues,
        subtitleLanguage: String(payload.language || "en").toLowerCase(),
      }));
      setSelected(null);
      setSubtitlesOpen(true);
    } catch (generationError) {
      setError(generationError.message || "Could not generate subtitles.");
    } finally {
      setGeneratingSubtitles(false);
    }
  };

  const handleImport = () => {
    if (pendingSubtitle) {
      importSubtitleFile(pendingSubtitle);
      return;
    }
    subtitleInputRef.current?.click();
  };

  const translateSubtitles = async () => {
    if (!subtitleCues.length || translatingSubtitles) return;
    const sourceLanguage = String(subtitleLanguage || "en").toLowerCase();
    const targetLanguage = String(translationTarget || "").toLowerCase();
    if (!targetLanguage || targetLanguage === sourceLanguage) {
      setError("Choose a target language different from the source language.");
      return;
    }
    setTranslatingSubtitles(true);
    setError("");
    try {
      const sourceCues = subtitleCues.map(({ id, text, startMs, endMs }) => ({
        id,
        text,
        startMs,
        endMs,
      }));
      const response = await fetch(getApiUrl("/api/local-editor/translate"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getLocalAiHeaders() },
        body: JSON.stringify({
          target_language: targetLanguage,
          source_track_id: "original",
          tracks: [
            { id: "original", language: sourceLanguage, cues: sourceCues },
          ],
        }),
      });
      let statusPayload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(statusPayload.detail || "Subtitle translation failed.");
      const translationId = statusPayload.translationId;
      if (!translationId)
        throw new Error("Translation service did not return a job id.");
      while (!["done", "error", "failed"].includes(statusPayload.status)) {
        await sleep(500);
        const statusResponse = await fetch(
          getApiUrl(`/api/translation/${translationId}`),
        );
        statusPayload = await statusResponse.json().catch(() => ({}));
        if (!statusResponse.ok)
          throw new Error(
            statusPayload.detail || "Unable to read translation status.",
          );
      }
      if (statusPayload.status !== "done")
        throw new Error(statusPayload.error || "Subtitle translation failed.");
      const translatedCues = statusPayload.track?.cues;
      if (
        !Array.isArray(translatedCues) ||
        translatedCues.length !== sourceCues.length
      )
        throw new Error("Translation returned an invalid subtitle track.");
      commitEdit((current) => ({
        ...current,
        subtitleLanguage: targetLanguage,
        subtitleCues: sourceCues.map((cue, index) => ({
          ...(current.subtitleCues.find((item) => item.id === cue.id) || cue),
          text: String(translatedCues[index]?.text || "").trim(),
          label: String(translatedCues[index]?.text || "").trim(),
          captions: Array.isArray(translatedCues[index]?.captions)
            ? translatedCues[index].captions.map((caption) => ({
                text: String(caption?.text || "").trim(),
                startMs: Number(caption?.startMs),
                endMs: Number(caption?.endMs),
              }))
            : undefined,
        })),
      }));
      setSelected(null);
      setSubtitlesOpen(true);
    } catch (translationError) {
      setError(translationError.message || "Subtitle translation failed.");
    } finally {
      setTranslatingSubtitles(false);
    }
  };

  const addHook = () => {
    if (hook && !window.confirm("Replace the current viral hook?")) return;
    const { durationMs: hookDurationMs, ...hookDefaults } =
      editorPreferencesRef.current.hookDefaults;
    const nextHook = {
      id: "hook",
      text: "Your viral hook",
      startMs: 0,
      endMs: Math.min(hookDurationMs, durationMs),
      ...hookDefaults,
    };
    rememberEditorSettings({
      ...editHistoryRef.current.present,
      hook: nextHook,
    });
    commitEdit((current) => ({ ...current, hook: nextHook }));
    setSelected({ id: "hook", type: "hook" });
    setHookOpen(true);
  };

  const removeHook = () => {
    if (!hook || !window.confirm("Remove viral hook?")) return;
    commitEdit((current) => ({ ...current, hook: null }));
    setSelected((current) => (current?.type === "hook" ? null : current));
  };

  const removeSubtitles = () => {
    if (!window.confirm("Remove all subtitles?")) return;
    commitEdit((current) => ({
      ...current,
      subtitleCues: [],
      subtitleStyle: DEFAULT_SUBTITLE_STYLE,
      subtitleLanguage: "en",
    }));
    setSelected((current) => (current?.type === "subtitle" ? null : current));
    setEditingSubtitle(null);
  };

  const cleanSubtitleDots = () => {
    if (!subtitleCues.length) return;
    commitEdit((current) => ({
      ...current,
      subtitleCues: current.subtitleCues.map(cleanSubtitleCue),
    }));
    setMasterPersistNotice("");
  };

  const openMasterPersistDialog = () => {
    setMasterConfirmText("");
    setMasterPersistNotice("");
    setMasterPersistDialogOpen(true);
  };

  const persistSubtitlesOnMaster = async () => {
    if (
      masterConfirmText !== "confirm" ||
      masterPersisting ||
      !hasProjectClipSource
    )
      return;
    setMasterPersisting(true);
    setError("");
    try {
      const response = await fetch(
        getApiUrl(
          `/api/clip/${encodeURIComponent(initialProjectId)}/${projectClipIndex}/persist-subtitles`,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trackId: "original",
            language: subtitleLanguage || "und",
            style: subtitleStyle,
            cues: subtitleCues,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(payload.detail || "Could not persist subtitles.");
      setMasterPersistDialogOpen(false);
      setMasterConfirmText("");
      setMasterPersistNotice("Subtitles persisted on master.");
    } catch (persistError) {
      setError(persistError.message || "Could not persist subtitles.");
    } finally {
      setMasterPersisting(false);
    }
  };

  const addSubtitleCue = () => {
    const nextCue = clampCue(
      createSubtitleCue({
        playheadMs,
        durationMs,
        existingIds: subtitleCues.map((cue) => cue.id),
      }),
      durationMs,
    );
    commitEdit((current) => ({
      ...current,
      subtitleCues: [...current.subtitleCues, nextCue],
    }));
    setSelected({ id: nextCue.id, type: "subtitle" });
    setEditingSubtitle(nextCue);
    setSubtitlesOpen(true);
  };

  const removeSubtitleCue = (id) => {
    if (!window.confirm("Remove this subtitle cue?")) return;
    commitEdit((current) => ({
      ...current,
      subtitleCues: current.subtitleCues.filter((cue) => cue.id !== id),
    }));
    setSelected((current) =>
      current?.id === id && current.type === "subtitle" ? null : current,
    );
    setEditingSubtitle((current) => (current?.id === id ? null : current));
  };

  const handleSeek = (nextMs) => {
    const clampedMs = clamp(nextMs, 0, durationMs);
    setPlayheadMs(clampedMs);
    if (remotionPlayerRef.current) {
      remotionPlayerRef.current.seekTo?.(
        Math.round((clampedMs / 1000) * remotionFps),
      );
      return;
    }
    if (videoRef.current)
      videoRef.current.currentTime =
        clipTimeToSourceTime(clampedMs, playbackStartMs, durationMs) / 1000;
  };

  const handleVideoTimeUpdate = (event) => {
    const sourceMs = event.currentTarget.currentTime * 1000;
    if (sourceMs < playbackStartMs) {
      event.currentTarget.currentTime = playbackStartMs / 1000;
      setPlayheadMs(0);
      return;
    }
    const nextMs = sourceTimeToClipTime(sourceMs, playbackStartMs, durationMs);
    if (sourceMs >= playbackStartMs + durationMs) {
      if (isLooping) {
        event.currentTarget.currentTime = playbackStartMs / 1000;
        setPlayheadMs(0);
        return;
      }
      event.currentTarget.pause();
      event.currentTarget.currentTime =
        clipTimeToSourceTime(durationMs, playbackStartMs, durationMs) / 1000;
      setPlayheadMs(durationMs);
      setIsPlaying(false);
      return;
    }
    const loopCue = subtitleTableLoop
      ? selected?.type === "subtitle"
        ? subtitleCues.find((cue) => cue.id === selected.id)
        : activeCueAt(subtitleCues, playheadMs)
      : null;
    if (loopCue && nextMs >= loopCue.endMs) {
      event.currentTarget.currentTime =
        clipTimeToSourceTime(loopCue.startMs, playbackStartMs, durationMs) /
        1000;
      setPlayheadMs(loopCue.startMs);
      return;
    }
    setPlayheadMs(nextMs);
  };

  const seekBy = (deltaMs) => {
    handleSeek(playheadMs + deltaMs);
  };

  const togglePlayback = async (event) => {
    const remotionPlayer = remotionPlayerRef.current;
    if (remotionPlayer) {
      if (isPlaying) {
        remotionPlayer.pause?.();
        setIsPlaying(false);
      } else {
        try {
          await remotionPlayer.play?.(event);
          setIsPlaying(true);
        } catch (playError) {
          setError(playError.message || "Could not play project video.");
        }
      }
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      try {
        await video.play();
        setIsPlaying(true);
      } catch (playError) {
        setError(playError.message || "Could not play local video.");
      }
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const stopVideo = () => {
    if (remotionPlayerRef.current) {
      remotionPlayerRef.current.pause?.();
      remotionPlayerRef.current.seekTo?.(0);
      setPlayheadMs(0);
      setIsPlaying(false);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = playbackStartMs / 1000;
    setPlayheadMs(0);
    setIsPlaying(false);
  };

  const toggleLoop = () => {
    const nextLooping = !isLooping;
    setIsLooping(nextLooping);
    if (videoRef.current) videoRef.current.loop = nextLooping;
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (remotionPlayerRef.current) {
      if (nextMuted) remotionPlayerRef.current.mute?.();
      else remotionPlayerRef.current.unmute?.();
    } else if (videoRef.current) videoRef.current.muted = nextMuted;
  };

  const handlePlayerKeyDown = (event) => {
    if (
      ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(event.target.tagName)
    )
      return;
    const key = event.key.toLowerCase();
    if (event.key === " " || key === "k") {
      event.preventDefault();
      togglePlayback(event);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      seekBy(-5000);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      seekBy(5000);
    } else if (event.key === "Home") {
      event.preventDefault();
      handleSeek(0);
    } else if (event.key === "End") {
      event.preventDefault();
      handleSeek(durationMs);
    } else if (key === "m") {
      event.preventDefault();
      toggleMute();
    } else if (key === "f") {
      event.preventDefault();
      toggleFullscreen();
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen?.();
      } else if (playerRef.current?.requestFullscreen) {
        await playerRef.current.requestFullscreen();
      } else {
        setError("Fullscreen is not supported by this browser.");
      }
    } catch (fullscreenError) {
      setError(fullscreenError.message || "Could not open fullscreen mode.");
    }
  };

  const exportSubtitles = () =>
    downloadBlob(
      new Blob([serializeSrt(subtitleCues)], { type: "application/x-subrip" }),
      "openshorts-subtitles.srt",
    );

  const exportVideo = async () => {
    setBusy(true);
    setProgress(0);
    setError("");
    try {
      const video = videoRef.current;
      if (!video?.videoWidth || !video?.videoHeight)
        throw new Error("Video metadata is not ready for export.");
      const cropForExport =
        videoViewMode === "fill" || (videoViewMode === "auto" && autoCrop);
      const outputDimensions = getFilledFrameDimensions(
        video.videoWidth,
        video.videoHeight,
      );
      const renderParams = {
        durationSeconds: durationMs / 1000,
        fps: 30,
        ...outputDimensions,
        videoFit: cropForExport ? "cover" : "contain",
        subtitleCues,
        subtitleStyle,
        hook,
        onProgress: setProgress,
      };
      let outputUrl;
      if (subtitleCues.length) {
        outputUrl = await burnLocalEditorSubtitles({
          file: videoFile,
          ...renderParams,
        });
      } else {
        outputUrl = await renderLocalVideoOnBackend({
          file: videoFile,
          ...renderParams,
        });
      }
      downloadUrl(outputUrl, "openshorts-local-editor.mp4");
    } catch (exportError) {
      setError(exportError.message || "Could not export this video locally.");
    } finally {
      setBusy(false);
    }
  };

  const startNewProject = () => {
    videoRestoreGenerationRef.current += 1;
    videoLoadStartedRef.current = true;
    activeProjectIdRef.current = null;
    activeProjectNameRef.current = "";
    setActiveProjectIdState(null);
    void setActiveProjectId(null);
    videoRef.current?.pause();
    if (videoRef.current) videoRef.current.loop = false;
    if (objectUrlRef.current && typeof URL.revokeObjectURL === "function")
      URL.revokeObjectURL(objectUrlRef.current);
    if (
      previewObjectUrlRef.current &&
      previewObjectUrlRef.current !== objectUrlRef.current &&
      typeof URL.revokeObjectURL === "function"
    )
      URL.revokeObjectURL(previewObjectUrlRef.current);
    objectUrlRef.current = "";
    previewObjectUrlRef.current = "";
    setVideoFile(null);
    setVideoUrl("");
    setPreviewVideoUrl("");
    setEditHistory(createEmptyEditorHistory(editorPreferencesRef.current));
    setSelected(null);
    setPendingSubtitle(null);
    setPlayheadMs(0);
    setProgress(0);
    setIsPlaying(false);
    setIsLooping(false);
    setError("");
  };

  const openSaveProjectDialog = () => {
    if (!videoFile) return;
    setProjectNameDraft(activeProjectNameRef.current || videoFile.name);
    setProjectStorageWarning("");
    setProjectSaveNotice("");
    setSaveProjectDialogOpen(true);
  };

  const saveProject = async () => {
    if (!videoFile) return;
    const name = projectNameDraft.trim();
    if (!name) return;
    try {
      const saved = activeProjectId
        ? await saveStoredProject(
            {
              id: activeProjectId,
              name,
              history: editHistoryRef.current,
              videoName: videoFile.name,
              durationMs,
            },
            videoFile,
          )
        : await createStoredProject({
            name,
            history: editHistoryRef.current,
            file: videoFile,
            durationMs,
          });
      if (!saved) {
        setProjectStorageWarning(
          "Could not save this project in browser storage. Your current edits are still available in memory.",
        );
        return;
      }
      activeProjectIdRef.current = saved.id;
      activeProjectNameRef.current = saved.name;
      setActiveProjectIdState(saved.id);
      await setActiveProjectId(saved.id);
      setProjectStorageWarning("");
      setProjectSaveNotice(`Saved “${saved.name}”`);
      setSaveProjectDialogOpen(false);
      await refreshProjects();
    } catch {
      setProjectStorageWarning(
        "Could not save this project in browser storage. Your current edits are still available in memory.",
      );
    }
  };

  const openProject = async (projectId) => {
    const stored = await loadStoredProject(projectId);
    if (!stored?.file) {
      setProjectStorageWarning(
        "This project video is unavailable in browser storage.",
      );
      return;
    }
    activeProjectIdRef.current = stored.project.id;
    activeProjectNameRef.current = stored.project.name;
    setActiveProjectIdState(stored.project.id);
    await setActiveProjectId(stored.project.id);
    setEditHistory(stored.project.history);
    setSelected(null);
    loadVideo(stored.file, {
      persist: false,
      projectId: stored.project.id,
      restoredDurationMs: stored.project.durationMs,
    });
    setProjectsOpen(false);
    setProjectStorageWarning("");
  };

  const renameProject = async (project) => {
    const name = window.prompt("Project name", project.name)?.trim() || "";
    if (!name) return;
    const renamed = await renameStoredProject(project.id, name);
    if (!renamed) {
      setProjectStorageWarning(
        "Could not rename this project in browser storage.",
      );
      return;
    }
    if (project.id === activeProjectIdRef.current)
      activeProjectNameRef.current = renamed.name;
    await refreshProjects();
  };

  const deleteProject = async (projectId) => {
    const project = projects.find((item) => item.id === projectId);
    if (!project || !window.confirm(`Delete ${project.name}?`)) return;
    const deleted = await deleteStoredProject(projectId);
    if (!deleted) {
      setProjectStorageWarning(
        "Could not delete this project from browser storage.",
      );
      return;
    }
    if (projectId === activeProjectIdRef.current) startNewProject();
    await refreshProjects();
  };

  const openProjects = async () => {
    await refreshProjects();
    setProjectsOpen(true);
  };

  const reset = startNewProject;
  const projectsDialog = (
    <LocalEditorProjects
      open={projectsOpen}
      projects={projects}
      activeProjectId={activeProjectId}
      onClose={() => setProjectsOpen(false)}
      onOpen={openProject}
      onRename={renameProject}
      onDelete={deleteProject}
      onNewProject={() => {
        startNewProject();
        setProjectsOpen(false);
      }}
    />
  );

  if (!videoFile && !videoUrl) {
    return (
      <div className="h-full overflow-y-auto bg-[#0d0d0f] text-white">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <h1 className="text-lg font-bold">Local Editor</h1>
            <p className="mt-0.5 text-xs text-zinc-500">
              Edit local videos, subtitles, and viral hooks in your browser.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openProjects}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:bg-white/5"
            >
              <FolderOpen size={13} />
              Projects
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close editor"
                className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>
        {projectStorageWarning && (
          <div className="mx-4 mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
            {projectStorageWarning}
          </div>
        )}
        {!allowLocalUpload ? (
          <div className="flex h-64 items-center justify-center gap-2 text-sm text-zinc-400">
            {error || "Project video is unavailable."}
          </div>
        ) : (
          <UploadState onFile={loadVideo} error={error} />
        )}
        {projectsDialog}
      </div>
    );
  }

  const activeSubtitle = activeCueAt(subtitleCues, playheadMs);
  const activeSubtitleWords = activeSubtitle
    ? cueCaptionsForRender(activeSubtitle)
    : [];
  const activeSubtitleWordIndex = activeSubtitleWords.findIndex(
    (word) => playheadMs >= word.startMs && playheadMs < word.endMs,
  );
  const activeHook =
    hook && playheadMs >= hook.startMs && playheadMs < hook.endMs ? hook : null;
  const previewSubtitleStyle = normalizeSubtitleStyle(subtitleStyle);
  const previewSubtitles = subtitleCues.length
    ? {
        captions: subtitleCues.flatMap((cue) => cueCaptionsForRender(cue)),
        blocks: subtitleCues.map((cue) => ({
          words: cueCaptionsForRender(cue),
          startMs: Number(cue.startMs),
          endMs: Number(cue.endMs),
          text: String(cue.text || ""),
        })),
        position: previewSubtitleStyle.position || "bottom",
        style: toClipGeneratorSubtitleStyle(previewSubtitleStyle),
      }
    : null;
  const hookElapsedMs = activeHook
    ? Math.max(0, playheadMs - activeHook.startMs)
    : 0;
  const hookEntranceStyle = activeHook
    ? getHookAnimationStyle(activeHook.entranceAnimation, hookElapsedMs)
    : {};
  const shouldCropVideo =
    videoViewMode === "fill" || (videoViewMode === "auto" && autoCrop);
  const videoViewLabel =
    videoViewMode === "auto"
      ? autoCrop
        ? "Auto crop"
        : "Auto fit"
      : videoViewMode === "fill"
        ? "Fill"
        : "Fit";

  return (
    <div className="h-full overflow-y-auto bg-[#0d0d0f] text-white">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-5">
        <div>
          <h1 className="text-lg font-bold">Local Editor</h1>
          <p className="mt-0.5 text-xs text-zinc-500">
            {videoFile?.name || initialVideoName || "Project video"} ·{" "}
            {videoFile ? "local-only editing" : "streamed project video"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {headerActions}
          {videoFile && (
            <button
              type="button"
              onClick={openSaveProjectDialog}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save size={13} />
              Save Project
            </button>
          )}
          <button
            type="button"
            onClick={openProjects}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:bg-white/5"
          >
            <FolderOpen size={13} />
            Projects
          </button>
          {editHistory.past.length > 0 && (
            <button
              type="button"
              onClick={undo}
              disabled={busy}
              aria-label="Undo"
              title="Undo (Ctrl/Cmd+Z)"
              className="flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Undo2 size={13} />
              Undo
            </button>
          )}
          {editHistory.future.length > 0 && (
            <button
              type="button"
              onClick={redo}
              disabled={busy}
              aria-label="Redo"
              title="Redo (Ctrl/Cmd+Shift+Z)"
              className="flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Redo2 size={13} />
              Redo
            </button>
          )}
          {videoFile && (
            <button
              type="button"
              onClick={exportVideo}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-fuchsia-500 px-2.5 py-1.5 text-[11px] font-semibold hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Film size={13} />
              {busy
                ? `Exporting ${Math.round(progress * 100)}%`
                : "Export Video"}
            </button>
          )}
          {subtitleCues.length > 0 && (
            <button
              type="button"
              onClick={exportSubtitles}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-violet-500 px-2.5 py-1.5 text-[11px] font-semibold hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={13} />
              Export Subtitles
            </button>
          )}
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            aria-label="Reset"
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:bg-white/5 disabled:opacity-50"
          >
            <RotateCcw size={13} />
            Reset
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close editor"
              title="Close editor"
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:bg-white/5"
            >
              <X size={13} />
              Close
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="mx-6 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}
      {projectStorageWarning && (
        <div className="mx-6 mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          {projectStorageWarning}
        </div>
      )}
      {projectSaveNotice && (
        <div
          className="mx-6 mt-4 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100"
          role="status"
        >
          {projectSaveNotice}
        </div>
      )}
      {masterPersistNotice && (
        <div
          className="mx-6 mt-4 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100"
          role="status"
        >
          {masterPersistNotice}
        </div>
      )}
      {saveProjectDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-project-dialog-title"
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#17171b] p-5 text-white shadow-2xl"
          >
            <h2
              id="save-project-dialog-title"
              className="text-base font-semibold"
            >
              Save project
            </h2>
            <p className="mt-1 text-xs text-zinc-400">
              Choose a name for this browser-local project.
            </p>
            <label
              htmlFor="local-editor-project-name"
              className="mt-4 block text-xs font-medium text-zinc-300"
            >
              Project name
            </label>
            <input
              id="local-editor-project-name"
              value={projectNameDraft}
              onChange={(event) => setProjectNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveProject();
              }}
              autoFocus
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSaveProjectDialogOpen(false)}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveProject()}
                disabled={!projectNameDraft.trim()}
                className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save project
              </button>
            </div>
          </div>
        </div>
      )}
      {masterPersistDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="persist-subtitles-dialog-title"
            className="w-full max-w-md rounded-2xl border border-red-400/20 bg-[#17171b] p-5 text-white shadow-2xl"
          >
            <h2
              id="persist-subtitles-dialog-title"
              className="text-base font-semibold"
            >
              Persist subtitles on master
            </h2>
            <p className="mt-2 text-xs leading-5 text-zinc-400">
              This permanently replaces the master subtitle track with the
              current editor cues. Type <strong>confirm</strong> to continue.
            </p>
            <label
              htmlFor="persist-subtitles-confirmation"
              className="mt-4 block text-xs font-medium text-zinc-300"
            >
              Confirmation
            </label>
            <input
              id="persist-subtitles-confirmation"
              aria-label="Type confirm to continue"
              value={masterConfirmText}
              onChange={(event) => setMasterConfirmText(event.target.value)}
              autoFocus
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-red-400"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setMasterPersistDialogOpen(false);
                  setMasterConfirmText("");
                }}
                disabled={masterPersisting}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-white/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void persistSubtitlesOnMaster()}
                disabled={masterConfirmText !== "confirm" || masterPersisting}
                className="rounded-lg bg-red-500 px-3 py-2 text-xs font-semibold text-white hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {masterPersisting ? "Persisting…" : "Confirm persistence"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="grid gap-5 p-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0 space-y-5">
          <div
            className={
              clipMetadata
                ? "grid items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:justify-start"
                : ""
            }
          >
            <ClipMetadataPanel
              clip={clipMetadata}
              subtitleCues={subtitleCues}
              hashtags={clipMetadata?.hashtags}
              onHashtagsChange={onHashtagsChange}
            />
            <div
              ref={playerRef}
              data-testid="local-editor-player"
              tabIndex={0}
              role="region"
              aria-label="Video preview. Use Space or K to play or pause, arrow keys to seek, M to mute, and F for fullscreen."
              aria-keyshortcuts="Space K ArrowLeft ArrowRight Home End M F"
              onKeyDown={handlePlayerKeyDown}
              className={
                isFullscreen
                  ? "fixed inset-0 z-50 flex items-center justify-center bg-black p-4"
                  : "mx-auto flex h-[calc(100vh-180px)] max-h-[72vh] w-full max-w-[360px] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl"
              }
            >
              <div className="relative h-full max-h-full w-auto max-w-full aspect-[9/16]">
                {remotionPreviewProps ? (
                  <RemotionPreview
                    {...remotionPreviewProps}
                    subtitles={previewSubtitles}
                    subtitleTracks={[]}
                    activeSubtitleTrackId={null}
                    hook={hook}
                    currentFrame={Math.round((playheadMs / 1000) * remotionFps)}
                    playing={isPlaying}
                    loop={isLooping}
                    controls={false}
                    className="h-full w-full"
                    onFrameChange={handleRemotionFrameChange}
                    onPlayingChange={setIsPlaying}
                    onPlayerReady={handleRemotionPlayerReady}
                  />
                ) : (
                  <>
                    <video
                      ref={videoRef}
                      data-testid="local-editor-native-video"
                      src={previewVideoUrl || videoUrl}
                      controls={false}
                      className={`h-full w-full ${shouldCropVideo ? "object-cover" : "object-contain"}`}
                      onLoadedMetadata={handleMetadata}
                      onLoadedData={detectVideoFraming}
                      onError={handleVideoError}
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      onEnded={() => {
                        setPlayheadMs(durationMs);
                        setIsPlaying(false);
                      }}
                      onTimeUpdate={handleVideoTimeUpdate}
                    />
                    <div className="pointer-events-none absolute inset-0">
                      {activeHook && (
                        <div
                          className="absolute w-[88%]"
                          style={{
                            left: "50%",
                            ...getHookPositionStyle(activeHook.position),
                          }}
                        >
                          <div
                            className="text-center"
                            style={{
                              ...getHookBoxStyle(activeHook),
                              ...hookEntranceStyle,
                            }}
                          >
                            {activeHook.text}
                          </div>
                        </div>
                      )}
                      {activeSubtitle && (
                        <div
                          className={`absolute left-1/2 flex w-[88%] -translate-x-1/2 flex-wrap justify-center gap-x-2 gap-y-1 rounded-lg px-3 py-2 text-center font-semibold shadow-lg ${subtitlePositionClass(previewSubtitleStyle.position)}`}
                          style={{
                            fontFamily: previewSubtitleStyle.fontFamily,
                            fontSize: `${Math.max(12, previewSubtitleStyle.fontSize * (20 / 24))}px`,
                            textShadow: outlineTextShadow(
                              previewSubtitleStyle.borderWidth,
                              previewSubtitleStyle.borderColor,
                            ),
                            backgroundColor:
                              previewSubtitleStyle.bgOpacity > 0
                                ? hexToRgba(
                                    previewSubtitleStyle.bgColor,
                                    previewSubtitleStyle.bgOpacity,
                                  )
                                : "transparent",
                          }}
                        >
                          {activeSubtitleWords.map((word, index) => {
                            const isActive = index === activeSubtitleWordIndex;
                            const isKaraoke =
                              previewSubtitleStyle.animation === "karaoke" &&
                              isActive;
                            return (
                              <span
                                key={`${word.startMs}-${index}`}
                                style={{
                                  color: isKaraoke
                                    ? previewSubtitleStyle.bgColor
                                    : isActive
                                      ? previewSubtitleStyle.highlightColor
                                      : previewSubtitleStyle.fontColor,
                                  display: "inline-block",
                                  transform:
                                    isActive &&
                                    previewSubtitleStyle.animation === "pop"
                                      ? "scale(1.1)"
                                      : "none",
                                  textShadow:
                                    previewSubtitleStyle.animation ===
                                      "word-highlight" && isActive
                                      ? `0 0 12px ${previewSubtitleStyle.highlightColor}, 0 0 24px ${previewSubtitleStyle.highlightColor}40`
                                      : "inherit",
                                  backgroundColor: isKaraoke
                                    ? previewSubtitleStyle.highlightColor
                                    : "transparent",
                                  borderRadius: isKaraoke ? 4 : 0,
                                  padding: isKaraoke ? "2px 6px" : 0,
                                }}
                              >
                                {word.text}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )}
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  aria-label={
                    isFullscreen ? "Exit fullscreen" : "Enter fullscreen"
                  }
                  title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                  className="absolute right-3 top-3 z-20 rounded-lg border border-white/20 bg-black/60 p-2 text-white shadow-lg backdrop-blur hover:bg-black/80"
                >
                  {isFullscreen ? (
                    <Minimize2 size={16} />
                  ) : (
                    <Maximize2 size={16} />
                  )}
                </button>
                <div
                  data-testid="local-editor-video-controls"
                  className="absolute bottom-0 left-0 right-0 z-30 flex items-center justify-center gap-1 border-t border-white/10 bg-[#202126]/95 px-2 py-1.5 text-zinc-300 shadow-lg backdrop-blur"
                >
                  <button
                    type="button"
                    aria-label="Go to beginning"
                    title="Go to beginning"
                    onClick={() => handleSeek(0)}
                    className="rounded p-1.5 hover:bg-white/10 hover:text-white"
                  >
                    <SkipBack size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="Rewind 5 seconds"
                    title="Rewind 5 seconds"
                    onClick={() => seekBy(-5000)}
                    className="rounded p-1.5 hover:bg-white/10 hover:text-white"
                  >
                    <Rewind size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={isPlaying ? "Pause video" : "Play video"}
                    title={isPlaying ? "Pause video" : "Play video"}
                    onClick={togglePlayback}
                    className="rounded p-1.5 hover:bg-white/10 hover:text-white"
                  >
                    {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                  <button
                    type="button"
                    aria-label="Stop video"
                    title="Stop video"
                    onClick={stopVideo}
                    className="rounded p-1.5 hover:bg-white/10 hover:text-white"
                  >
                    <Square size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label="Fast forward 5 seconds"
                    title="Fast forward 5 seconds"
                    onClick={() => seekBy(5000)}
                    className="rounded p-1.5 hover:bg-white/10 hover:text-white"
                  >
                    <FastForward size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="Go to end"
                    title="Go to end"
                    onClick={() => handleSeek(durationMs)}
                    className="rounded p-1.5 hover:bg-white/10 hover:text-white"
                  >
                    <SkipForward size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={isLooping ? "Disable loop" : "Enable loop"}
                    title={isLooping ? "Disable loop" : "Enable loop"}
                    onClick={toggleLoop}
                    className={`rounded p-1.5 hover:bg-white/10 hover:text-white ${isLooping ? "text-fuchsia-300" : ""}`}
                  >
                    <Repeat size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={
                      videoViewMode === "auto"
                        ? autoCrop
                          ? "Fit video"
                          : "Fill video"
                        : videoViewMode === "fill"
                          ? "Fit video"
                          : "Auto fit video"
                    }
                    title="Change video fit mode"
                    onClick={cycleVideoViewMode}
                    className="rounded px-1.5 py-1 text-[10px] font-semibold hover:bg-white/10 hover:text-white"
                  >
                    {videoViewLabel}
                  </button>
                  <span className="ml-1 min-w-[74px] text-center font-mono text-[10px] text-zinc-400">
                    {formatClock(playheadMs, remotionFps)} /{" "}
                    {formatClock(durationMs, remotionFps)}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#101014] p-2">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Subtitle workspace
              </span>
              <div
                role="tablist"
                aria-label="Subtitle editing view"
                className="flex rounded-lg border border-white/10 bg-black/20 p-0.5"
              >
                <button
                  type="button"
                  role="tab"
                  aria-label="Timeline view"
                  aria-selected={subtitleView === "timeline"}
                  onClick={() => setSubtitleView("timeline")}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${subtitleView === "timeline" ? "bg-white text-black" : "text-zinc-400 hover:bg-white/10 hover:text-white"}`}
                >
                  Timeline
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-label="Subtitle table view"
                  aria-selected={subtitleView === "table"}
                  onClick={() => setSubtitleView("table")}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${subtitleView === "table" ? "bg-violet-500 text-white" : "text-zinc-400 hover:bg-white/10 hover:text-white"}`}
                >
                  Cue table
                </button>
              </div>
            </div>
            {subtitleView === "table" ? (
              <SubtitleCueTable
                cues={subtitleCues}
                selectedId={selected?.id}
                playheadMs={playheadMs}
                onSelect={handleTimelineSelect}
                onChange={(cue) => updateSubtitle(cue)}
                loopSegment={subtitleTableLoop}
                onLoopSegmentChange={setSubtitleTableLoop}
                onSpeedChange={(speed) => {
                  if (videoRef.current) videoRef.current.playbackRate = speed;
                  if (remotionPlayerRef.current)
                    remotionPlayerRef.current.setPlaybackRate?.(speed);
                }}
              />
            ) : (
              <LocalEditorTimeline
                videoUrl={videoUrl}
                durationMs={durationMs}
                fps={remotionFps}
                subtitleCues={subtitleCues}
                hook={hook}
                selectedId={selected?.id}
                onSelect={handleTimelineSelect}
                onChange={handleTimelineChange}
                onChangeStart={beginTimelineEdit}
                onChangeEnd={endTimelineEdit}
                playheadMs={playheadMs}
                onSeek={handleSeek}
              />
            )}
          </div>
        </main>
        <aside className="space-y-4" aria-label="Inspector">
          <section className="rounded-xl border border-white/10 bg-white/[.02] p-4">
            <div className="flex items-center justify-between">
              <button
                type="button"
                aria-label="Toggle Subtitles settings"
                aria-expanded={subtitlesOpen}
                aria-controls="subtitle-settings-panel"
                onClick={() => setSubtitlesOpen((open) => !open)}
                className="flex items-center gap-2 text-sm font-semibold text-white"
              >
                <ChevronDown
                  size={16}
                  className={`text-violet-300 transition-transform ${subtitlesOpen ? "" : "-rotate-90"}`}
                />
                Subtitles
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Add subtitle cue"
                  title="Add subtitle cue at the current playhead"
                  onClick={addSubtitleCue}
                  className="flex items-center gap-1 rounded-md bg-violet-500/15 px-2 py-1 text-[11px] font-semibold text-violet-200 hover:bg-violet-500/25"
                >
                  <Plus size={12} />
                  Add cue
                </button>
                <FileText size={16} className="text-violet-300" />
              </div>
            </div>
            {subtitlesOpen && (
              <div id="subtitle-settings-panel" className="mt-3">
                <input
                  ref={subtitleInputRef}
                  type="file"
                  accept=".srt,.vtt,text/vtt,application/x-subrip"
                  aria-label="Subtitle file"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    setPendingSubtitle(file);
                    importSubtitleFile(file);
                  }}
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleImport}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-200 hover:bg-violet-500/20"
                  >
                    <Upload size={14} />
                    Import subtitles
                  </button>
                  <button
                    type="button"
                    onClick={generateSubtitles}
                    disabled={
                      generatingSubtitles ||
                      (!videoFile && !hasProjectClipSource)
                    }
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-2 text-xs font-semibold text-fuchsia-200 hover:bg-fuchsia-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {generatingSubtitles ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <FileText size={14} />
                    )}
                    {generatingSubtitles
                      ? "Transcribing…"
                      : "Generate subtitles"}
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    aria-label="Clean subtitle dots"
                    onClick={cleanSubtitleDots}
                    disabled={busy || masterPersisting || !subtitleCues.length}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Clean subtitle dots
                  </button>
                  {hasProjectClipSource && (
                    <button
                      type="button"
                      aria-label="Persist on master"
                      onClick={openMasterPersistDialog}
                      disabled={busy || masterPersisting}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Persist on master
                    </button>
                  )}
                </div>
                <p className="mt-2 text-[11px] leading-5 text-zinc-500">
                  Import timed .srt or .vtt files, then edit every cue directly
                  on the timeline.
                </p>
                {pendingSubtitle && (
                  <p className="mt-2 truncate text-xs text-violet-300">
                    Ready: {pendingSubtitle.name}
                  </p>
                )}
                <div className="mt-4 overflow-hidden rounded-xl border border-cyan-300/20 bg-gradient-to-br from-[#132126] via-[#10181b] to-[#101014] shadow-[0_12px_28px_rgba(0,0,0,0.18)]">
                  <div className="flex items-start gap-3 border-b border-white/8 px-3.5 py-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-400/15 text-cyan-200 ring-1 ring-cyan-300/20">
                      <Languages size={15} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-xs font-bold tracking-wide text-white">
                          Translate subtitles
                        </h3>
                        <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                          {subtitleCues.length}{" "}
                          {subtitleCues.length === 1 ? "cue" : "cues"}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-4 text-zinc-400">
                        Translate the text while timings stay intact.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-3 p-3.5">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        Source
                        <div className="relative mt-1.5">
                          <select
                            aria-label="Subtitle source language"
                            value={subtitleLanguage}
                            onChange={(event) =>
                              updateSubtitleLanguage(event.target.value)
                            }
                            disabled={translatingSubtitles}
                            style={{ colorScheme: "dark" }}
                            className="w-full appearance-none rounded-lg border border-white/10 bg-white/[.06] px-3 py-2.5 pr-8 text-xs font-medium normal-case tracking-normal text-zinc-100 outline-none transition-colors hover:border-white/20 focus:border-cyan-300/50"
                          >
                            {Object.entries(SUBTITLE_LANGUAGES).map(
                              ([code, name]) => (
                                <option
                                  key={code}
                                  value={code}
                                  style={{
                                    backgroundColor: "#171e21",
                                    color: "#f4f4f5",
                                  }}
                                >
                                  {name}
                                </option>
                              ),
                            )}
                          </select>
                          <ChevronDown
                            size={14}
                            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
                          />
                        </div>
                      </label>
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        Target
                        <div className="relative mt-1.5">
                          <select
                            aria-label="Translation target language"
                            value={translationTarget}
                            onChange={(event) =>
                              setTranslationTarget(event.target.value)
                            }
                            disabled={translatingSubtitles}
                            style={{ colorScheme: "dark" }}
                            className="w-full appearance-none rounded-lg border border-white/10 bg-white/[.06] px-3 py-2.5 pr-8 text-xs font-medium normal-case tracking-normal text-zinc-100 outline-none transition-colors hover:border-white/20 focus:border-cyan-300/50"
                          >
                            {Object.entries(SUBTITLE_LANGUAGES).map(
                              ([code, name]) => (
                                <option
                                  key={code}
                                  value={code}
                                  disabled={code === subtitleLanguage}
                                  style={{
                                    backgroundColor: "#171e21",
                                    color:
                                      code === subtitleLanguage
                                        ? "#a1a1aa"
                                        : "#f4f4f5",
                                  }}
                                >
                                  {name}
                                  {code === subtitleLanguage ? " (source)" : ""}
                                </option>
                              ),
                            )}
                          </select>
                          <ChevronDown
                            size={14}
                            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
                          />
                        </div>
                      </label>
                    </div>
                    <button
                      type="button"
                      aria-label="Translate subtitles"
                      onClick={translateSubtitles}
                      disabled={
                        translatingSubtitles ||
                        !subtitleCues.length ||
                        translationTarget === subtitleLanguage
                      }
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan-400 to-sky-500 px-3 py-2.5 text-xs font-bold text-white shadow-[0_8px_18px_rgba(34,211,238,0.16)] transition-all hover:from-cyan-300 hover:to-sky-400 hover:shadow-[0_10px_24px_rgba(34,211,238,0.24)] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
                    >
                      {translatingSubtitles ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Languages size={14} />
                      )}
                      {translatingSubtitles
                        ? "Translating…"
                        : "Translate subtitles"}
                    </button>
                  </div>
                </div>
                <SubtitleStyleInspector
                  style={subtitleStyle}
                  onChange={updateSubtitleStyle}
                  onRemove={removeSubtitles}
                  hasCues={subtitleCues.length > 0}
                />
              </div>
            )}
          </section>
          <section className="rounded-xl border border-white/10 bg-white/[.02] p-4">
            <div className="flex items-center justify-between">
              <button
                type="button"
                aria-label="Toggle Viral Hook settings"
                aria-expanded={hookOpen}
                aria-controls="viral-hook-settings-panel"
                onClick={() => setHookOpen((open) => !open)}
                className="flex items-center gap-2 text-sm font-semibold text-white"
              >
                <ChevronDown
                  size={16}
                  className={`text-amber-300 transition-transform ${hookOpen ? "" : "-rotate-90"}`}
                />
                Viral Hook
              </button>
              <button
                type="button"
                onClick={addHook}
                className="flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/25"
              >
                <Plus size={12} />
                {hook ? "Reset hook" : "Add Viral Hook"}
              </button>
            </div>
            {hookOpen && (
              <div id="viral-hook-settings-panel" className="mt-3">
                {selected?.type === "hook" ? (
                  <HookInspector
                    hook={selectedCue}
                    onChange={updateHook}
                    onRemove={removeHook}
                  />
                ) : (
                  <HookInspector
                    hook={null}
                    onChange={updateHook}
                    onRemove={removeHook}
                  />
                )}
              </div>
            )}
          </section>
          <div className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-xs text-zinc-500">
            <span>Playhead</span>
            <span className="font-mono text-zinc-300">
              {formatClock(playheadMs, remotionFps)} /{" "}
              {formatClock(durationMs, remotionFps)}
            </span>
          </div>
          {sidePanel}
        </aside>
      </div>
      {footer && (
        <div className="border-t border-white/10 px-6 py-3">{footer}</div>
      )}
      {projectsDialog}
      {editingSubtitle && (
        <SubtitleCueModal
          cue={
            selected?.type === "subtitle"
              ? selectedCue || editingSubtitle
              : editingSubtitle
          }
          onClose={() => setEditingSubtitle(null)}
          onDelete={removeSubtitleCue}
          onSave={(cue) => {
            updateSubtitle(cue);
          }}
        />
      )}
    </div>
  );
}
