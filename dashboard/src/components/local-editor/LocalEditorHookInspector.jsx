import React from "react";
import {
  HOOK_ENTRANCE_OPTIONS,
  HOOK_SIZE_OPTIONS,
  SUBTITLE_COLOR_PRESETS,
} from "./localEditorStyles";
import { cleanChoiceClass, cleanLabelClass } from "./localEditorUtils";
import {
  clampHookCoordinate,
  getHookPositionCoordinates,
  normalizeHookBoxStyle,
} from "../../remotion/lib/hookVisual";
import { Button, Input, Textarea } from "../ui";

const sectionClass = "space-y-3 border-t border-border pt-4";
const sectionHeadingClass = "text-xs font-semibold text-foreground";

export default function LocalEditorHookInspector({
  hook,
  onChange,
  onRemove,
  renderWidth = 1080,
  renderHeight = 1920,
}) {
  if (!hook)
    return (
      <p className="text-xs text-muted-foreground">
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
  const resolvedPosition = getHookPositionCoordinates(
    hook,
    renderWidth,
    renderHeight,
  );
  const updateCoordinate = (key, rawValue) => {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    onChange({
      ...hook,
      position: "custom",
      positionX: clampHookCoordinate(
        key === "positionX" ? value : resolvedPosition.x,
        renderWidth,
        resolvedPosition.x,
      ),
      positionY: clampHookCoordinate(
        key === "positionY" ? value : resolvedPosition.y,
        renderHeight,
        resolvedPosition.y,
      ),
    });
  };
  const selectPresetPosition = (position) => {
    const hookWithoutCoordinates = { ...hook };
    delete hookWithoutCoordinates.positionX;
    delete hookWithoutCoordinates.positionY;
    onChange({ ...hookWithoutCoordinates, position });
  };
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Viral Hook</h3>
        <section
          aria-labelledby="hook-content-heading"
          className="mt-4 space-y-3"
        >
          <h4 id="hook-content-heading" className={sectionHeadingClass}>
            Content
          </h4>
          <label className="block">
            <span className={cleanLabelClass}>Text</span>
            <Textarea
              aria-label="Hook text"
              rows={4}
              value={hook.text}
              onChange={(event) =>
                onChange({ ...hook, text: event.target.value })
              }
              className="w-full resize-none"
              placeholder="Enter text that will stop the scroll..."
            />
          </label>
        </section>
      </div>

      <section aria-labelledby="hook-layout-heading" className={sectionClass}>
        <h4 id="hook-layout-heading" className={sectionHeadingClass}>
          Layout
        </h4>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className={cleanLabelClass}>Position</span>
            <span className="text-xs text-muted-foreground">
              {hook.position === "custom"
                ? "Custom position"
                : "Preset position"}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {["top", "center", "bottom"].map((position) => (
              <Button
                variant="ghost"
                key={position}
                type="button"
                aria-label={
                  position.charAt(0).toUpperCase() + position.slice(1)
                }
                onClick={() => selectPresetPosition(position)}
                className={cleanChoiceClass(hook.position === position)}
              >
                {position}
              </Button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="text-sm font-medium text-muted-foreground">
              X (px)
              <Input
                aria-label="Hook X position"
                type="number"
                min="0"
                max={renderWidth}
                step="1"
                value={resolvedPosition.x}
                onChange={(event) =>
                  updateCoordinate("positionX", event.target.value)
                }
                className="mt-2"
              />
            </label>
            <label className="text-sm font-medium text-muted-foreground">
              Y (px)
              <Input
                aria-label="Hook Y position"
                type="number"
                min="0"
                max={renderHeight}
                step="1"
                value={resolvedPosition.y}
                onChange={(event) =>
                  updateCoordinate("positionY", event.target.value)
                }
                className="mt-2"
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Center point in a {renderWidth} × {renderHeight} px video.
          </p>
        </div>
        <div>
          <span className={cleanLabelClass}>Size</span>
          <div className="grid grid-cols-3 gap-2">
            {HOOK_SIZE_OPTIONS.map((option) => (
              <Button
                variant="ghost"
                key={option.value}
                type="button"
                onClick={() => onChange({ ...hook, size: option.value })}
                className={cleanChoiceClass(
                  (hook.size || "M") === option.value,
                )}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
        <div>
          <span className={cleanLabelClass}>Entrance</span>
          <div className="grid grid-cols-2 gap-2">
            {HOOK_ENTRANCE_OPTIONS.map((option) => (
              <Button
                variant="ghost"
                key={option.value}
                type="button"
                onClick={() =>
                  onChange({ ...hook, entranceAnimation: option.value })
                }
                className={cleanChoiceClass(
                  (hook.entranceAnimation || "spring") === option.value,
                )}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="hook-timing-heading" className={sectionClass}>
        <h4 id="hook-timing-heading" className={sectionHeadingClass}>
          Timing
        </h4>
        <div>
          <label
            className={`${cleanLabelClass} flex items-center justify-between`}
          >
            <span>Duration</span>
            <span>{displayDuration}s</span>
          </label>
          <Input
            aria-label="Hook duration"
            type="range"
            min="2"
            max="15"
            value={displayDuration}
            onChange={(event) => updateDuration(event.target.value)}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>2s</span>
            <span>15s</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm font-medium text-muted-foreground">
            Start (ms)
            <Input
              aria-label="Hook start"
              type="number"
              value={hook.startMs}
              onChange={(event) =>
                onChange({ ...hook, startMs: Number(event.target.value) })
              }
              className="mt-2"
            />
          </label>
          <label className="text-sm font-medium text-muted-foreground">
            End (ms)
            <Input
              aria-label="Hook end"
              type="number"
              value={hook.endMs}
              onChange={(event) =>
                onChange({ ...hook, endMs: Number(event.target.value) })
              }
              className="mt-2"
            />
          </label>
        </div>
      </section>

      <section
        aria-labelledby="hook-appearance-heading"
        className={sectionClass}
      >
        <h4 id="hook-appearance-heading" className={sectionHeadingClass}>
          Appearance
        </h4>
        <div>
          <span className={cleanLabelClass}>Box style</span>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: "rounded", label: "Rounded" },
              { value: "headline_cards", label: "Headline cards" },
            ].map((option) => (
              <Button
                variant="ghost"
                key={option.value}
                type="button"
                aria-label={option.label}
                aria-pressed={
                  normalizeHookBoxStyle(hook.boxStyle) === option.value
                }
                onClick={() => onChange({ ...hook, boxStyle: option.value })}
                className={cleanChoiceClass(
                  normalizeHookBoxStyle(hook.boxStyle) === option.value,
                )}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            In Headline cards, use line breaks to create separate cards.
          </p>
        </div>
        <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(100px,0.8fr)] items-start gap-3">
          <div>
            <span className={cleanLabelClass}>Text color</span>
            <div
              className="flex flex-wrap gap-2"
              aria-label="Hook text color presets"
            >
              {SUBTITLE_COLOR_PRESETS.map((preset) => (
                <Button
                  variant="ghost"
                  key={preset.color}
                  type="button"
                  aria-label={`Use hook text color ${preset.label}`}
                  title={preset.label}
                  onClick={() => onChange({ ...hook, color: preset.color })}
                  className={`h-7 w-7 min-h-7 min-w-7 shrink-0 rounded-full border-2 p-0 transition-all ${String(hook.color || "").toUpperCase() === preset.color ? "scale-110 border-ring ring-2 ring-ring ring-offset-2 ring-offset-background" : "border-input hover:border-ring"}`}
                  style={{ backgroundColor: preset.color }}
                />
              ))}
              <label
                className="relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-input p-0 transition-colors hover:border-ring"
                title="Custom color"
              >
                <span className="text-xs text-muted-foreground">+</span>
                <Input
                  aria-label="Hook text color"
                  type="color"
                  value={hook.color}
                  onChange={(event) =>
                    onChange({ ...hook, color: event.target.value })
                  }
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
              </label>
            </div>
          </div>
          <label className="block text-sm font-medium text-muted-foreground">
            Size
            <Input
              aria-label="Hook font size"
              type="number"
              min="12"
              max="160"
              value={hook.fontSize}
              onChange={(event) =>
                onChange({ ...hook, fontSize: Number(event.target.value) })
              }
              className="mt-2"
            />
          </label>
        </div>
        <div>
          <span className={cleanLabelClass}>Background</span>
          <div
            className="flex flex-wrap gap-2"
            aria-label="Hook background color presets"
          >
            {SUBTITLE_COLOR_PRESETS.map((preset) => (
              <Button
                variant="ghost"
                key={preset.color}
                type="button"
                aria-label={`Use hook background ${preset.label}`}
                title={preset.label}
                onClick={() => onChange({ ...hook, background: preset.color })}
                className={`h-7 w-7 min-h-7 min-w-7 shrink-0 rounded-full border-2 p-0 transition-all ${String(hook.background || "").toUpperCase() === preset.color ? "scale-110 border-ring ring-2 ring-ring ring-offset-2 ring-offset-background" : "border-input hover:border-ring"}`}
                style={{ backgroundColor: preset.color }}
              />
            ))}
            <label
              className="relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-input p-0 transition-colors hover:border-ring"
              title="Custom background color"
            >
              <span className="text-xs text-muted-foreground">+</span>
              <Input
                aria-label="Hook background"
                type="color"
                value={hook.background}
                onChange={(event) =>
                  onChange({ ...hook, background: event.target.value })
                }
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
          </div>
        </div>
      </section>

      <div className="border-t border-border pt-4">
        <Button
          variant="destructive"
          type="button"
          onClick={onRemove}
          className="w-full"
        >
          Remove Hook
        </Button>
      </div>
    </div>
  );
}
