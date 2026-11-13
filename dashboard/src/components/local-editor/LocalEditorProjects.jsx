import { FolderOpen, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui";

const formatDuration = (durationMs) => {
  const totalSeconds = Math.max(0, Math.round(Number(durationMs || 0) / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
};

const formatUpdatedAt = (updatedAt) => {
  if (!updatedAt) return "Not saved yet";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(updatedAt));
  } catch {
    return "Recently updated";
  }
};

const LocalEditorProjects = ({
  open,
  projects = [],
  activeProjectId = null,
  onClose = () => {},
  onOpen = () => {},
  onRename = () => {},
  onDelete = () => {},
  onNewProject = () => {},
}) => {
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        showClose={false}
        closeOnEscape={false}
        closeOnInteractOutside={false}
        className="block w-[calc(100%-2rem)] max-w-2xl max-h-[min(720px,90vh)] overflow-hidden rounded-2xl border-white/10 bg-[#151518] p-0 text-white"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <DialogTitle className="text-lg font-semibold">
              Saved projects
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs text-white/50">
              Projects stay in this browser.
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            type="button"
            onClick={onClose}
            aria-label="Close projects"
            className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </Button>
        </div>

        <div className="max-h-[55vh] space-y-2 overflow-y-auto p-4">
          {projects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 px-4 py-10 text-center text-sm text-white/50">
              No saved projects yet.
            </div>
          ) : (
            projects.map((project) => {
              const isActive = project.id === activeProjectId;
              return (
                <div
                  key={project.id}
                  className={`rounded-xl border p-4 ${isActive ? "border-cyan-400/50 bg-cyan-400/10" : "border-white/10 bg-white/[0.03]"}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-medium">{project.name}</h3>
                        {isActive && (
                          <span className="rounded-full bg-cyan-400/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-cyan-200">
                            Current
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-xs text-white/50">
                        {project.videoName} ·{" "}
                        {formatDuration(project.durationMs)} ·{" "}
                        {formatUpdatedAt(project.updatedAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() => onOpen(project.id)}
                        aria-label={`Open ${project.name}`}
                        className="inline-flex items-center gap-1 rounded-lg bg-cyan-500/20 px-3 py-2 text-xs font-medium text-cyan-100 hover:bg-cyan-500/30"
                      >
                        <FolderOpen size={14} /> Open
                      </Button>
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() => onRename(project)}
                        aria-label={`Rename ${project.name}`}
                        className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white"
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() => onDelete(project.id)}
                        aria-label={`Delete ${project.name}`}
                        className="rounded-lg p-2 text-red-300/70 hover:bg-red-500/10 hover:text-red-200"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex justify-end border-t border-white/10 px-5 py-4">
          <Button
            variant="ghost"
            type="button"
            onClick={onNewProject}
            className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black hover:bg-white/90"
          >
            <Plus size={16} /> New project
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LocalEditorProjects;
