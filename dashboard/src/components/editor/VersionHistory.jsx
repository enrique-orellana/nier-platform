import React from "react";
import { ChevronDown, Trash2 } from "lucide-react";

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
    <section
      aria-label={showToggle ? "Version history" : undefined}
      className={
        showToggle
          ? "overflow-hidden rounded-xl border border-white/10 bg-white/[.02]"
          : "space-y-2"
      }
    >
      {showToggle && (
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3.5">
          <button
            type="button"
            aria-expanded={isOpen}
            className="flex min-w-0 items-center gap-2 text-left"
            onClick={toggleOpen}
          >
            <ChevronDown
              size={15}
              className={`shrink-0 text-violet-300 transition-transform ${isOpen ? "" : "-rotate-90"}`}
            />
            <span className="truncate text-sm font-semibold text-white">
              Version History
            </span>
          </button>
          <span className="ml-auto flex items-center gap-2">
            {renderCompleteNotice && (
              <span
                data-testid="version-render-ready-badge"
                className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300"
              >
                Ready
              </span>
            )}
          </span>
        </div>
      )}

      {isOpen && (
        <div className={showToggle ? "space-y-2 px-4 pb-4 pt-3" : "space-y-2"}>
          {versions.map((version) => (
            <div
              key={version.version_id}
              className={`group flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:border-primary/50 hover:bg-primary/10 ${selectedVersionId === version.version_id ? "border-primary/50 bg-primary/10 shadow-[0_0_15px_rgba(14,165,233,0.2)]" : "border-white/10 bg-black/20"}`}
            >
              <button
                type="button"
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
                className="flex h-7 shrink-0 items-center rounded-md border border-primary/20 bg-primary/5 px-2.5 text-xs font-semibold text-primary transition-colors hover:border-primary/50 hover:bg-primary/15 hover:text-white"
                onClick={() => onBranch?.(version.version_id)}
                type="button"
              >
                Branch
              </button>
              {onDelete && (
                <button
                  aria-label={`Delete version ${version.version_id}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[.03] text-zinc-400 transition-colors hover:border-red-400/30 hover:bg-red-500/15 hover:text-red-300"
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
    </section>
  );
}
