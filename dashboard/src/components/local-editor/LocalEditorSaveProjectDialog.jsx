import React from "react";

export default function LocalEditorSaveProjectDialog({
  open,
  projectNameDraft,
  onChange,
  onSave,
  onClose,
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-project-dialog-title"
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#17171b] p-5 text-white shadow-2xl"
      >
        <h2 id="save-project-dialog-title" className="text-base font-semibold">
          Save project
        </h2>
        <p className="mt-1 text-xs text-zinc-400">
          Choose a name for this browser-local project.
        </p>
        <label
          htmlFor="local-editor-project-name"
          className="mt-4 block text-xs font-medium text-zinc-300"
        >
          Project name
        </label>
        <input
          id="local-editor-project-name"
          value={projectNameDraft}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void onSave();
          }}
          autoFocus
          className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={!projectNameDraft.trim()}
            className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save project
          </button>
        </div>
      </div>
    </div>
  );
}
