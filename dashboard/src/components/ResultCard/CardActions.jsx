import React from "react";
import {
  Loader2,
  Wand2,
  Crop,
  Type,
  FileText,
  Languages,
  Share2,
  Download,
  AlertCircle,
  Clock3,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { Button, Card, CardContent, Separator } from "../ui";

export default function CardActions({
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
  setShowClipEditor,
  handleDownload,
  setShowClipRangeEditor,
  hasClipRangeEditor = false,
}) {
  return (
    <div className="mt-auto flex flex-col gap-3">
      <Separator />
      {/* Error Message */}
      {editError && (
        <Card
          role="alert"
          className="border-destructive/30 bg-destructive/5 shadow-none"
        >
          <CardContent className="flex items-center gap-2 p-3 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            <span className="truncate">{editError}</span>
          </CardContent>
        </Card>
      )}

      {/* Primary Action: Timeline Editor */}
      <Button
        variant="secondary"
        size="sm"
        type="button"
        onClick={() => setShowClipEditor(true)}
        className="w-full"
      >
        <Clock3 className="size-4" />
        <span>Edit Timeline</span>
      </Button>

      {/* AI Studio & Enhancement Tools Grid */}
      <div className="grid grid-cols-2 gap-1.5">
        {/* Auto Edit */}
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={handleAutoEdit}
          disabled={isEditing}
          className="min-w-0"
          title="AI Smart Zooms & Edits"
        >
          {isEditing ? (
            <Loader2 className="size-4 shrink-0 animate-spin" />
          ) : (
            <Wand2 className="size-4 shrink-0" />
          )}
          <span className="truncate">
            {isEditing ? "Editing..." : "Auto Edit"}
          </span>
        </Button>

        {/* Adjust Range (or Native Short if range editor not available) */}
        {hasClipRangeEditor && setShowClipRangeEditor ? (
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => setShowClipRangeEditor(true)}
            className="min-w-0"
            title="Adjust clip start/end timestamps"
          >
            <SlidersHorizontal className="size-4 shrink-0" />
            <span className="truncate">Trim Range</span>
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={handleConvertNativeShort}
            disabled={isConvertingNativeShort}
            className="min-w-0"
            title="Render at full native resolution"
          >
            {isConvertingNativeShort ? (
              <Loader2 className="size-4 shrink-0 animate-spin" />
            ) : (
              <Crop className="size-4 shrink-0" />
            )}
            <span className="truncate">
              {isConvertingNativeShort ? "Converting..." : "Native Short"}
            </span>
          </Button>
        )}

        {/* Subtitles (Combined with direct details trigger) */}
        <div className="flex min-w-0 items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => setShowSubtitleModal(true)}
            disabled={isSubtitling}
            className="flex-1 min-w-0 rounded-r-none"
            title="Generate Subtitles"
          >
            {isSubtitling ? (
              <Loader2 className="size-4 shrink-0 animate-spin" />
            ) : (
              <Type className="size-4 shrink-0" />
            )}
            <span className="truncate">
              {isSubtitling ? "Adding..." : "Subtitles"}
            </span>
          </Button>
          <Button
            variant="outline"
            size="icon"
            type="button"
            onClick={() => setShowSubtitleDetails(true)}
            className="rounded-l-none border-l-0"
            title="Subtitle details"
            aria-label="Subtitle details"
          >
            <FileText className="size-4" />
          </Button>
        </div>

        {/* Viral Hook */}
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => setShowHookModal(true)}
          disabled={isHooking}
          className="min-w-0"
          title="Generate 3s Viral Intro Hook"
        >
          {isHooking ? (
            <Loader2 className="size-4 shrink-0 animate-spin" />
          ) : (
            <Sparkles className="size-4 shrink-0" />
          )}
          <span className="truncate">
            {isHooking ? "Adding..." : "Viral Hook"}
          </span>
        </Button>

        {/* Dub Voice */}
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => setShowTranslateModal(true)}
          disabled={isTranslating}
          className="min-w-0"
          title="AI Voice Translation & Dubbing"
        >
          {isTranslating ? (
            <Loader2 className="size-4 shrink-0 animate-spin" />
          ) : (
            <Languages className="size-4 shrink-0" />
          )}
          <span className="truncate">
            {isTranslating ? "Translating..." : "Dub Voice"}
          </span>
        </Button>

        {/* Native Short (if not placed above) */}
        {hasClipRangeEditor && setShowClipRangeEditor && (
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={handleConvertNativeShort}
            disabled={isConvertingNativeShort}
            className="min-w-0"
            title="Convert to Native Short"
          >
            {isConvertingNativeShort ? (
              <Loader2 className="size-4 shrink-0 animate-spin" />
            ) : (
              <Crop className="size-4 shrink-0" />
            )}
            <span className="truncate">
              {isConvertingNativeShort ? "Converting..." : "Native Short"}
            </span>
          </Button>
        )}
      </div>

      {/* Bottom Row: Publish & Download */}
      <div className="flex items-center gap-1.5 pt-1 min-w-0">
        <Button
          variant="default"
          size="sm"
          type="button"
          onClick={() => setShowModal(true)}
          className="flex-1 min-w-0"
        >
          <Share2 className="size-4 shrink-0" />
          <span className="truncate">Post</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={handleDownload}
          className="shrink-0"
          title="Download MP4"
        >
          <Download className="size-4 shrink-0" />
          <span className="truncate">Download</span>
        </Button>
      </div>
    </div>
  );
}
