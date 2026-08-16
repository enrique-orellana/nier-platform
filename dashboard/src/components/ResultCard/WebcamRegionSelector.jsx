import { useEffect, useRef, useState } from 'react';

const MIN_REGION_SIZE = 0.02;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function normalizeRegion(region) {
  if (!region) return null;
  const values = ['x', 'y', 'width', 'height'].map((key) => Number(region[key]));
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [x, y, width, height] = values;
  if (width <= 0 || height <= 0 || x < 0 || y < 0 || x + width > 1 || y + height > 1) return null;
  return { x, y, width, height };
}

function fitRange(start, end) {
  let low = Math.min(start, end);
  let high = Math.max(start, end);
  if (high - low < MIN_REGION_SIZE) {
    high = Math.min(1, low + MIN_REGION_SIZE);
    low = Math.max(0, high - MIN_REGION_SIZE);
  }
  return [low, high];
}

function pointToRegion(start, end) {
  const [x, right] = fitRange(start.x, end.x);
  const [y, bottom] = fitRange(start.y, end.y);
  return { x, y, width: right - x, height: bottom - y };
}

function getRegionContentRect(stage, video) {
  const stageRect = stage?.getBoundingClientRect?.();
  if (!stageRect?.width || !stageRect?.height) return null;
  const sourceWidth = Number(video?.videoWidth) || stageRect.width;
  const sourceHeight = Number(video?.videoHeight) || stageRect.height;
  const sourceAspect = sourceWidth / sourceHeight;
  const stageAspect = stageRect.width / stageRect.height;

  if (sourceAspect >= stageAspect) {
    const height = stageRect.width / sourceAspect;
    return {
      left: stageRect.left,
      top: stageRect.top + (stageRect.height - height) / 2,
      width: stageRect.width,
      height,
    };
  }

  const width = stageRect.height * sourceAspect;
  return {
    left: stageRect.left + (stageRect.width - width) / 2,
    top: stageRect.top,
    width,
    height: stageRect.height,
  };
}

function contentBoxAsPercent(stage, contentRect) {
  const stageRect = stage?.getBoundingClientRect?.();
  if (!stageRect?.width || !stageRect?.height || !contentRect) {
    return { left: 0, top: 0, width: 100, height: 100 };
  }
  return {
    left: ((contentRect.left - stageRect.left) / stageRect.width) * 100,
    top: ((contentRect.top - stageRect.top) / stageRect.height) * 100,
    width: (contentRect.width / stageRect.width) * 100,
    height: (contentRect.height / stageRect.height) * 100,
  };
}

