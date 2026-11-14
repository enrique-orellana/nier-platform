import React, { useState } from "react";
import {
  X,
  Sparkles,
  Loader2,
  Maximize,
  MoveVertical,
  Zap,
} from "lucide-react";
import RemotionPreview from "./RemotionPreview";
import { useRenewableMediaUrl } from "../lib/videoUrls";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from "./ui";

const ENTRANCE_OPTIONS = [
  { value: "spring", label: "Bounce" },
  { value: "fade", label: "Fade" },
  { value: "slide-up", label: "Slide Up" },
  { value: "none", label: "None" },
];

export default function HookModal({
  isOpen,
  onClose,
  onGenerate,
  isProcessing,
  videoUrl,
  videoStartSeconds = 0,
  initialText,
  durationInSeconds,
  existingSubtitles,
  layoutFormat = "standard",
  facecamSize = "medium",
}) {
  const [text, setText] = useState(
    initialText || "POV: You are using the viral hook feature",
  );
  const [position, setPosition] = useState("top");
  const [size, setSize] = useState("M");
  const [entranceAnimation, setEntranceAnimation] = useState("spring");
  const [displayDuration, setDisplayDuration] = useState(5);
  const { url: resolvedVideoUrl, refresh: refreshVideoUrl } =
    useRenewableMediaUrl(videoUrl);

  if (!isOpen) return null;

  // Build hook config for Remotion preview
  const hookConfig = {
    text: text || "Enter your text...",
    position,
    size,
    entranceAnimation,
    displayDurationSec: displayDuration,
    layoutFormat,
    facecamSize,
  };

  const useRemotionPreview = !!videoUrl;

  // Fallback preview logic (same as original)
  const getPositionClass = () => {
    switch (position) {
      case "center":
        return "items-center justify-center";
      case "bottom":
        return "items-center justify-end pb-[20%]";
      case "top":
      default:
        return "items-center justify-start pt-[20%]";
    }
  };

  const getSizeStyle = () => {
    switch (size) {
      case "S":
        return { fontSize: "14px", maxWidth: "80%" };
      case "L":
        return { fontSize: "24px", maxWidth: "95%" };
      case "M":
      default:
        return { fontSize: "18px", maxWidth: "90%" };
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose?.()}>
      <DialogContent
        showClose={false}
        closeOnEscape={false}
        closeOnInteractOutside={false}
        className="z-[100] flex max-h-[90vh] w-[calc(100%-2rem)] max-w-4xl flex-col gap-6 overflow-y-auto md:flex-row"
      >
        <Button
          variant="ghost"
          size="icon"
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10"
          aria-label="Close viral hook editor"
        >
          <X className="size-4" />
        </Button>

        {/* Left: Preview */}
        <div className="relative flex max-h-[600px] flex-1 flex-col items-center justify-center overflow-hidden rounded-md border bg-black aspect-[9/16]">
          {useRemotionPreview ? (
            <RemotionPreview
              videoUrl={resolvedVideoUrl}
              videoStartSeconds={videoStartSeconds}
              durationInSeconds={durationInSeconds || 30}
              hook={hookConfig}
              subtitles={existingSubtitles || null}
            />
          ) : (
            <>
              <video
                src={resolvedVideoUrl}
                onError={() => void refreshVideoUrl()}
                className="w-full h-full object-contain opacity-50"
                muted
                playsInline
              />
              <div
                className={`absolute w-full px-8 text-center transition-all duration-300 pointer-events-none flex flex-col h-full ${getPositionClass()}`}
              >
                <div
                  className="text-black font-bold px-3 py-2 rounded-xl shadow-2xl text-center whitespace-pre-wrap transition-all duration-200"
                  style={{
                    ...getSizeStyle(),
                    backgroundColor: "rgba(255, 255, 255, 0.82)",
                    fontFamily: "Noto Serif, serif",
                    boxShadow: "0 4px 15px rgba(0,0,0,0.5)",
                    paddingTop: "10px",
                    paddingBottom: "10px",
                    paddingLeft: "12px",
                    paddingRight: "12px",
                  }}
                >
                  {text || "Enter your text..."}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right: Controls */}
        <div className="flex w-full flex-col md:w-80">
          <DialogHeader className="mb-6">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Sparkles className="size-5 text-primary" /> Viral Hook
            </DialogTitle>
            <DialogDescription>
              Add a short animated line over the opening of this clip.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-5 overflow-y-auto pr-2">
            {/* Text Input */}
            <div>
              <Label htmlFor="viral-hook-text" className="mb-2 block">
                Text
              </Label>
              <Textarea
                id="viral-hook-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                className="w-full resize-none font-serif"
                placeholder="Enter text that will stop the scroll..."
              />
            </div>

            {/* Position Control */}
            <div>
              <Label className="mb-2 flex items-center gap-2">
                <MoveVertical className="size-4" /> Position
              </Label>
              <div className="grid grid-cols-3 gap-2">
                {["top", "center", "bottom"].map((pos) => (
                  <Button
                    variant={position === pos ? "secondary" : "outline"}
                    key={pos}
                    onClick={() => setPosition(pos)}
                    size="sm"
                    className="w-full capitalize"
                  >
                    {pos}
                  </Button>
                ))}
              </div>
            </div>

            {/* Size Control */}
            <div>
              <Label className="mb-2 flex items-center gap-2">
                <Maximize className="size-4" /> Size
              </Label>
              <div className="grid grid-cols-3 gap-2">
                {["S", "M", "L"].map((sz) => (
                  <Button
                    variant={size === sz ? "secondary" : "outline"}
                    key={sz}
                    onClick={() => setSize(sz)}
                    size="sm"
                    className="w-full"
                  >
                    {sz === "S" ? "Small" : sz === "M" ? "Medium" : "Large"}
                  </Button>
                ))}
              </div>
            </div>

            {/* Entrance Animation (new) */}
            <div>
              <Label className="mb-2 flex items-center gap-2">
                <Zap className="size-4" /> Entrance
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {ENTRANCE_OPTIONS.map((opt) => (
                  <Button
                    variant={
                      entranceAnimation === opt.value ? "secondary" : "outline"
                    }
                    key={opt.value}
                    onClick={() => setEntranceAnimation(opt.value)}
                    size="sm"
                    className="w-full"
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Display Duration (new) */}
            <div>
              <Label className="mb-2 block">Duration: {displayDuration}s</Label>
              <Input
                type="range"
                min="2"
                max="15"
                value={displayDuration}
                onChange={(e) => setDisplayDuration(parseInt(e.target.value))}
                className="h-2 w-full cursor-pointer accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>2s</span>
                <span>15s</span>
              </div>
            </div>

            <div className="rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">
              <strong>Tip:</strong> Keep it short and punchy. Using "POV:" or
              specific questions works best for retention.
            </div>
          </div>

          <Button
            variant="default"
            onClick={() =>
              onGenerate({
                text,
                position,
                size,
                // Remotion data
                remotion: hookConfig,
              })
            }
            disabled={isProcessing || !text.trim()}
            className="mt-4 w-full shrink-0"
          >
            {isProcessing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {isProcessing ? "Generating..." : "Add Hook"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
