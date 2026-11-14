import React, { useState, useEffect } from "react";
import { X, Type, Loader2 } from "lucide-react";
import { getApiUrl } from "../config";
import RemotionPreview from "./RemotionPreview";
import { toClipGeneratorSubtitleStyle } from "./local-editor/localEditorStyles";
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
  NativeSelect,
  Switch,
  Textarea,
} from "./ui";

const FONT_OPTIONS = [
  { value: "Verdana", label: "Verdana" },
  { value: "Arial", label: "Arial" },
  { value: "Impact", label: "Impact" },
  { value: "Helvetica", label: "Helvetica" },
  { value: "Georgia", label: "Georgia" },
  { value: "Courier New", label: "Courier New" },
];

const COLOR_PRESETS = [
  { color: "#FFFFFF", label: "White" },
  { color: "#FFFF00", label: "Yellow" },
  { color: "#00FFFF", label: "Cyan" },
  { color: "#00FF00", label: "Green" },
  { color: "#FF0000", label: "Red" },
  { color: "#FF69B4", label: "Pink" },
];

const ANIMATION_OPTIONS = [
  { value: "pop", label: "Pop" },
  { value: "word-highlight", label: "Glow" },
  { value: "karaoke", label: "Karaoke" },
  { value: "none", label: "None" },
];

