import React, { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button, Card, CardContent, Input } from "../ui";

export default function LocalEditorUploadState({ onFile, error }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const chooseFile = (file) => file && onFile(file);
  return (
    <div className="mx-auto flex min-h-[65vh] w-full max-w-3xl items-center justify-center p-5 md:p-8">
      <Card
        className={`w-full border-2 border-dashed shadow-none transition-colors ${dragging ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          chooseFile(event.dataTransfer.files?.[0]);
        }}
      >
        <CardContent className="flex flex-col items-center p-8 text-center sm:p-12">
          <Input
            ref={inputRef}
            type="file"
            accept="video/*"
            aria-label="Upload video"
            className="hidden"
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />
          <div className="mb-5 flex size-14 items-center justify-center rounded-md border bg-muted text-primary">
            <Upload className="size-6" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            Upload a video to start editing
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Your video stays in your browser. Nothing is uploaded to OpenShorts
            while you edit locally.
          </p>
          <Button
            variant="default"
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-6"
          >
            Choose local video
          </Button>
          <p className="mt-4 text-xs text-muted-foreground">
            Drag and drop a playable MP4, WebM, or MOV file
          </p>
          {error && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
