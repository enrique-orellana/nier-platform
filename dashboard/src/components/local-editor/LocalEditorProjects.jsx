import { FolderOpen, Pencil, Plus, Trash2, X } from "lucide-react";

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="presentation"
    >
      <div
        className="max-h-[min(720px,90vh)] w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#151518] text-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-editor-projects-title"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2
              id="local-editor-projects-title"
              className="text-lg font-semibold"
            >
              Saved projects
            </h2>
            <p className="mt-1 text-xs text-white/50">
              Projects stay in this browser.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close projects"
            className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </button>
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
                      <button
                        type="button"
                        onClick={() => onOpen(project.id)}
                        aria-label={`Open ${project.name}`}
                        className="inline-flex items-center gap-1 rounded-lg bg-cyan-500/20 px-3 py-2 text-xs font-medium text-cyan-100 hover:bg-cyan-500/30"
                      >
                        <FolderOpen size={14} /> Open
                      </button>
                      <button
                        type="button"
                        onClick={() => onRename(project)}
                        aria-label={`Rename ${project.name}`}
                        className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(project.id)}
                        aria-label={`Delete ${project.name}`}
                        className="rounded-lg p-2 text-red-300/70 hover:bg-red-500/10 hover:text-red-200"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex justify-end border-t border-white/10 px-5 py-4">
          <button
            type="button"
            onClick={onNewProject}
            className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black hover:bg-white/90"
          >
            <Plus size={16} /> New project
          </button>
        </div>
      </div>
    </div>
  );
};

export default LocalEditorProjects;
