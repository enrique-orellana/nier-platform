import React from "react";
import {
  AlertCircle,
  Crop,
  Download,
  Languages,
  Loader2,
  Share2,
  Type,
  Wand2,
} from "lucide-react";
import { Button } from "../ui";

const actionButton = "w-full min-w-0 justify-center";

export default function EditorActionToolbar({
  onAutoEdit,
  isEditing = false,
  onConvertNativeShort,
  isConvertingNativeShort = false,
  onSubtitles,
  isSubtitling = false,
  onViralHook,
  isHooking = false,
  onDubVoice,
  isTranslating = false,
  onPost,
  onDownload,
  editError,
}) {
  return (
    <div
      className="rounded-lg border border-border bg-card p-4"
      aria-label="Editor actions"
      role="region"
    >
      <h3 className="mb-3 text-sm font-semibold text-foreground">Actions</h3>
      {editError && (
        <div
          className="mb-3 flex items-center gap-2 text-sm text-destructive"
          role="alert"
        >
          <AlertCircle size={13} className="shrink-0" />
          <span className="truncate">{editError}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 max-[420px]:grid-cols-1">
        <Button
          variant="outline"
          type="button"
          onClick={onAutoEdit}
          disabled={isEditing}
          className={actionButton}
        >
          {isEditing ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Wand2 size={14} />
          )}
          {isEditing ? "Editing…" : "Auto Edit"}
        </Button>
        <Button
          variant="outline"
          type="button"
          onClick={onConvertNativeShort}
          disabled={isConvertingNativeShort}
          className={actionButton}
        >
          {isConvertingNativeShort ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Crop size={14} />
          )}
          {isConvertingNativeShort ? "Converting…" : "Convert to Native Short"}
        </Button>
        <Button
          variant="outline"
          type="button"
          onClick={onSubtitles}
          disabled={isSubtitling}
          className={actionButton}
        >
          {isSubtitling ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Type size={14} />
          )}
          {isSubtitling ? "Adding…" : "Subtitles"}
        </Button>
        <Button
          variant="outline"
          type="button"
          onClick={onViralHook}
          disabled={isHooking}
          className={actionButton}
        >
          {isHooking ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Wand2 size={14} />
          )}
          {isHooking ? "Adding…" : "Viral Hook"}
        </Button>
        <Button
          variant="outline"
          type="button"
          onClick={onDubVoice}
          disabled={isTranslating}
          className={actionButton}
        >
          {isTranslating ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Languages size={14} />
          )}
          {isTranslating ? "Translating…" : "Dub Voice"}
        </Button>
        <Button
          variant="secondary"
          type="button"
          onClick={onPost}
          className={actionButton}
        >
          <Share2 size={14} /> Post
        </Button>
        <Button
          variant="outline"
          type="button"
          onClick={onDownload}
          className={actionButton}
        >
          <Download size={14} /> Download
        </Button>
      </div>
    </div>
  );
}
