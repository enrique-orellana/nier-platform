import React from "react";
import { Loader2, RefreshCw, Eye, Sparkles, CheckCircle2 } from "lucide-react";
import { Button, Card, CardContent, Checkbox } from "./ui";

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
    <Button
      variant="outline"
      size="sm"
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full"
    >
      {saving ? (
        <span className="flex items-center justify-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          Saving…
        </span>
      ) : (
        label
      )}
    </Button>
  );
}

function PreviewButton({ enabled, onClick }) {
  return (
    <div className="space-y-1">
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={onClick}
        disabled={!enabled}
        className="w-full"
      >
        <Eye className="size-4" />
        <span>Preview 9:16</span>
      </Button>
      {!enabled && (
        <p className="text-center text-xs text-muted-foreground">
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
      <Card className="mb-3 border-primary/30 bg-primary/5 shadow-none">
        <CardContent
          className="flex items-center justify-center gap-2 p-3 text-sm text-primary"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="size-4 animate-spin" />
          <span>{progressLabels[status]}</span>
        </CardContent>
      </Card>
    );
  }

  const streamerStack = layoutFormat === "streamer_stack";
  const validWebcamRegion = hasValidRegion(webcamRegion);
  const validGameplayRegion = hasValidRegion(gameplayRegion);
  const hasAllStreamerRegions = validWebcamRegion && validGameplayRegion;

  if (status === "failed" && !streamerStack) {
    return (
      <Card className="mb-3 border-destructive/30 bg-destructive/5 shadow-none">
        <CardContent className="space-y-3 p-3">
          <p role="alert" className="text-sm text-destructive">
            {error || "Render failed."}
          </p>
          <Button variant="outline" size="sm" type="button" onClick={onRender}>
            <RefreshCw className="size-4" /> Retry
          </Button>
        </CardContent>
      </Card>
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
      <Card className="mb-3 shadow-none">
        <CardContent className="space-y-3 p-3">
          {status === "failed" && (
            <div className="space-y-1.5 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p role="alert" className="text-sm text-destructive">
                {error || "Render failed."}
              </p>
              <p className="text-sm text-muted-foreground">
                Select both source areas before retrying Streamer Stack
                analysis.
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
            <p role="alert" className="text-sm text-destructive">
              {webcamRegionError}
            </p>
          )}
          {gameplayRegionError && (
            <p role="alert" className="text-sm text-destructive">
              {gameplayRegionError}
            </p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={streamerTrackingEnabled === true}
              disabled={trackingSaving}
              onCheckedChange={(checked) =>
                onTrackingChange?.(checked === true)
              }
            />
            <span>Use Face/Person Tracking</span>
          </label>
          <Button
            variant="default"
            size="sm"
            type="button"
            onClick={onRender}
            disabled={!hasAllStreamerRegions}
            className="w-full"
          >
            <Sparkles className="size-4" />
            {status === "ready" ? "Render from Master" : "Analyze & Render"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (status === "failed") {
    return (
      <Card className="mb-3 border-destructive/30 bg-destructive/5 shadow-none">
        <CardContent className="space-y-3 p-3">
          <p role="alert" className="text-sm text-destructive">
            {error || "Render failed."}
          </p>
          <Button variant="outline" size="sm" type="button" onClick={onRender}>
            <RefreshCw className="size-4" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (status === "ready" && !validGameplayRegion) {
    return (
      <div className="mb-2.5">
        <Button
          variant="default"
          size="sm"
          type="button"
          onClick={onRender}
          className="w-full"
        >
          <Sparkles className="size-4" />
          <span>Render from Master</span>
        </Button>
      </div>
    );
  }

  return (
    <div className="mb-3 space-y-1.5">
      <PreviewButton
        enabled={validGameplayRegion}
        onClick={onPreviewGameplayRegion}
      />
      <Button
        variant="default"
        size="sm"
        type="button"
        onClick={onRender}
        className="w-full"
      >
        <Sparkles className="size-4" />
        {status === "ready" ? "Render from Master" : "Analyze & Render"}
      </Button>
    </div>
  );
}
