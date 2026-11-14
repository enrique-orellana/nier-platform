import React from "react";
import { ChevronDown, ExternalLink, Trash2 } from "lucide-react";
import { getApiUrl } from "../../config";
import { Button } from "../ui";

const buildVersionTree = (versions) => {
  const nodes = new Map(
    versions.map((version) => [version.version_id, { version, children: [] }]),
  );
  const roots = [];

  for (const node of nodes.values()) {
    const parent = nodes.get(node.version.parent_version_id);
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
};

const VersionTreeNode = ({
  node,
  depth,
  currentVersionId,
  selectedVersionId,
  onSelect,
  onBranch,
  onDelete,
  getVersionPreviewUrl,
}) => {
  const { version, children } = node;
  const isSelected = selectedVersionId === version.version_id;
  const generatedClipUrl = getVersionPreviewUrl
    ? getVersionPreviewUrl(version.version_id)
    : getApiUrl(version.output_url);
  const hasGeneratedClip = version.status === "done" && generatedClipUrl;

  return (
    <div
      aria-level={depth}
      data-version-node
      role="treeitem"
      className="space-y-2"
    >
      <div
        className={`group flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors hover:border-ring hover:bg-accent ${isSelected ? "border-ring bg-accent" : "border-border bg-background"}`}
      >
        <Button
          variant="ghost"
          type="button"
          className="min-w-0 flex-1 text-left font-semibold drop-shadow-sm"
          onClick={() => onSelect?.(version)}
        >
          <span
            className={
              isSelected ? "text-accent-foreground" : "text-foreground"
            }
          >
            v{version.version_id.slice(0, 6)}
          </span>{" "}
          <span className="text-xs font-medium text-muted-foreground">
            {version.status}
          </span>
          {currentVersionId === version.version_id && (
            <span className="ml-2 inline-flex items-center rounded-md border border-border bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
              current
            </span>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => onBranch?.(version.version_id)}
          type="button"
        >
          Branch
        </Button>
        {hasGeneratedClip && (
          <a
            aria-label={`Open generated clip for version ${version.version_id}`}
            className="flex size-8 shrink-0 items-center justify-center rounded-md border border-input bg-background text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            href={generatedClipUrl}
            rel="noreferrer"
            target="_blank"
            title="Open generated clip"
          >
            <ExternalLink size={14} />
          </a>
        )}
        {onDelete && (
          <Button
            variant="destructive"
            size="icon"
            aria-label={`Delete version ${version.version_id}`}
            className="size-8 shrink-0"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(version.version_id);
            }}
            title="Delete version"
            type="button"
          >
            <Trash2 size={14} />
          </Button>
        )}
      </div>
      {children.length > 0 && (
        <div
          role="group"
          className="ml-3 space-y-2 border-l border-border pl-3"
        >
          {children.map((child) => (
            <VersionTreeNode
              key={child.version.version_id}
              node={child}
              depth={depth + 1}
              currentVersionId={currentVersionId}
              selectedVersionId={selectedVersionId}
              onSelect={onSelect}
              onBranch={onBranch}
              onDelete={onDelete}
              getVersionPreviewUrl={getVersionPreviewUrl}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default function VersionHistory({
  versions = [],
  currentVersionId,
  selectedVersionId,
  onSelect,
  onBranch,
  onDelete,
  getVersionPreviewUrl,
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
          ? "overflow-hidden rounded-lg border border-border bg-card"
          : "space-y-2"
      }
    >
      {showToggle && (
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <Button
            variant="ghost"
            type="button"
            aria-expanded={isOpen}
            className="flex min-w-0 items-center gap-2 text-left"
            onClick={toggleOpen}
          >
            <ChevronDown
              size={15}
              className={`shrink-0 text-muted-foreground transition-transform ${isOpen ? "" : "-rotate-90"}`}
            />
            <span className="truncate text-sm font-semibold text-foreground">
              Version History
            </span>
          </Button>
          <span className="ml-auto flex items-center gap-2">
            {renderCompleteNotice && (
              <span
                data-testid="version-render-ready-badge"
                className="rounded-full border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
              >
                Ready
              </span>
            )}
          </span>
        </div>
      )}

      {isOpen && (
        <div
          role="tree"
          aria-label="Versions"
          className={showToggle ? "space-y-2 px-4 pb-4 pt-3" : "space-y-2"}
        >
          {buildVersionTree(versions).map((node) => (
            <VersionTreeNode
              key={node.version.version_id}
              node={node}
              depth={1}
              currentVersionId={currentVersionId}
              selectedVersionId={selectedVersionId}
              onSelect={onSelect}
              onBranch={onBranch}
              onDelete={onDelete}
              getVersionPreviewUrl={getVersionPreviewUrl}
            />
          ))}
        </div>
      )}
    </section>
  );
}
