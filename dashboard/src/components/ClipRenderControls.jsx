const progressLabels = {
  queued: 'Queued…',
  analyzing: 'Analyzing…',
  rendering: 'Rendering…',
};

export default function ClipRenderControls({ status = 'found', error = '', onRender }) {
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
