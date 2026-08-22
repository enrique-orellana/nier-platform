import React from "react";
import { Sliders, X, Film, Copy, Sparkles } from "lucide-react";
import ClipRenderControls from "../ClipRenderControls";
import CardContent from "./CardContent";
import CardActions from "./CardActions";

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
  if (!isOpen) return null;

  const youtubeTitle =
    clip?.video_title_for_youtube_short || clip?.title || `Clip ${index + 1}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-[#121214] border border-white/10 rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden min-w-0">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-2 min-w-0 pr-2">
            <Sliders size={18} className="text-cyan-400 shrink-0" />
            <h2
              className="text-sm font-bold text-white truncate"
              title={youtubeTitle}
            >
              {youtubeTitle} — Actions & Controls
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 p-4 overflow-y-auto space-y-4 text-left">
          {/* Section 1: Layout & Master Render */}
          {onRenderClip && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
                <Film size={14} className="text-cyan-400" />
                <span>Layout & Render Controls</span>
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
            </div>
          )}

          {/* Section 2: Social Copy Hub */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
              <Copy size={14} className="text-cyan-400" />
              <span>Captions & Social Hub</span>
            </div>
            <CardContent clip={clip} masterDuration={masterDuration} />
          </div>

          {/* Section 3: Quick Actions & Editing */}
          {hasVideo && (
            <div className="space-y-2 pt-2 border-t border-white/5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300 mb-1">
                <Sparkles size={14} className="text-cyan-400" />
                <span>Editing & Export Actions</span>
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
