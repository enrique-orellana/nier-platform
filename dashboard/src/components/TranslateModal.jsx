import React, { useState } from "react";
import { X, Loader2, Globe, Languages, AlertCircle } from "lucide-react";
import { useRenewableMediaUrl } from "../lib/videoUrls";
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  NativeSelect,
} from "./ui";

const LANGUAGES = {
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  pl: "Polish",
  hi: "Hindi",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  ar: "Arabic",
  ru: "Russian",
  tr: "Turkish",
  nl: "Dutch",
  sv: "Swedish",
  id: "Indonesian",
  fil: "Filipino",
  ms: "Malay",
  vi: "Vietnamese",
  th: "Thai",
  uk: "Ukrainian",
  el: "Greek",
  cs: "Czech",
  fi: "Finnish",
  ro: "Romanian",
  da: "Danish",
  bg: "Bulgarian",
  hr: "Croatian",
  sk: "Slovak",
  ta: "Tamil",
  en: "English",
};

export default function TranslateModal({
  isOpen,
  onClose,
  onTranslate,
  isProcessing,
  videoUrl,
  hasApiKey,
}) {
  const [targetLanguage, setTargetLanguage] = useState("es");
  const { url: resolvedVideoUrl, refresh: refreshVideoUrl } =
    useRenewableMediaUrl(videoUrl);

  if (!isOpen) return null;

  const handleSubmit = () => {
    console.log(
      "[TranslateModal] handleSubmit called, targetLanguage:",
      targetLanguage,
    );
    onTranslate({ targetLanguage });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose?.()}>
      <DialogContent
        showClose={false}
        closeOnEscape={false}
        closeOnInteractOutside={false}
        className="z-[100] max-w-md"
      >
        <Button
          variant="ghost"
          size="icon"
          type="button"
          onClick={onClose}
          disabled={isProcessing}
          className="absolute right-4 top-4"
          aria-label="Close voice dubbing"
        >
          <X className="size-4" />
        </Button>

        <DialogHeader className="mb-6 pr-8">
          <DialogTitle className="flex items-center gap-3">
            <Languages className="size-5 text-primary" />
            Dub Voice
          </DialogTitle>
          <DialogDescription>
            AI voice translation by ElevenLabs
          </DialogDescription>
        </DialogHeader>

        {!hasApiKey && (
          <div
            role="status"
            className="mb-4 flex items-start gap-2 rounded-md border p-3 text-sm text-muted-foreground"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <p>Configure ElevenLabs API Key in Settings first.</p>
          </div>
        )}

        {/* Preview */}
        <div className="relative mb-6 aspect-video overflow-hidden rounded-md border bg-black">
          <video
            src={resolvedVideoUrl}
            onError={() => void refreshVideoUrl()}
            className="w-full h-full object-contain"
            muted
            playsInline
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
        </div>

        {/* Language Selection */}
        <div className="mb-6">
          <Label className="mb-2 flex items-center gap-2">
            <Globe className="size-4" />
            Target Language
          </Label>
          <NativeSelect
            value={targetLanguage}
            onChange={(e) => setTargetLanguage(e.target.value)}
            className="w-full"
            disabled={isProcessing}
          >
            {Object.entries(LANGUAGES)
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
          </NativeSelect>
        </div>

        {/* Info */}
        <Card className="mb-6 shadow-none">
          <CardContent className="p-3 text-sm text-muted-foreground">
            The audio will be dubbed with AI-generated voice in the selected
            language, matching the original speaker's characteristics.
          </CardContent>
        </Card>

        {/* Processing State */}
        {isProcessing && (
          <Card className="mb-4 shadow-none">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Loader2 className="size-5 animate-spin text-primary" />
                <div>
                  <p className="text-sm font-medium">Dubbing audio...</p>
                  <p className="text-sm text-muted-foreground">
                    This may take a few minutes
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isProcessing}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={handleSubmit}
            disabled={isProcessing || !hasApiKey}
            className="flex-1"
          >
            {isProcessing ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Dubbing...
              </>
            ) : (
              <>
                <Languages className="size-4" />
                Dub Voice
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
