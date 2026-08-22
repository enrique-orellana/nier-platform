import React, { useRef, useState } from "react";
import { Upload } from "lucide-react";

export default function LocalEditorUploadState({ onFile, error }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const chooseFile = (file) => file && onFile(file);
  return (
    <div className="mx-auto flex min-h-[65vh] max-w-2xl items-center justify-center p-6">
      <div
        className={`w-full rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${dragging ? "border-fuchsia-400 bg-fuchsia-500/10" : "border-white/15 bg-white/[.03] hover:border-white/30"}`}
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
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          aria-label="Upload video"
          className="hidden"
          onChange={(event) => chooseFile(event.target.files?.[0])}
        />
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-fuchsia-500/15 text-fuchsia-300">
          <Upload size={26} />
        </div>
        <h2 className="text-xl font-semibold text-white">
          Upload a video to start editing
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-400">
          Your video stays in your browser. Nothing is uploaded to OpenShorts
          while you edit locally.
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-6 rounded-xl bg-fuchsia-500 px-5 py-3 text-sm font-semibold text-white hover:bg-fuchsia-400"
        >
          Choose local video
        </button>
        <p className="mt-4 text-xs text-zinc-600">
          Drag and drop a playable MP4, WebM, or MOV file
        </p>
        {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
      </div>
    </div>
  );
}
