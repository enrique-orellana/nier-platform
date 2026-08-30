import React from "react";
import {
  SUBTITLE_ANIMATION_OPTIONS,
  SUBTITLE_COLOR_PRESETS,
  SUBTITLE_FONT_OPTIONS,
  SUBTITLE_HIGHLIGHT_PRESETS,
  SUBTITLE_STYLE_TEMPLATES,
  normalizeSubtitleStyle,
} from "./localEditorStyles";
import { cleanChoiceClass, cleanLabelClass } from "./localEditorUtils";
import {
  clampSubtitleCoordinate,
  getSubtitlePositionCoordinates,
} from "../../remotion/lib/subtitleVisual";

export default function LocalEditorSubtitleStyleInspector({
  style,
  onChange,
  onRemove,
  hasCues,
  renderWidth = 1080,
  renderHeight = 1920,
}) {
  const current = normalizeSubtitleStyle(style);
  const update = (key, value) => onChange({ ...current, [key]: value });
  const applyTemplate = (template) => {
    const nextStyle = { ...current, ...template.style };
    delete nextStyle.positionX;
    delete nextStyle.positionY;
    onChange(nextStyle);
  };
  const resolvedPosition = getSubtitlePositionCoordinates(
    current,
    renderWidth,
    renderHeight,
  );
  const updateCoordinate = (key, rawValue) => {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    onChange({
      ...current,
      position: "custom",
      positionX: clampSubtitleCoordinate(
        key === "positionX" ? value : resolvedPosition.x,
        renderWidth,
        resolvedPosition.x,
      ),
      positionY: clampSubtitleCoordinate(
        key === "positionY" ? value : resolvedPosition.y,
        renderHeight,
        resolvedPosition.y,
      ),
    });
  };
  const selectPresetPosition = (position) => {
    const styleWithoutCoordinates = { ...current };
    delete styleWithoutCoordinates.positionX;
    delete styleWithoutCoordinates.positionY;
    onChange({ ...styleWithoutCoordinates, position });
  };
  return (
    <div className="space-y-5">
      <div className="border-b border-white/10 pb-4">
        <span className={cleanLabelClass}>Quick picks</span>
        <div className="grid grid-cols-2 gap-2">
          {SUBTITLE_STYLE_TEMPLATES.map((template) => {
            const isActive = Object.entries(template.style).every(
              ([key, value]) => current[key] === value,
            );
            return (
              <button
                key={template.id}
                type="button"
                aria-label={template.ariaLabel}
                title={template.description}
                onClick={() => applyTemplate(template)}
                className={`flex min-h-[58px] items-center gap-2 rounded-lg border p-2 text-left transition-colors ${isActive ? "border-primary bg-primary/15" : "border-white/10 bg-white/[.02] hover:border-white/25 hover:bg-white/[.05]"}`}
              >
                <span
                  className="flex h-8 w-9 shrink-0 items-center justify-center rounded-md border text-sm font-bold"
                  style={{
                    backgroundColor: template.preview.backgroundColor,
                    borderColor: template.preview.accent,
                    color: template.preview.color,
                    fontFamily: template.style.fontFamily,
                  }}
                >
                  Aa
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-zinc-100">
                    {template.label}
                  </span>
                  <span className="block truncate text-[10px] text-zinc-500">
                    {template.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className={cleanLabelClass.replace("mb-2 ", "")}>Position</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            {current.position === "custom"
              ? "Custom position"
              : "Preset position"}
          </span>
        </div>
        <div
          role="group"
          aria-label="Subtitle position"
          className="grid grid-cols-3 gap-2"
        >
          {["top", "middle", "bottom"].map((position) => (
            <button
              key={position}
              type="button"
              onClick={() => selectPresetPosition(position)}
              className={cleanChoiceClass(current.position === position)}
            >
              {position.charAt(0).toUpperCase() + position.slice(1)}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-xs text-zinc-400">
            X (px)
            <input
              aria-label="Subtitle X position"
              type="number"
              min="0"
              max={renderWidth}
              step="1"
              value={resolvedPosition.x}
              onChange={(event) =>
                updateCoordinate("positionX", event.target.value)
              }
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-zinc-400">
            Y (px)
            <input
              aria-label="Subtitle Y position"
              type="number"
              min="0"
              max={renderHeight}
              step="1"
              value={resolvedPosition.y}
              onChange={(event) =>
                updateCoordinate("positionY", event.target.value)
              }
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white"
            />
          </label>
        </div>
        <p className="mt-2 text-[10px] text-zinc-500">
          Center point in a {renderWidth} × {renderHeight} px video.
        </p>
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
      <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[.02] px-3 py-2.5">
        <div>
          <span className="block text-xs font-semibold text-zinc-200">
            One word at a time
          </span>
          <span className="block text-[10px] text-zinc-500">
            Show only the active timed word in the preview and export
          </span>
        </div>
        <button
          type="button"
          aria-label="One word at a time"
          aria-pressed={current.displayMode === "single-word"}
          onClick={() =>
            update(
              "displayMode",
              current.displayMode === "single-word" ? "phrase" : "single-word",
            )
          }
          className={`relative h-5 w-10 shrink-0 rounded-full transition-colors ${current.displayMode === "single-word" ? "bg-primary" : "bg-zinc-700"}`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${current.displayMode === "single-word" ? "translate-x-5" : ""}`}
          />
        </button>
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
