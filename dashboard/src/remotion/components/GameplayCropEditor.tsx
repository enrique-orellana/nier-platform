import React, { useEffect, useMemo, useRef, useState } from "react";
import type { SourcePoint, SourceRegion } from "../lib/types";
import { normalizeRegion, resolveGameplayCrop } from "../lib/gameplayFraming";

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2;

type FramingValue = {
  focus: SourcePoint;
  zoom: number;
};

type Interaction = {
  mode: "move" | "resize";
  handle?: string;
  start: SourcePoint;
  origin: FramingValue;
  originCrop: SourceRegion;
};

type GameplayCropEditorProps = {
  region: SourceRegion;
  sourceAspect: number;
  panelAspect: number;
  focus?: SourcePoint;
  zoom?: number;
  onChange?: (next: FramingValue) => void;
  onReset?: () => void;
  onDone?: () => void;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const normalizePoint = (
  point: SourcePoint,
  region: SourceRegion,
): SourcePoint => ({
  x: clamp(Number(point?.x) || 0, region.x, region.x + region.width),
  y: clamp(Number(point?.y) || 0, region.y, region.y + region.height),
});

const normalizeZoom = (zoom: number | undefined) =>
  clamp(Number(zoom) || 1, MIN_ZOOM, MAX_ZOOM);

const defaultFocus = (region: SourceRegion): SourcePoint => ({
  x: region.x + region.width / 2,
  y: region.y + region.height / 2,
});

const normalizeFraming = (
  region: SourceRegion,
  focus: SourcePoint | undefined,
  zoom: number | undefined,
): FramingValue => ({
  focus: normalizePoint(focus || defaultFocus(region), region),
  zoom: normalizeZoom(zoom),
});

const pointAtStage = (
  event: { clientX: number; clientY: number },
  stage: HTMLElement | null,
  region: SourceRegion,
): SourcePoint => {
  const rect = stage?.getBoundingClientRect?.();
  if (!rect?.width || !rect?.height) return defaultFocus(region);
  return {
    x:
      region.x +
      clamp((event.clientX - rect.left) / rect.width, 0, 1) * region.width,
    y:
      region.y +
      clamp((event.clientY - rect.top) / rect.height, 0, 1) * region.height,
  };
};

const frameStyle = (crop: SourceRegion, region: SourceRegion) => ({
  left: `${((crop.x - region.x) / region.width) * 100}%`,
  top: `${((crop.y - region.y) / region.height) * 100}%`,
  width: `${(crop.width / region.width) * 100}%`,
  height: `${(crop.height / region.height) * 100}%`,
});

const handleLabels: Record<string, string> = {
  nw: "northwest",
  ne: "northeast",
  sw: "southwest",
  se: "southeast",
};

export default function GameplayCropEditor({
  region: inputRegion,
  sourceAspect,
  panelAspect,
  focus,
  zoom,
  onChange,
  onReset,
  onDone,
}: GameplayCropEditorProps) {
  const region = useMemo(
    () =>
      normalizeRegion(inputRegion) || {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      },
    [inputRegion],
  );
  const [framing, setFraming] = useState(() =>
    normalizeFraming(region, focus, zoom),
  );
  const framingRef = useRef(framing);
  const interactionRef = useRef<Interaction | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [isInteracting, setIsInteracting] = useState(false);

  useEffect(() => {
    if (interactionRef.current) return;
    const next = normalizeFraming(region, focus, zoom);
    framingRef.current = next;
    setFraming(next);
  }, [focus, region, zoom]);

  const crop = useMemo(
    () =>
      resolveGameplayCrop({
        region,
        sourceAspect,
        panelAspect,
        focus: framing.focus,
        zoom: framing.zoom,
      }),
    [framing, panelAspect, region, sourceAspect],
  );

  const updateFraming = (next: FramingValue) => {
    framingRef.current = next;
    setFraming(next);
    return next;
  };

  const framingAtPoint = (interaction: Interaction, point: SourcePoint) => {
    if (interaction.mode === "move") {
      return {
        ...interaction.origin,
        focus: normalizePoint(
          {
            x:
              interaction.originCrop.x +
              interaction.originCrop.width / 2 +
              point.x -
              interaction.start.x,
            y:
              interaction.originCrop.y +
              interaction.originCrop.height / 2 +
              point.y -
              interaction.start.y,
          },
          region,
        ),
      };
    }

    const center = {
      x: interaction.originCrop.x + interaction.originCrop.width / 2,
      y: interaction.originCrop.y + interaction.originCrop.height / 2,
    };
    const widthRatio =
      Math.abs(point.x - center.x) /
      Math.max(0.0001, interaction.originCrop.width / 2);
    const heightRatio =
      Math.abs(point.y - center.y) /
      Math.max(0.0001, interaction.originCrop.height / 2);
    const ratio = Math.max(widthRatio, heightRatio, 0.05);
    return {
      ...interaction.origin,
      zoom: normalizeZoom(interaction.origin.zoom / ratio),
    };
  };

  useEffect(() => {
    if (!isInteracting) return undefined;
    const handleMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction) return;
      event.preventDefault();
      const point = pointAtStage(event, stageRef.current, region);
      updateFraming(framingAtPoint(interaction, point));
    };
    const stop = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction) return;
      const point = pointAtStage(event, stageRef.current, region);
      const next = updateFraming(framingAtPoint(interaction, point));
      interactionRef.current = null;
      setIsInteracting(false);
      onChange?.(next);
    };
    const cancel = () => {
      interactionRef.current = null;
      setIsInteracting(false);
      const next = normalizeFraming(region, focus, zoom);
      framingRef.current = next;
      setFraming(next);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [focus, isInteracting, onChange, region, zoom]);

  const beginInteraction = (
    event: React.PointerEvent,
    mode: Interaction["mode"],
    handle?: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const origin = framingRef.current;
    interactionRef.current = {
      mode,
      handle,
      start: pointAtStage(event, stageRef.current, region),
      origin,
      originCrop: resolveGameplayCrop({
        region,
        sourceAspect,
        panelAspect,
        focus: origin.focus,
        zoom: origin.zoom,
      }),
    };
    setIsInteracting(true);
  };

  const reset = () => {
    const next = normalizeFraming(region, focus, zoom);
    framingRef.current = next;
    setFraming(next);
    onReset?.();
  };

  return (
    <div
      ref={stageRef}
      data-testid="gameplay-crop-editor-stage"
      className="absolute inset-0 z-30 touch-none"
      aria-label="Gameplay framing editor"
    >
      <div className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-md border border-white/20 bg-black/75 p-1 text-[10px] text-white shadow-lg">
        <span className="px-1 text-zinc-300">Drag to frame</span>
        <button
          type="button"
          aria-label="Reset gameplay framing"
          onClick={reset}
          className="rounded px-1.5 py-1 text-zinc-300 hover:bg-white/15 hover:text-white"
        >
          Reset
        </button>
        <button
          type="button"
          aria-label="Done editing gameplay framing"
          onClick={onDone}
          className="rounded bg-cyan-300 px-1.5 py-1 font-semibold text-slate-950 hover:bg-cyan-200"
        >
          Done
        </button>
      </div>
      <div
        data-testid="gameplay-crop-editor-frame"
        role="button"
        tabIndex={0}
        aria-label="Drag gameplay crop"
        onPointerDown={(event) => beginInteraction(event, "move")}
        className="absolute cursor-move border-2 border-cyan-200 bg-cyan-200/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        style={frameStyle(crop, region)}
      >
        <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[9px] font-semibold text-cyan-100">
          {framing.zoom.toFixed(2)}×
        </span>
        {Object.keys(handleLabels).map((handle) => (
          <button
            key={handle}
            type="button"
            aria-label={`Resize gameplay crop ${handleLabels[handle]}`}
            onPointerDown={(event) => beginInteraction(event, "resize", handle)}
            className={`absolute h-3 w-3 rounded-sm border border-white bg-cyan-300 shadow ${handle.includes("n") ? "top-[-7px]" : "bottom-[-7px]"} ${handle.includes("w") ? "left-[-7px]" : "right-[-7px]"}`}
          />
        ))}
      </div>
    </div>
  );
}
