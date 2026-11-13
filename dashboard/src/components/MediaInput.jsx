import React, { useState } from "react";
import { Database, FileVideo, Loader2, Upload, X } from "lucide-react";
import MinioObjectPicker from "./MinioObjectPicker";
import { SUBTITLE_LANGUAGES } from "./subtitleLanguages";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "./ui";

export default function MediaInput({
  onProcess,
  isProcessing,
  targetClipCount,
  onTargetClipCountChange,
  defaultTranscriptionLanguage = "auto",
}) {
  const [mode, setMode] = useState("minio"); // 'minio' | 'file'
  const [selectedObject, setSelectedObject] = useState(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [file, setFile] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [layoutFormat, setLayoutFormat] = useState("standard");
  const [facecamSize, setFacecamSize] = useState("medium");
  const [transcriptionLanguage, setTranscriptionLanguage] = useState(
    defaultTranscriptionLanguage || "auto",
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!acknowledged) return;
    if (mode === "minio" && selectedObject) {
      onProcess({
        type: "minio-object",
        payload: { bucket: selectedObject.bucket, key: selectedObject.key },
        sourceUrl: sourceUrl.trim(),
        acknowledged: true,
        layoutFormat,
        facecamSize,
        transcriptionLanguage,
      });
    } else if (mode === "file" && file) {
      onProcess({
        type: "file",
        payload: file,
        sourceUrl: sourceUrl.trim(),
        acknowledged: true,
        layoutFormat,
        facecamSize,
        transcriptionLanguage,
      });
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setMode("file");
    }
  };

  return (
    <Card className="w-full overflow-hidden rounded-lg border-border bg-card shadow-sm">
      <Tabs value={mode} onValueChange={setMode}>
        <CardHeader className="gap-4 border-b border-border p-5 md:flex-row md:items-center md:justify-between md:p-6">
          <div className="space-y-1.5">
            <CardTitle className="text-xl">Start with a video</CardTitle>
            <CardDescription>
              Choose a source, then set up the clips you want to create.
            </CardDescription>
          </div>
          <TabsList className="w-full md:w-[280px]">
            <TabsTrigger
              value="minio"
              className="min-w-0 flex-1 justify-center gap-2 px-4"
            >
              <Database className="size-4" />
              Video library
            </TabsTrigger>
            <TabsTrigger
              value="file"
              className="min-w-0 flex-1 justify-center gap-2 px-4"
            >
              <Upload className="size-4" />
              Upload
            </TabsTrigger>
          </TabsList>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6 p-5 md:p-6">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
              <section className="min-w-0 space-y-3 lg:border-r lg:border-border lg:pr-6">
                <div className="flex min-h-6 items-center justify-between gap-3">
                  <Label className="text-sm">Video source</Label>
                  {mode === "minio" && selectedObject && (
                    <Badge
                      variant="success"
                      className="rounded-md px-2 py-1 text-[11px] font-medium"
                    >
                      Selected
                    </Badge>
                  )}
                  {mode === "file" && file && (
                    <Badge
                      variant="success"
                      className="rounded-md px-2 py-1 text-[11px] font-medium"
                    >
                      Ready to upload
                    </Badge>
                  )}
                </div>

                <TabsContent value="minio" className="mt-0">
                  <MinioObjectPicker
                    selected={selectedObject}
                    onSelect={setSelectedObject}
                  />
                </TabsContent>
                <TabsContent value="file" className="mt-0">
                  <div
                    className={`flex min-h-52 items-center justify-center rounded-md border border-dashed p-6 text-center transition-colors ${
                      file
                        ? "border-primary/50 bg-primary/5"
                        : "border-input bg-muted/30 hover:border-primary/50 hover:bg-muted/50"
                    }`}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={handleDrop}
                  >
                    {file ? (
                      <div className="flex max-w-full items-center gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <FileVideo className="size-5" />
                        </span>
                        <span className="min-w-0 text-left">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {file.name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Video selected
                          </span>
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          type="button"
                          onClick={() => setFile(null)}
                          aria-label="Remove selected video"
                          className="ml-1 shrink-0"
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    ) : (
                      <label
                        htmlFor="video-upload"
                        className="flex cursor-pointer flex-col items-center"
                      >
                        <Input
                          id="video-upload"
                          type="file"
                          accept="video/*"
                          onChange={(event) =>
                            setFile(event.target.files?.[0] || null)
                          }
                          className="sr-only"
                        />
                        <span className="mb-4 flex size-10 items-center justify-center rounded-md border border-border bg-background text-primary">
                          <Upload className="size-5" />
                        </span>
                        <span className="text-sm font-medium text-foreground">
                          Drop a video here or browse files
                        </span>
                        <span className="mt-1 text-xs text-muted-foreground">
                          MP4 or MOV, up to 500 MB
                        </span>
                      </label>
                    )}
                  </div>
                </TabsContent>
              </section>

              <section className="min-w-0 space-y-5">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="original-source-url">
                      Original source URL
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      Optional
                    </span>
                  </div>
                  <Input
                    id="original-source-url"
                    type="url"
                    value={sourceUrl}
                    onChange={(event) => setSourceUrl(event.target.value)}
                    placeholder="YouTube or Twitch link"
                    className="h-9 rounded-md border-input bg-background px-3 py-1 shadow-sm focus-visible:ring-1 focus-visible:ring-offset-0"
                  />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Adds context for clip titles and descriptions; the selected
                    video remains the source for processing.
                  </p>
                </div>

                <Separator />

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="transcription-source-language">
                      Spoken language
                    </Label>
                    <Select
                      value={transcriptionLanguage}
                      onValueChange={setTranscriptionLanguage}
                    >
                      <SelectTrigger
                        id="transcription-source-language"
                        aria-label="Transcription source language"
                        className="h-9 rounded-md border-input bg-background px-3 py-1 shadow-sm focus:ring-1 focus:ring-offset-0"
                      >
                        <SelectValue placeholder="Auto-detect" />
                      </SelectTrigger>
                      <SelectContent className="rounded-md border-border bg-popover shadow-md">
                        <SelectItem value="auto">Auto-detect</SelectItem>
                        {Object.entries(SUBTITLE_LANGUAGES).map(
                          ([code, label]) => (
                            <SelectItem key={code} value={code}>
                              {label}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="target-clips">Number of clips</Label>
                    <Select
                      value={String(targetClipCount)}
                      onValueChange={(value) =>
                        onTargetClipCountChange(Number(value))
                      }
                    >
                      <SelectTrigger
                        id="target-clips"
                        className="h-9 rounded-md border-input bg-background px-3 py-1 shadow-sm focus:ring-1 focus:ring-offset-0"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-md border-border bg-popover shadow-md">
                        {Array.from(
                          { length: 13 },
                          (_, index) => index + 3,
                        ).map((count) => (
                          <SelectItem key={count} value={String(count)}>
                            {count} clips
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="video-format">Output layout</Label>
                    <Select
                      value={layoutFormat}
                      onValueChange={setLayoutFormat}
                    >
                      <SelectTrigger
                        id="video-format"
                        className="h-9 rounded-md border-input bg-background px-3 py-1 shadow-sm focus:ring-1 focus:ring-offset-0"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-md border-border bg-popover shadow-md">
                        <SelectItem value="standard">
                          Vertical · 9:16
                        </SelectItem>
                        <SelectItem value="streamer_stack">
                          Streamer stack
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {layoutFormat === "streamer_stack" && (
                      <div className="space-y-2 pt-2">
                        <Label htmlFor="facecam-size">Facecam size</Label>
                        <Select
                          value={facecamSize}
                          onValueChange={setFacecamSize}
                        >
                          <SelectTrigger
                            id="facecam-size"
                            className="h-9 rounded-md border-input bg-background px-3 py-1 shadow-sm focus:ring-1 focus:ring-offset-0"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-md border-border bg-popover shadow-md">
                            <SelectItem value="small">Small</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="large">Large</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Clip count is a target; longer videos can return fewer if they
                  do not contain enough strong moments.
                </p>
              </section>
            </div>

            <Separator />

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="rights-acknowledgement"
                  checked={acknowledged}
                  onCheckedChange={setAcknowledged}
                  className="mt-0.5"
                />
                <Label
                  htmlFor="rights-acknowledgement"
                  className="max-w-2xl cursor-pointer text-xs font-normal leading-relaxed text-muted-foreground"
                >
                  I confirm I own this content or have the rights to process it.
                  I am responsible for any content I submit. See our{" "}
                  <a
                    href="/#legal"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-primary underline underline-offset-4"
                    onClick={(event) => event.stopPropagation()}
                  >
                    Terms &amp; Privacy
                  </a>
                  .
                </Label>
              </div>

              <Button
                variant="default"
                size="lg"
                type="submit"
                disabled={
                  isProcessing ||
                  !acknowledged ||
                  (mode === "minio" && !selectedObject) ||
                  (mode === "file" && !file)
                }
                className="h-9 w-full rounded-md px-4 shadow-sm sm:w-auto"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Processing video...
                  </>
                ) : (
                  "Generate clips"
                )}
              </Button>
            </div>
          </CardContent>
        </form>
      </Tabs>
    </Card>
  );
}