export default function SubtitleModal({
  isOpen,
  onClose,
  onGenerate,
  isProcessing,
  videoUrl,
  videoStartSeconds = 0,
  jobId,
  clipIndex,
  existingHook,
}) {
  const [position, setPosition] = useState("bottom");
  const [fontSize] = useState(24);
  const [fontName, setFontName] = useState("Verdana");
  const [fontColor, setFontColor] = useState("#FFFFFF");
  const [highlightColor, setHighlightColor] = useState("#FFDD00");
  const [borderColor, setBorderColor] = useState("#000000");
  const [borderWidth, setBorderWidth] = useState(2);
  const [bgColor, setBgColor] = useState("#000000");
  const [bgOpacity, setBgOpacity] = useState(0.0);
  const [animation, setAnimation] = useState("pop");
  const [showTextEditor, setShowTextEditor] = useState(false);

  // Remotion preview state
  const [captions, setCaptions] = useState([]);
  const [originalCaptions, setOriginalCaptions] = useState([]);
  const [editableText, setEditableText] = useState("");
  const [durationSec, setDurationSec] = useState(30);
  const [captionsLoading, setCaptionsLoading] = useState(false);
  const [useRemotionPreview, setUseRemotionPreview] = useState(false);
  const { url: resolvedVideoUrl, refresh: refreshVideoUrl } =
    useRenewableMediaUrl(videoUrl);

  // Fetch word-level captions when modal opens
  useEffect(() => {
    if (!isOpen || !jobId || clipIndex === undefined) return;

    setCaptionsLoading(true);
    fetch(getApiUrl(`/api/clip/${jobId}/${clipIndex}/transcript`))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.captions && data.captions.length > 0) {
          setCaptions(data.captions);
          setOriginalCaptions(data.captions);
          setEditableText(data.captions.map((c) => c.text).join(" "));
          setDurationSec(data.durationSec || 30);
          setUseRemotionPreview(true);
        } else {
          setUseRemotionPreview(false);
        }
      })
      .catch(() => setUseRemotionPreview(false))
      .finally(() => setCaptionsLoading(false));
  }, [isOpen, jobId, clipIndex]);

  // When user edits text, redistribute words across original timestamps
  const handleTextEdit = (newText) => {
    setEditableText(newText);
    const newWords = newText.split(/\s+/).filter((w) => w.length > 0);
    if (newWords.length === 0 || originalCaptions.length === 0) {
      setCaptions([]);
      return;
    }

    // Distribute new words across the time span of original captions
    const totalDurationMs =
      originalCaptions[originalCaptions.length - 1].endMs -
      originalCaptions[0].startMs;
    const startMs = originalCaptions[0].startMs;
    const wordDurationMs = totalDurationMs / newWords.length;

    const newCaptions = newWords.map((word, i) => ({
      text: word,
      startMs: Math.round(startMs + i * wordDurationMs),
      endMs: Math.round(startMs + (i + 1) * wordDurationMs),
    }));
    setCaptions(newCaptions);
  };

  if (!isOpen) return null;

  // Build subtitle config for Remotion
  const subtitleConfig = {
    captions,
    position,
    style: toClipGeneratorSubtitleStyle({
      fontFamily: fontName,
      fontSize,
      fontColor,
      highlightColor,
      borderColor,
      borderWidth,
      bgColor,
      bgOpacity,
      animation,
    }),
  };

  // Fallback: static CSS preview (same as original)
  const bw = Math.max(borderWidth, 0);
  const bc = borderColor;
  const outlineShadow =
    bw > 0
      ? [
          `-${bw}px -${bw}px 0 ${bc}`,
          `${bw}px -${bw}px 0 ${bc}`,
          `-${bw}px ${bw}px 0 ${bc}`,
          `${bw}px ${bw}px 0 ${bc}`,
          `0 -${bw}px 0 ${bc}`,
          `0 ${bw}px 0 ${bc}`,
          `-${bw}px 0 0 ${bc}`,
          `${bw}px 0 0 ${bc}`,
        ].join(", ")
      : "none";

  const fallbackPreviewStyle = {
    fontFamily: fontName,
    color: fontColor,
    fontSize: "20px",
    fontWeight: "bold",
    maxWidth: "85%",
    padding: "6px 12px",
    borderRadius: "4px",
    textAlign: "center",
    lineHeight: "1.3",
    ...(bgOpacity > 0
      ? {
          backgroundColor: `${bgColor}${Math.round(bgOpacity * 255)
            .toString(16)
            .padStart(2, "0")}`,
          textShadow: "none",
        }
      : { textShadow: outlineShadow }),
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose?.()}>
      <DialogContent
        showClose={false}
        closeOnEscape={false}
        closeOnInteractOutside={false}
        className="z-[100] flex max-h-[90vh] w-[calc(100%-2rem)] max-w-5xl flex-col gap-6 overflow-y-auto md:flex-row"
      >
        <Button
          variant="ghost"
          size="icon"
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10"
          aria-label="Close subtitle editor"
        >
          <X className="size-4" />
        </Button>

        {/* Left: Preview */}
        <div className="relative flex max-h-[600px] flex-1 flex-col items-center justify-center overflow-hidden rounded-md border bg-black aspect-[9/16]">
          {captionsLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span className="text-sm">Loading preview...</span>
            </div>
          ) : useRemotionPreview ? (
            <RemotionPreview
              videoUrl={resolvedVideoUrl}
              videoStartSeconds={videoStartSeconds}
              durationInSeconds={durationSec}
              subtitles={subtitleConfig}
              hook={existingHook || null}
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
                className={`absolute w-full px-8 text-center transition-all duration-300 pointer-events-none flex flex-col items-center justify-center
                                ${position === "top" ? "top-20" : ""}
                                ${position === "middle" ? "top-0 bottom-0" : ""}
                                ${position === "bottom" ? "bottom-20" : ""}
                            `}
              >
                <span style={fallbackPreviewStyle}>
                  This is how your subtitles
                  <br />
                  will appear on the video
                </span>
              </div>
            </>
          )}
        </div>

        {/* Right: Controls */}
        <div className="flex w-full flex-col md:w-80">
          <DialogHeader className="mb-4">
            <DialogTitle className="flex shrink-0 items-center gap-2 text-xl">
              <Type className="size-5 text-primary" /> Auto Subtitles
            </DialogTitle>
            <DialogDescription>
              Choose how captions appear, then generate them for this clip.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-5 overflow-y-auto pr-1">
            {/* Position Selector */}
            <div>
              <Label className="mb-2 block">Position</Label>
              <div className="grid grid-cols-3 gap-2">
                {["top", "middle", "bottom"].map((pos) => (
                  <Button
                    variant={position === pos ? "secondary" : "outline"}
                    key={pos}
                    onClick={() => setPosition(pos)}
                    size="sm"
                    className="w-full"
                  >
                    {pos.charAt(0).toUpperCase() + pos.slice(1)}
                  </Button>
                ))}
              </div>
            </div>

            {/* Animation Style (new) */}
            <div>
              <Label className="mb-2 block">Animation</Label>
              <div className="grid grid-cols-2 gap-2">
                {ANIMATION_OPTIONS.map((opt) => (
                  <Button
                    variant={animation === opt.value ? "secondary" : "outline"}
                    key={opt.value}
                    onClick={() => setAnimation(opt.value)}
                    size="sm"
                    className="w-full"
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Editable Transcript (collapsible) */}
            {useRemotionPreview && (
              <div>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => setShowTextEditor(!showTextEditor)}
                  className="mb-2 h-auto w-full justify-between px-0 text-muted-foreground"
                >
                  <span>Edit Text ({captions.length} words)</span>
                  <span
                    className={`transition-transform ${showTextEditor ? "rotate-180" : ""}`}
                  >
                    ▾
                  </span>
                </Button>
                {showTextEditor && (
                  <Textarea
                    value={editableText}
                    onChange={(e) => handleTextEdit(e.target.value)}
                    rows={5}
                    className="w-full resize-none leading-relaxed"
                    placeholder="Edit subtitle text..."
                  />
                )}
              </div>
            )}

            {/* Font Family */}
            <div>
              <Label className="mb-2 block">Font</Label>
              <NativeSelect
                value={fontName}
                onChange={(e) => setFontName(e.target.value)}
                className="w-full"
              >
                {FONT_OPTIONS.map((f) => (
                  <option
                    key={f.value}
                    value={f.value}
                    style={{ fontFamily: f.value }}
                  >
                    {f.label}
                  </option>
                ))}
              </NativeSelect>
            </div>

            {/* Text Color */}
            <div>
              <Label className="mb-2 block">Text Color</Label>
              <div className="flex flex-wrap gap-2">
                {COLOR_PRESETS.map((c) => (
                  <Button
                    variant="outline"
                    key={c.color}
                    onClick={() => setFontColor(c.color)}
                    size="icon"
                    aria-pressed={fontColor === c.color}
                    className={`size-7 rounded-full p-0 ${fontColor === c.color ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : ""}`}
                    style={{ backgroundColor: c.color }}
                    title={c.label}
                  />
                ))}
                <label
                  className="relative flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed"
                  title="Custom color"
                >
                  <span className="text-xs text-muted-foreground">+</span>
                  <Input
                    type="color"
                    value={fontColor}
                    onChange={(e) => setFontColor(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </label>
              </div>
            </div>

            {/* Highlight Color (new) */}
            <div>
              <Label className="mb-2 block">Highlight Color</Label>
              <div className="flex flex-wrap gap-2">
                {[
                  { color: "#FFDD00", label: "Gold" },
                  { color: "#FF4444", label: "Red" },
                  { color: "#00FF88", label: "Green" },
                  { color: "#00BBFF", label: "Blue" },
                  { color: "#FF69B4", label: "Pink" },
                ].map((c) => (
                  <Button
                    variant="outline"
                    key={c.color}
                    onClick={() => setHighlightColor(c.color)}
                    size="icon"
                    aria-pressed={highlightColor === c.color}
                    className={`size-7 rounded-full p-0 ${highlightColor === c.color ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : ""}`}
                    style={{ backgroundColor: c.color }}
                    title={c.label}
                  />
                ))}
              </div>
            </div>

            {/* Border / Outline */}
            <div>
              <Label className="mb-2 block">Border</Label>
              <div className="flex items-center gap-3">
                <label
                  className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-md border"
                  title="Border color"
                >
                  <div
                    className="w-full h-full"
                    style={{ backgroundColor: borderColor }}
                  />
                  <Input
                    type="color"
                    value={borderColor}
                    onChange={(e) => setBorderColor(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </label>
                <div className="flex-1">
                  <Input
                    type="range"
                    min="0"
                    max="5"
                    value={borderWidth}
                    onChange={(e) => setBorderWidth(parseInt(e.target.value))}
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>None</span>
                    <span>Thick</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Background Box */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label htmlFor="subtitle-background-box">Background Box</Label>
                <Switch
                  id="subtitle-background-box"
                  checked={bgOpacity > 0}
                  onCheckedChange={(checked) => setBgOpacity(checked ? 0.5 : 0)}
                />
              </div>
              {bgOpacity > 0 && (
                <div className="space-y-3 animate-[fadeIn_0.2s_ease-out]">
                  <div className="flex items-center gap-3">
                    <label
                      className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-md border"
                      title="Background color"
                    >
                      <div
                        className="w-full h-full"
                        style={{ backgroundColor: bgColor }}
                      />
                      <Input
                        type="color"
                        value={bgColor}
                        onChange={(e) => setBgColor(e.target.value)}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                      />
                    </label>
                    <div className="flex-1">
                      <Input
                        type="range"
                        min="10"
                        max="100"
                        value={Math.round(bgOpacity * 100)}
                        onChange={(e) =>
                          setBgOpacity(parseInt(e.target.value) / 100)
                        }
                        className="w-full accent-primary"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Transparent</span>
                        <span>{Math.round(bgOpacity * 100)}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <Button
            variant="default"
            onClick={() =>
              onGenerate({
                position,
                fontSize,
                fontName,
                fontColor,
                borderColor,
                borderWidth,
                bgColor,
                bgOpacity,
                // Remotion data
                remotion: useRemotionPreview ? subtitleConfig : null,
              })
            }
            disabled={isProcessing}
            className="mt-4 w-full shrink-0"
          >
            {isProcessing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Type className="size-4" />
            )}
            {isProcessing ? "Generating..." : "Generate Subtitles"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
