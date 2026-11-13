import React from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from "../ui";

export default function LocalEditorSaveProjectDialog({
  open,
  projectNameDraft,
  onChange,
  onSave,
  onClose,
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        showClose={false}
        closeOnEscape={false}
        closeOnInteractOutside={false}
        className="block w-[calc(100%-2rem)] max-w-md rounded-2xl border-white/10 bg-[#17171b] p-5 text-white"
      >
        <DialogTitle className="text-base font-semibold">
          Save project
        </DialogTitle>
        <DialogDescription className="mt-1 text-xs text-zinc-400">
          Choose a name for this browser-local project.
        </DialogDescription>
        <label
          htmlFor="local-editor-project-name"
          className="mt-4 block text-xs font-medium text-zinc-300"
        >
          Project name
        </label>
        <Input
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
          <Button
            variant="ghost"
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-white/5"
          >
            Cancel
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={() => void onSave()}
            disabled={!projectNameDraft.trim()}
            className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save project
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
