import React from "react";
import {
  SUBTITLE_ANIMATION_OPTIONS,
  SUBTITLE_COLOR_PRESETS,
  SUBTITLE_FONT_OPTIONS,
  SUBTITLE_HIGHLIGHT_PRESETS,
  SUBTITLE_STYLE_TEMPLATES,
  normalizeSubtitleStyle,
} from "./localEditorStyles";
import { getSubtitlePositionCoordinates } from "../../remotion/lib/subtitlePosition";
import { cleanChoiceClass, cleanLabelClass } from "./localEditorUtils";
import { Button, Input, NativeSelect, Switch } from "../ui";

export default function LocalEditorSubtitleStyleInspector({
  style,
  renderWidth = 1080,
  renderHeight = 1920,
  onChange,
  onRemove,
  hasCues,
}) {
  const current = normalizeSubtitleStyle(style);
  const coordinates = getSubtitlePositionCoordinates(
    current,
    renderWidth,
    renderHeight,
  );
  const update = (key, value) => onChange({ ...current, [key]: value });
  const updateCoordinate = (key, rawValue) => {
    const value = rawValue === "" ? "" : Number(rawValue);
    onChange({
      ...current,
      position: "custom",
      positionX: key === "positionX" ? value : coordinates.x,
      positionY: key === "positionY" ? value : coordinates.y,
    });
  };
  const commitCoordinate = (key) => {
    const next = { ...current, position: "custom" };
    const resolved = getSubtitlePositionCoordinates(
      next,
      renderWidth,
      renderHeight,
    );
    onChange({
      ...current,
      position: "custom",
      positionX: key === "positionX" ? resolved.x : coordinates.x,
      positionY: key === "positionY" ? resolved.y : coordinates.y,
    });
  };
  const selectPreset = (position) => {
    const next = { ...current, position };
    delete next.positionX;
    delete next.positionY;
    onChange(next);
  };
  const applyTemplate = (template) => {
    const next = { ...current, ...template.style };
    if (template.style.position && template.style.position !== "custom") {
      delete next.positionX;
      delete next.positionY;
    }
    onChange(next);
  };
  return (
    <div className="space-y-5">
      <div className="border-b border-border pb-4">
        <span className={cleanLabelClass}>Quick picks</span>
        <div className="grid grid-cols-2 gap-2">
          {SUBTITLE_STYLE_TEMPLATES.map((template) => {
            const isActive = Object.entries(template.style).every(
              ([key, value]) => current[key] === value,
            );
            return (
              <Button
                variant={isActive ? "secondary" : "outline"}
                key={template.id}
                type="button"
                aria-label={template.ariaLabel}
                title={template.description}
                onClick={() => applyTemplate(template)}
                className="h-auto min-h-[58px] justify-start whitespace-normal px-3 py-2 text-left"
              >
                <span
                  className="flex h-8 w-9 shrink-0 items-center justify-center rounded-md border border-border text-sm font-bold"
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
                  <span className="block truncate text-xs font-semibold text-foreground">
                    {template.label}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {template.description}
                  </span>
                </span>
              </Button>
            );
          })}
        </div>
      </div>
      <div>
        <span className={cleanLabelClass}>Position</span>
        <div
          role="group"
          aria-label="Subtitle position"
          className="grid grid-cols-3 gap-2"
        >
          {["top", "middle", "bottom"].map((position) => (
            <Button
              variant={current.position === position ? "secondary" : "outline"}
              key={position}
              type="button"
              onClick={() => selectPreset(position)}
              className={cleanChoiceClass(current.position === position)}
            >
              {position.charAt(0).toUpperCase() + position.slice(1)}
            </Button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-sm font-medium text-muted-foreground">
            X (px)
            <Input
              aria-label="Subtitle X position"
              type="number"
              min="0"
              max={renderWidth}
              step="1"
              value={
                current.position === "custom"
                  ? (current.positionX ?? coordinates.x)
                  : coordinates.x
              }
              onChange={(event) =>
                updateCoordinate("positionX", event.target.value)
              }
              onBlur={() => commitCoordinate("positionX")}
              className="mt-2"
            />
          </label>
          <label className="text-sm font-medium text-muted-foreground">
            Y (px)
            <Input
              aria-label="Subtitle Y position"
              type="number"
              min="0"
              max={renderHeight}
              step="1"
              value={
                current.position === "custom"
                  ? (current.positionY ?? coordinates.y)
                  : coordinates.y
              }
              onChange={(event) =>
                updateCoordinate("positionY", event.target.value)
              }
              onBlur={() => commitCoordinate("positionY")}
              className="mt-2"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Center point in a {renderWidth} × {renderHeight} video.
        </p>
      </div>
      <div>
        <span className={cleanLabelClass}>Animation</span>
        <div className="grid grid-cols-2 gap-2">
          {SUBTITLE_ANIMATION_OPTIONS.map((option) => (
            <Button
              variant={
                current.animation === option.value ? "secondary" : "outline"
              }
              key={option.value}
              type="button"
              onClick={() => update("animation", option.value)}
              className={cleanChoiceClass(current.animation === option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted px-3 py-3">
        <div>
          <span className="block text-sm font-medium text-foreground">
            One word at a time
          </span>
          <span className="block text-xs text-muted-foreground">
            Show only the active timed word in the preview and export
          </span>
        </div>
        <Switch
          aria-label="One word at a time"
          checked={current.displayMode === "single-word"}
          onCheckedChange={(checked) =>
            update("displayMode", checked ? "single-word" : "phrase")
          }
        />
      </div>
      <div>
        <label className={cleanLabelClass}>
          Font
          <NativeSelect
            aria-label="Subtitle font"
            value={current.fontFamily}
            onChange={(event) => update("fontFamily", event.target.value)}
            className="mt-2"
          >
            {SUBTITLE_FONT_OPTIONS.map((font) => (
              <option key={font} value={font} style={{ fontFamily: font }}>
                {font}
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>
      <label className="block text-sm font-medium text-muted-foreground">
        Font Size
        <Input
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
          className="mt-2"
        />
      </label>
      <div>
        <span className={cleanLabelClass}>Text Color</span>
        <div
          className="flex flex-wrap gap-2"
          aria-label="Subtitle text color presets"
        >
          {SUBTITLE_COLOR_PRESETS.map((preset) => (
            <Button
              variant="ghost"
              size="icon"
              key={preset.color}
              type="button"
              aria-label={`Use subtitle color ${preset.label}`}
              title={preset.label}
              onClick={() => update("fontColor", preset.color)}
              className={`h-7 min-h-0 w-7 min-w-0 rounded-full border-2 p-0 transition-all ${current.fontColor.toUpperCase() === preset.color ? "scale-110 border-ring ring-2 ring-ring ring-offset-2 ring-offset-background" : "border-input hover:border-ring"}`}
              style={{ backgroundColor: preset.color }}
            />
          ))}
          <label
            className="relative flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-input transition-colors hover:border-ring"
            title="Custom color"
          >
            <span className="text-xs text-muted-foreground">+</span>
            <Input
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
            <Button
              variant="ghost"
              size="icon"
              key={preset.color}
              type="button"
              aria-label={`Use subtitle highlight color ${preset.label}`}
              title={preset.label}
              onClick={() => update("highlightColor", preset.color)}
              className={`h-7 min-h-0 w-7 min-w-0 rounded-full border-2 p-0 transition-all ${current.highlightColor.toUpperCase() === preset.color ? "scale-110 border-ring ring-2 ring-ring ring-offset-2 ring-offset-background" : "border-input hover:border-ring"}`}
              style={{ backgroundColor: preset.color }}
            />
          ))}
        </div>
        <Input
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
            className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-md border border-input"
            title="Border color"
          >
            <div
              className="h-full w-full"
              style={{ backgroundColor: current.borderColor }}
            />
            <Input
              aria-label="Subtitle outline color"
              type="color"
              value={current.borderColor}
              onChange={(event) => update("borderColor", event.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <div className="flex-1">
            <Input
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
            <div className="flex justify-between text-xs text-muted-foreground">
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
          <Switch
            aria-label={
              current.bgOpacity > 0
                ? "Hide background box"
                : "Show background box"
            }
            checked={current.bgOpacity > 0}
            onCheckedChange={(checked) =>
              update("bgOpacity", checked ? 0.5 : 0)
            }
          />
        </div>
        {current.bgOpacity > 0 && (
          <div className="flex items-center gap-3">
            <label
              className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-md border border-input"
              title="Background color"
            >
              <div
                className="h-full w-full"
                style={{ backgroundColor: current.bgColor }}
              />
              <Input
                aria-label="Subtitle background color"
                type="color"
                value={current.bgColor}
                onChange={(event) => update("bgColor", event.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
            <div className="flex-1">
              <Input
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
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Transparent</span>
                <span>{Math.round(current.bgOpacity * 100)}%</span>
              </div>
            </div>
          </div>
        )}
      </div>
      {!hasCues && (
        <p className="text-xs text-muted-foreground">
          Import subtitles to enable this style.
        </p>
      )}
      {hasCues && (
        <Button
          variant="destructive"
          type="button"
          onClick={onRemove}
          className="w-full"
        >
          Remove Subtitles
        </Button>
      )}
    </div>
  );
}
