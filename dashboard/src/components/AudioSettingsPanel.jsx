import { AlertCircle, CheckCircle2 } from "lucide-react";

import { SUBTITLE_LANGUAGES } from "./subtitleLanguages";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  NativeSelect,
  Separator,
} from "./ui";

export default function AudioSettingsPanel({
  apiKey,
  transcriptionModel,
  setTranscriptionModel,
  transcriptionLanguage,
  setTranscriptionLanguage,
  transcriptionOpenRouterProvider,
  setTranscriptionOpenRouterProvider,
}) {
  const hasApiKey = Boolean(String(apiKey || "").trim());

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>Audio transcription</CardTitle>
            <CardDescription>
              Set the transcription model, source language, and optional route.
            </CardDescription>
          </div>
          <Badge variant={hasApiKey ? "success" : "outline"}>
            {hasApiKey ? "API key configured" : "API key needed"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div
          role="status"
          className={`flex items-start gap-2 text-sm ${
            hasApiKey ? "text-muted-foreground" : "text-amber-400"
          }`}
        >
          {hasApiKey ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
          ) : (
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
          )}
          <span>
            {hasApiKey
              ? "Uses the API key from AI & models."
              : "Add an API key in AI & models to enable remote transcription."}
          </span>
        </div>

        <Separator />

        <div className="grid gap-4 md:grid-cols-2">
          <Label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">
              Transcription model
            </span>
            <Input
              aria-label="Transcription model"
              value={transcriptionModel}
              onChange={(event) => setTranscriptionModel(event.target.value)}
              placeholder="openai/whisper-large-v3"
            />
          </Label>

          <Label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">
              Source language
            </span>
            <NativeSelect
              aria-label="Transcription source language"
              value={transcriptionLanguage}
              onChange={(event) => setTranscriptionLanguage(event.target.value)}
            >
              <option value="auto">Auto-detect</option>
              {Object.entries(SUBTITLE_LANGUAGES).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </NativeSelect>
            <p className="mt-2 text-xs text-muted-foreground">
              Keep Auto-detect unless you know the spoken language.
            </p>
          </Label>

          <Label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">
              OpenRouter provider{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </span>
            <Input
              aria-label="OpenRouter transcription provider"
              value={transcriptionOpenRouterProvider}
              onChange={(event) =>
                setTranscriptionOpenRouterProvider(event.target.value)
              }
              placeholder="deepinfra"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Leave blank to let OpenRouter choose the route.
            </p>
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}