function resizeRegion(origin, point, handle) {
  let left = origin.x;
  let right = origin.x + origin.width;
  let top = origin.y;
  let bottom = origin.y + origin.height;

  if (handle.includes('w')) left = point.x;
  if (handle.includes('e')) right = point.x;
  if (handle.includes('n')) top = point.y;
  if (handle.includes('s')) bottom = point.y;

  if (right - left < MIN_REGION_SIZE) {
    if (handle.includes('w')) left = Math.max(0, right - MIN_REGION_SIZE);
    else right = Math.min(1, left + MIN_REGION_SIZE);
  }
  if (bottom - top < MIN_REGION_SIZE) {
    if (handle.includes('n')) top = Math.max(0, bottom - MIN_REGION_SIZE);
    else bottom = Math.min(1, top + MIN_REGION_SIZE);
  }

  left = clamp(left);
  top = clamp(top);
  right = clamp(Math.max(right, left + MIN_REGION_SIZE), left + MIN_REGION_SIZE, 1);
  bottom = clamp(Math.max(bottom, top + MIN_REGION_SIZE), top + MIN_REGION_SIZE, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export default function WebcamRegionSelector({
  videoUrl,
  startTime = 0,
  initialRegion = null,
  onSave,
  onClose,
  isSaving = false,
  error = '',
}) {
  const stageRef = useRef(null);
  const videoRef = useRef(null);
  const interactionRef = useRef(null);
  const [region, setRegion] = useState(() => normalizeRegion(initialRegion));
  const [contentBox, setContentBox] = useState({ left: 0, top: 0, width: 100, height: 100 });
  const [isInteracting, setIsInteracting] = useState(false);

  useEffect(() => {
    setRegion(normalizeRegion(initialRegion));
  }, [initialRegion]);

  const getPoint = (clientX, clientY) => {
    const contentRect = getRegionContentRect(stageRef.current, videoRef.current);
    if (!contentRect?.width || !contentRect?.height) return { x: 0, y: 0 };
    return {
      x: clamp((clientX - contentRect.left) / contentRect.width),
      y: clamp((clientY - contentRect.top) / contentRect.height),
    };
  };

  const beginInteraction = (event, mode = null, handle = null) => {
    event.preventDefault();
    const point = getPoint(event.clientX, event.clientY);
    const activeMode = mode || (region && point.x >= region.x && point.x <= region.x + region.width && point.y >= region.y && point.y <= region.y + region.height ? 'move' : 'draw');
    interactionRef.current = {
      mode: activeMode,
      handle,
      start: point,
      origin: region,
    };
    setIsInteracting(true);
    if (activeMode === 'draw') setRegion(pointToRegion(point, point));
  };

  useEffect(() => {
    if (!isInteracting) return undefined;

    const handleMove = (event) => {
      const interaction = interactionRef.current;
      if (!interaction) return;
      const point = getPoint(event.clientX, event.clientY);
      if (interaction.mode === 'draw') {
        setRegion(pointToRegion(interaction.start, point));
        return;
      }
      if (interaction.mode === 'move' && interaction.origin) {
        const x = clamp(interaction.origin.x + point.x - interaction.start.x, 0, 1 - interaction.origin.width);
        const y = clamp(interaction.origin.y + point.y - interaction.start.y, 0, 1 - interaction.origin.height);
        setRegion({ ...interaction.origin, x, y });
        return;
      }
      if (interaction.mode === 'resize' && interaction.origin) {
        setRegion(resizeRegion(interaction.origin, point, interaction.handle));
      }
    };
    const stop = () => {
      interactionRef.current = null;
      setIsInteracting(false);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stop);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stop);
    };
  }, [isInteracting, region]);

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (video && Number.isFinite(Number(startTime)) && Number(startTime) >= 0) {
      try {
        video.currentTime = Number(startTime);
      } catch {
        // The preview can still be used if the browser has not made the timeline seekable yet.
      }
    }
    setContentBox(contentBoxAsPercent(stageRef.current, getRegionContentRect(stageRef.current, video)));
  };

  const canSave = Boolean(normalizeRegion(region)) && !isSaving;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-labelledby="webcam-region-title">
      <div className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#121214] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <h2 id="webcam-region-title" className="text-lg font-semibold text-white">Select Webcam Area</h2>
            <p className="mt-1 text-xs text-zinc-400">Draw the webcam box. Face analysis will only search outside it.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close webcam area selector" className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-white/10 hover:text-white">×</button>
        </div>

        <div className="grid min-h-0 gap-5 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div ref={stageRef} data-testid="webcam-region-stage" onPointerDown={(event) => beginInteraction(event)} className="relative aspect-video min-h-[240px] overflow-hidden rounded-xl border border-white/10 bg-black touch-none">
            <video ref={videoRef} data-testid="webcam-region-video" src={videoUrl} className="h-full w-full object-contain" muted playsInline controls preload="metadata" onLoadedMetadata={handleLoadedMetadata} />
            <div className="pointer-events-none absolute" style={{ left: `${contentBox.left}%`, top: `${contentBox.top}%`, width: `${contentBox.width}%`, height: `${contentBox.height}%` }}>
              {region ? (
                <>
                  <div className="absolute inset-x-0 top-0 bg-black/45" style={{ height: `${region.y * 100}%` }} />
                  <div className="absolute inset-x-0 bottom-0 bg-black/45" style={{ height: `${(1 - region.y - region.height) * 100}%` }} />
                  <div className="absolute left-0 bg-black/45" style={{ top: `${region.y * 100}%`, width: `${region.x * 100}%`, height: `${region.height * 100}%` }} />
                  <div className="absolute right-0 bg-black/45" style={{ top: `${region.y * 100}%`, width: `${(1 - region.x - region.width) * 100}%`, height: `${region.height * 100}%` }} />
                  <div
                    data-testid="webcam-region-box"
                    className="pointer-events-auto absolute cursor-move border-2 border-red-500 bg-red-500/10 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
                    style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}
                    onPointerDown={(event) => beginInteraction(event, 'move')}
                  >
                    {['nw', 'ne', 'sw', 'se'].map((handle) => (
                      <button
                        key={handle}
                        type="button"
                        aria-label={`Resize webcam region ${handle === 'nw' ? 'northwest' : handle === 'ne' ? 'northeast' : handle === 'sw' ? 'southwest' : 'southeast'}`}
                        className={`pointer-events-auto absolute h-3 w-3 rounded-sm border border-white bg-red-500 ${handle.includes('n') ? 'top-[-6px]' : 'bottom-[-6px]'} ${handle.includes('w') ? 'left-[-6px]' : 'right-[-6px]'}`}
                        onPointerDown={(event) => { event.stopPropagation(); beginInteraction(event, 'resize', handle); }}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <div className="pointer-events-none absolute inset-0 bg-black/20" />
              )}
              <div className="pointer-events-none absolute inset-0" />
            </div>
            {!region && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium text-white">Drag to draw the webcam area</div>}
          </div>

          <aside className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Detection area</div>
              <p className="mt-2 text-sm leading-6 text-zinc-300">The darkened area is where face and person analysis will run. The red box becomes the facecam source.</p>
            </div>
            {region ? (
              <dl className="grid grid-cols-2 gap-2 text-xs text-zinc-400">
                {Object.entries(region).map(([key, value]) => <div key={key}><dt className="uppercase text-zinc-600">{key}</dt><dd className="font-mono text-zinc-200">{value.toFixed(3)}</dd></div>)}
              </dl>
            ) : <p className="text-xs text-amber-300">Select a rectangle before saving.</p>}
            {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
          </aside>
        </div>

        <div className="flex justify-end gap-3 border-t border-white/10 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-300 hover:bg-white/10">Cancel</button>
          <button type="button" disabled={!canSave} onClick={() => onSave(normalizeRegion(region))} className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{isSaving ? 'Saving…' : 'Save webcam area'}</button>
        </div>
      </div>
    </div>
  );
}
