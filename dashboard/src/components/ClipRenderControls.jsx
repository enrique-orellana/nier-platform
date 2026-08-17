const progressLabels = {
  queued: 'Queued…',
  analyzing: 'Analyzing…',
  rendering: 'Rendering…',
};

function hasValidRegion(region) {
  if (!region) return false;
  const values = ['x', 'y', 'width', 'height'].map((key) => Number(region[key]));
  if (values.some((value) => !Number.isFinite(value))) return false;
  const [x, y, width, height] = values;
  return x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1 && y + height <= 1;
}

function RegionButton({ label, onClick, disabled, saving }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/10 disabled:opacity-50"
    >
      {saving ? 'Saving…' : label}
    </button>
  );
}

function PreviewButton({ enabled, onClick }) {
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={onClick}
        disabled={!enabled}
        className="w-full rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Preview 9:16
      </button>
      {!enabled && <p className="text-[11px] text-zinc-500">Select Gameplay Area First</p>}
    </div>
  );
}

export default function ClipRenderControls({
  status = 'found',
  error = '',
  onRender,
  layoutFormat = 'standard',
  webcamRegion = null,
  gameplayRegion = null,
  streamerTrackingEnabled = false,
  onTrackingChange,
  onPreviewGameplayRegion,
  onSelectWebcamRegion,
  onSelectGameplayRegion,
  isSavingWebcamRegion = false,
  isSavingGameplayRegion = false,
  trackingSaving = false,
  webcamRegionError = '',
  gameplayRegionError = '',
}) {
  if (progressLabels[status]) {
    return <div className="mb-4 rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary animate-pulse">{progressLabels[status]}</div>;
  }

  const streamerStack = layoutFormat === 'streamer_stack';
  const validWebcamRegion = hasValidRegion(webcamRegion);
  const validGameplayRegion = hasValidRegion(gameplayRegion);
  const hasAllStreamerRegions = validWebcamRegion && validGameplayRegion;

  if (status === 'failed' && (!streamerStack || hasAllStreamerRegions)) {
    return (
      <div className="mb-4 space-y-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3">
        <p className="text-xs text-red-300">{error || 'Render failed.'}</p>
        <button type="button" onClick={onRender} className="rounded-lg border border-red-400/30 px-3 py-1.5 text-xs font-semibold text-red-200 transition-colors hover:bg-red-400/10">Retry</button>
      </div>
    );
  }

  if (streamerStack) {
    const webcamLabel = validWebcamRegion ? 'Edit Webcam Area' : 'Select Webcam Area';
    const gameplayLabel = validGameplayRegion ? 'Edit Gameplay Area' : 'Select Gameplay Area';
    return (
      <div className="mb-4 space-y-2">
        {status === 'failed' && <p className="text-xs text-amber-200">Select both source areas before retrying Streamer Stack analysis.</p>}
        <RegionButton label={webcamLabel} onClick={onSelectWebcamRegion} disabled={isSavingWebcamRegion} saving={isSavingWebcamRegion} />
        <RegionButton label={gameplayLabel} onClick={onSelectGameplayRegion} disabled={isSavingGameplayRegion} saving={isSavingGameplayRegion} />
        <PreviewButton enabled={validGameplayRegion} onClick={onPreviewGameplayRegion} />
        {webcamRegionError && <p className="text-xs text-red-300">{webcamRegionError}</p>}
        {gameplayRegionError && <p className="text-xs text-red-300">{gameplayRegionError}</p>}
        <label className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300">
          <input type="checkbox" checked={streamerTrackingEnabled === true} disabled={trackingSaving} onChange={(event) => onTrackingChange?.(event.target.checked)} />
          <span>Use Face/Person Tracking</span>
        </label>
        <button
          type="button"
          onClick={onRender}
          disabled={!hasAllStreamerRegions}
          className="w-full rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary disabled:cursor-not-allowed disabled:text-primary/50"
        >
          {status === 'ready' ? 'Render from Master' : 'Analyze & Render'}
        </button>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="mb-4 space-y-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3">
        <p className="text-xs text-red-300">{error || 'Render failed.'}</p>
        <button type="button" onClick={onRender} className="rounded-lg border border-red-400/30 px-3 py-1.5 text-xs font-semibold text-red-200 transition-colors hover:bg-red-400/10">Retry</button>
      </div>
    );
  }

  return (
    <div className="mb-4 space-y-2">
      <PreviewButton enabled={validGameplayRegion} onClick={onPreviewGameplayRegion} />
      <button type="button" onClick={onRender} className="w-full rounded-xl border border-primary/30 bg-primary/15 px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/25">{status === 'ready' ? 'Render from Master' : 'Analyze & Render'}</button>
    </div>
  );
}
