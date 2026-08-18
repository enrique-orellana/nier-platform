import React from "react";
import { Loader2, RefreshCw, Eye, Sparkles, CheckCircle2 } from "lucide-react";

const progressLabels = {
  queued: "Queued…",
  analyzing: "Analyzing…",
  rendering: "Rendering…",
};

function hasValidRegion(region) {
  if (!region) return false;
  const values = ["x", "y", "width", "height"].map((key) =>
    Number(region[key]),
  );
  if (values.some((value) => !Number.isFinite(value))) return false;
  const [x, y, width, height] = values;
  return (
    x >= 0 &&
    y >= 0 &&
    width > 0 &&
    height > 0 &&
    x + width <= 1 &&
    y + height <= 1
  );
}

function RegionButton({ label, onClick, disabled, saving }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs font-semibold text-zinc-300 transition-all hover:bg-white/10 hover:text-white disabled:opacity-50 active:scale-[0.98]"
    >
      {saving ? (
        <span className="flex items-center justify-center gap-1.5">
          <Loader2 size={12} className="animate-spin text-cyan-400" />
          Saving…
        </span>
      ) : (
        label
      )}
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
        className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs font-semibold text-zinc-300 transition-all hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 flex items-center justify-center gap-1.5"
      >
        <Eye
          size={12}
          className={enabled ? "text-cyan-400" : "text-zinc-500"}
        />
        <span>Preview 9:16</span>
      </button>
      {!enabled && (
        <p className="text-[10px] text-zinc-500 text-center">
          Select Gameplay Area First
        </p>
      )}
    </div>
  );
}

export default function ClipRenderControls({
  status = "found",
  error = "",
  onRender,
  layoutFormat = "standard",
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
  webcamRegionError = "",
  gameplayRegionError = "",
}) {
  if (progressLabels[status]) {
    return (
      <div className="mb-3 flex items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary animate-pulse">
        <Loader2 size={13} className="animate-spin" />
        <span>{progressLabels[status]}</span>
      </div>
    );
  }

  const streamerStack = layoutFormat === "streamer_stack";
  const validWebcamRegion = hasValidRegion(webcamRegion);
  const validGameplayRegion = hasValidRegion(gameplayRegion);
  const hasAllStreamerRegions = validWebcamRegion && validGameplayRegion;

  if (status === "failed" && (!streamerStack || hasAllStreamerRegions)) {
    return (
      <div className="mb-3 space-y-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3">
        <p className="text-xs text-red-300">{error || "Render failed."}</p>
        <button
          type="button"
          onClick={onRender}
          className="flex items-center gap-1.5 rounded-lg border border-red-400/30 bg-red-500/20 px-3 py-1.5 text-xs font-semibold text-red-200 transition-colors hover:bg-red-500/30"
        >
          <RefreshCw size={12} />
          Retry
        </button>
      </div>
    );
  }

  if (streamerStack) {
    const webcamLabel = validWebcamRegion
      ? "Edit Webcam Area"
      : "Select Webcam Area";
    const gameplayLabel = validGameplayRegion
      ? "Edit Gameplay Area"
      : "Select Gameplay Area";
    return (
      <div className="mb-3 space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-2.5">
        {status === "failed" && (
          <p className="text-xs text-amber-200">
            Select both source areas before retrying Streamer Stack analysis.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <RegionButton
            label={webcamLabel}
            onClick={onSelectWebcamRegion}
            disabled={isSavingWebcamRegion}
            saving={isSavingWebcamRegion}
          />
          <RegionButton
            label={gameplayLabel}
            onClick={onSelectGameplayRegion}
            disabled={isSavingGameplayRegion}
            saving={isSavingGameplayRegion}
          />
        </div>
        <PreviewButton
          enabled={validGameplayRegion}
          onClick={onPreviewGameplayRegion}
        />
        {webcamRegionError && (
          <p className="text-xs text-red-300">{webcamRegionError}</p>
        )}
        {gameplayRegionError && (
          <p className="text-xs text-red-300">{gameplayRegionError}</p>
        )}
        <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-zinc-300 cursor-pointer hover:border-white/20 transition-colors">
          <input
            type="checkbox"
            checked={streamerTrackingEnabled === true}
            disabled={trackingSaving}
            onChange={(event) => onTrackingChange?.(event.target.checked)}
            className="rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-400/20"
          />
          <span>Use Face/Person Tracking</span>
        </label>
        <button
          type="button"
          onClick={onRender}
          disabled={!hasAllStreamerRegions}
          className="w-full rounded-xl border border-cyan-500/30 bg-cyan-500/15 hover:bg-cyan-500/25 px-3 py-2 text-xs font-bold text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40 transition-all flex items-center justify-center gap-1.5"
        >
          <Sparkles size={13} />
          {status === "ready" ? "Render from Master" : "Analyze & Render"}
        </button>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="mb-3 space-y-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3">
        <p className="text-xs text-red-300">{error || "Render failed."}</p>
        <button
          type="button"
          onClick={onRender}
          className="flex items-center gap-1.5 rounded-lg border border-red-400/30 bg-red-500/20 px-3 py-1.5 text-xs font-semibold text-red-200 transition-colors hover:bg-red-500/30"
        >
          <RefreshCw size={12} />
          Retry
        </button>
      </div>
    );
  }

  if (status === "ready" && !validGameplayRegion) {
    return (
      <div className="mb-2.5">
        <button
          type="button"
          onClick={onRender}
          className="w-full rounded-xl border border-cyan-500/25 bg-cyan-500/10 hover:bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-300 transition-all flex items-center justify-center gap-1.5 active:scale-[0.99]"
        >
          <Sparkles size={12} />
          <span>Render from Master</span>
        </button>
      </div>
    );
  }

  return (
    <div className="mb-3 space-y-1.5">
      <PreviewButton
        enabled={validGameplayRegion}
        onClick={onPreviewGameplayRegion}
      />
      <button
        type="button"
        onClick={onRender}
        className="w-full rounded-xl border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 px-3 py-2 text-xs font-bold text-cyan-300 transition-all flex items-center justify-center gap-1.5 active:scale-[0.99]"
      >
        <Sparkles size={13} />
        {status === "ready" ? "Render from Master" : "Analyze & Render"}
      </button>
    </div>
  );
}
