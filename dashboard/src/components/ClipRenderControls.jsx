const progressLabels = {
  queued: 'Queued…',
  analyzing: 'Analyzing…',
  rendering: 'Rendering…',
};

function hasValidWebcamRegion(region) {
  if (!region) return false;
  const values = ['x', 'y', 'width', 'height'].map((key) => Number(region[key]));
  if (values.some((value) => !Number.isFinite(value))) return false;
  const [x, y, width, height] = values;
  return x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1 && y + height <= 1;
}

export default function ClipRenderControls({
  status = 'found',
  error = '',
  onRender,
  layoutFormat = 'standard',
  webcamRegion = null,
  onSelectWebcamRegion,
  isSavingWebcamRegion = false,
  webcamRegionError = '',
}) {
  if (status === 'ready') {
    return (
      <div className="mb-4 rounded-xl border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs font-semibold text-green-300">
        Ready
      </div>
    );
  }

  if (progressLabels[status]) {
    return (
      <div className="mb-4 rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary animate-pulse">
        {progressLabels[status]}
      </div>
    );
  }

  if (status === 'failed') {
    if (layoutFormat === 'streamer_stack' && !hasValidWebcamRegion(webcamRegion)) {
      return (
        <div className="mb-4 space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
          <p className="text-xs text-amber-200">Select the webcam area before retrying Streamer Stack analysis.</p>
          {webcamRegionError && <p className="text-xs text-red-300">{webcamRegionError}</p>}
          <button
            type="button"
            onClick={onSelectWebcamRegion}
            disabled={isSavingWebcamRegion}
            className="w-full rounded-lg border border-amber-400/30 px-3 py-1.5 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-400/10 disabled:opacity-50"
          >
            {isSavingWebcamRegion ? 'Saving…' : 'Select Webcam Area'}
          </button>
        </div>
      );
    }
    return (
      <div className="mb-4 space-y-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3">
        <p className="text-xs text-red-300">{error || 'Render failed.'}</p>
        <button
          type="button"
          onClick={onRender}
          className="rounded-lg border border-red-400/30 px-3 py-1.5 text-xs font-semibold text-red-200 transition-colors hover:bg-red-400/10"
        >
          Retry
        </button>
      </div>
    );
  }

  const streamerStack = layoutFormat === 'streamer_stack';
  const validWebcamRegion = hasValidWebcamRegion(webcamRegion);
  if (streamerStack && !validWebcamRegion) {
    return (
      <div className="mb-4 space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
        <p className="text-xs text-amber-200">Select the webcam area first. Analysis will ignore that selected box.</p>
        {webcamRegionError && <p className="text-xs text-red-300">{webcamRegionError}</p>}
        <button
          type="button"
          onClick={onSelectWebcamRegion}
          disabled={isSavingWebcamRegion}
          className="w-full rounded-lg border border-amber-400/30 px-3 py-1.5 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-400/10 disabled:opacity-50"
        >
          {isSavingWebcamRegion ? 'Saving…' : 'Select Webcam Area'}
        </button>
        <button
          type="button"
          disabled
          className="w-full cursor-not-allowed rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary/50"
        >
          Analyze &amp; Render
        </button>
      </div>
    );
  }

  if (streamerStack && validWebcamRegion) {
    return (
      <div className="mb-4 space-y-2">
        <button
          type="button"
          onClick={onSelectWebcamRegion}
          disabled={isSavingWebcamRegion}
          className="w-full rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          {isSavingWebcamRegion ? 'Saving…' : 'Edit Webcam Area'}
        </button>
        <button
          type="button"
          onClick={onRender}
          className="w-full rounded-xl border border-primary/30 bg-primary/15 px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/25"
        >
          Analyze &amp; Render
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onRender}
      className="mb-4 w-full rounded-xl border border-primary/30 bg-primary/15 px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/25"
    >
      Analyze &amp; Render
    </button>
  );
}
