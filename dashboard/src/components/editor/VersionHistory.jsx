import React from "react";
import { Trash2 } from "lucide-react";

export default function VersionHistory({
  versions = [],
  currentVersionId,
  selectedVersionId,
  onSelect,
  onBranch,
  onDelete,
  renderCompleteNotice = false,
  onOpen,
}) {
  const [isOpen, setIsOpen] = React.useState(true);
  const showToggle = renderCompleteNotice || onOpen;

  const toggleOpen = () => {
    const nextIsOpen = !isOpen;
    setIsOpen(nextIsOpen);
    if (nextIsOpen) onOpen?.();
  };

  return (
    <div className={showToggle ? "space-y-3" : "space-y-2"}>
      {showToggle && (
        <button
          type="button"
          aria-expanded={isOpen}
          className="flex w-full items-center justify-between gap-3 text-left text-xs font-bold uppercase tracking-widest text-primary"
          onClick={toggleOpen}
        >
          <span>Version History</span>
          <span className="ml-auto flex items-center gap-2">
            {renderCompleteNotice && (
              <span
                data-testid="version-render-ready-badge"
                className="rounded-full bg-emerald-400/15 px-2 py-1 text-[10px] font-bold normal-case tracking-normal text-emerald-300"
              >
                Ready
              </span>
            )}
            <span aria-hidden="true" className="text-zinc-500">
              {isOpen ? "−" : "+"}
            </span>
          </span>
        </button>
      )}

      {isOpen && (
        <div className="space-y-2">
          {versions.map((version) => (
            <div
              key={version.version_id}
              className={`group flex items-center justify-between gap-3 rounded-xl border border-white/[0.05] px-4 py-3 text-sm transition-colors hover:border-primary/50 hover:bg-primary/10 hover:shadow-glow ${selectedVersionId === version.version_id ? "bg-primary/20 border-primary/50 shadow-[0_0_15px_rgba(14,165,233,0.3)]" : "bg-surfaceLight/50"}`}
            >
              <button
                className="flex-1 text-left font-semibold drop-shadow-sm"
                onClick={() => onSelect?.(version)}
                disabled={version.status === "failed"}
              >
                <span
                  className={
                    selectedVersionId === version.version_id
                      ? "text-primary"
                      : "text-white"
                  }
                >
                  v{version.version_id.slice(0, 6)}
                </span>{" "}
                <span className="text-xs font-bold text-zinc-500">
                  {version.status}
                </span>
                {currentVersionId === version.version_id && (
                  <span className="ml-2 rounded-full border border-primary/30 bg-primary/20 px-2 py-0.5 text-[10px] text-primary">
                    current
                  </span>
                )}
              </button>
              <button
                className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-bold text-primary opacity-0 shadow-sm transition-opacity hover:bg-primary hover:text-white group-hover:opacity-100"
                onClick={() => onBranch?.(version.version_id)}
                type="button"
              >
                Branch
              </button>
              {onDelete && (
                <button
                  aria-label={`Delete version ${version.version_id}`}
                  className="rounded-lg bg-white/5 p-1.5 text-zinc-400 opacity-0 transition-opacity hover:bg-red-500/20 hover:text-red-300 group-hover:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(version.version_id);
                  }}
                  title="Delete version"
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
