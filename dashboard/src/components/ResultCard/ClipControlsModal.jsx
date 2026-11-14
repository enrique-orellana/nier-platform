import React from "react";
import { Sliders, X, Film, Copy, Sparkles } from "lucide-react";
import ClipRenderControls from "../ClipRenderControls";
import CardContent from "./CardContent";
import CardActions from "./CardActions";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Separator,
} from "../ui";

export default function ClipControlsModal({
  isOpen,
  onClose,
  clip,
  index,
  masterDuration,
  effectiveRenderStatus,
  renderError,
  onRenderClip,
  handleTrackingChange,
  setShowStandard916Preview,
  setShowWebcamRegionSelector,
  setShowGameplayRegionSelector,
  webcamRegionSaving,
  webcamRegionError,
  gameplayRegionSaving,
  gameplayRegionError,
  trackingError,
  trackingSaving,
  hasVideo,
  handleAutoEdit,
  isEditing,
  handleConvertNativeShort,
  isConvertingNativeShort,
  setShowSubtitleModal,
  setShowSubtitleDetails,
  isSubtitling,
  setShowHookModal,
  isHooking,
  setShowTranslateModal,
  isTranslating,
  setShowModal,
  editError,
  onEditorOpen,
  setShowClipEditor,
  handleDownload,
  setShowClipRangeEditor,
  onSaveClipRange,
}) {
  const youtubeTitle =
    clip?.video_title_for_youtube_short || clip?.title || `Clip ${index + 1}`;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showClose={false}
        closeOnEscape={false}
        closeOnInteractOutside={false}
        className="flex max-h-[90vh] min-w-0 w-[calc(100%-2rem)] max-w-xl flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="flex flex-row items-start justify-between gap-4 border-b p-6 text-left sm:text-left">
          <div className="flex min-w-0 items-start gap-3">
            <Sliders className="mt-1 size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <DialogTitle className="truncate text-lg" title={youtubeTitle}>
                {youtubeTitle} — Actions & Controls
              </DialogTitle>
              <DialogDescription className="mt-1">
                Manage this clip’s layout, captions, edits, and exports.
              </DialogDescription>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={onClose}
            aria-label="Close clip actions"
          >
            <X className="size-4" />
          </Button>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-6 text-left">
          {/* Section 1: Layout & Master Render */}
          {onRenderClip && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Film className="size-4 text-primary" />
                <h3 className="text-sm font-medium">
                  Layout & Render Controls
                </h3>
              </div>
              <ClipRenderControls
                status={effectiveRenderStatus}
                error={renderError || clip?.render_error}
                onRender={() => onRenderClip(index)}
                layoutFormat={clip?.layout_format || "standard"}
                webcamRegion={clip?.webcam_region}
                gameplayRegion={clip?.gameplay_region}
                streamerTrackingEnabled={
                  clip?.streamer_tracking_enabled === true
                }
                onTrackingChange={handleTrackingChange}
                onPreviewGameplayRegion={() => setShowStandard916Preview(true)}
                onSelectWebcamRegion={() => setShowWebcamRegionSelector(true)}
                onSelectGameplayRegion={() =>
                  setShowGameplayRegionSelector(true)
                }
                isSavingWebcamRegion={webcamRegionSaving}
                webcamRegionError={webcamRegionError}
                isSavingGameplayRegion={gameplayRegionSaving}
                gameplayRegionError={gameplayRegionError || trackingError}
                trackingSaving={trackingSaving}
              />
            </section>
          )}

          {/* Section 2: Social Copy Hub */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Copy className="size-4 text-primary" />
              <h3 className="text-sm font-medium">Captions & Social Hub</h3>
            </div>
            <CardContent clip={clip} masterDuration={masterDuration} />
          </section>

          {/* Section 3: Quick Actions & Editing */}
          {hasVideo && (
            <section className="space-y-3">
              <Separator />
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                <h3 className="text-sm font-medium">
                  Editing & Export Actions
                </h3>
              </div>
              <CardActions
                handleAutoEdit={handleAutoEdit}
                isEditing={isEditing}
                handleConvertNativeShort={handleConvertNativeShort}
                isConvertingNativeShort={isConvertingNativeShort}
                setShowSubtitleModal={setShowSubtitleModal}
                setShowSubtitleDetails={setShowSubtitleDetails}
                isSubtitling={isSubtitling}
                setShowHookModal={setShowHookModal}
                isHooking={isHooking}
                setShowTranslateModal={setShowTranslateModal}
                isTranslating={isTranslating}
                setShowModal={setShowModal}
                editError={editError}
                setShowClipEditor={onEditorOpen || setShowClipEditor}
                handleDownload={handleDownload}
                setShowClipRangeEditor={setShowClipRangeEditor}
                hasClipRangeEditor={Boolean(onSaveClipRange)}
              />
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
