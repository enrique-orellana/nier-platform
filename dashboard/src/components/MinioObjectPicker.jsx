import React, { useEffect, useState } from "react";
import { Check, Database, RefreshCw, Search } from "lucide-react";
import { getApiUrl } from "../config";
import { Badge, Button, Input } from "./ui";

const formatBytes = (value) => {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024)
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const formatDate = (value) => {
  if (!value) return "Unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
};

export default function MinioObjectPicker({ selected, onSelect }) {
  const [search, setSearch] = useState("");
  const [objects, setObjects] = useState([]);
  const [bucket, setBucket] = useState("youtube-downloads");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const query = new URLSearchParams({ search, limit: "50" });
        const response = await fetch(
          getApiUrl(`/api/minio/objects?${query.toString()}`),
          { signal: controller.signal },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(payload.detail || "Could not load MinIO objects.");
        setBucket(payload.bucket || "youtube-downloads");
        setObjects(Array.isArray(payload.objects) ? payload.objects : []);
      } catch (fetchError) {
        if (fetchError.name !== "AbortError") {
          setObjects([]);
          setError(fetchError.message || "Could not load MinIO objects.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [reloadToken, search]);

  const selectedKey = selected?.key || "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 text-muted-foreground">
          <Database className="size-4 text-primary" />
          Source library
        </span>
        <Badge
          variant="outline"
          className="h-6 max-w-[65%] truncate rounded-md border-input bg-background px-2.5 text-xs font-medium text-muted-foreground"
        >
          {bucket}
        </Badge>
      </div>

      <div className="relative">
        <Search
          size={17}
          className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Search MinIO objects"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search objects by name or path"
          className="h-9 rounded-md border-input bg-background py-1 pl-9 shadow-sm focus-visible:ring-1 focus-visible:ring-offset-0"
        />
      </div>

      {loading && (
        <p className="text-sm text-muted-foreground">Loading videos...</p>
      )}

      {!loading && error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <p>Could not load MinIO objects: {error}</p>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setReloadToken((value) => value + 1)}
            className="mt-3 rounded-md text-destructive underline underline-offset-4 hover:bg-destructive/10 hover:text-destructive"
          >
            <RefreshCw size={14} /> Retry
          </Button>
        </div>
      )}

      {!loading && !error && objects.length === 0 && (
        <p className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
          No MinIO objects match this search.
        </p>
      )}

      {!loading && !error && objects.length > 0 && (
        <div className="max-h-72 space-y-2 overflow-x-hidden overflow-y-auto pr-1">
          {objects.map((object) => {
            const isSelected = object.key === selectedKey;
            return (
              <Button
                variant="outline"
                key={object.key}
                type="button"
                aria-label={`${isSelected ? "Deselect" : "Select"} ${object.name || object.key}`}
                aria-pressed={isSelected}
                onClick={() =>
                  onSelect(isSelected ? null : { bucket, ...object })
                }
                className={`h-auto w-full flex-col items-stretch justify-start rounded-md border-input bg-background p-3 text-left shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground ${isSelected ? "border-primary bg-primary/5" : "hover:border-input"}`}
              >
                <div className="flex w-full min-w-0 items-start justify-between gap-3">
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {object.name || object.key}
                  </span>
                  {isSelected && (
                    <Check className="size-4 shrink-0 text-primary" />
                  )}
                </div>
                <div className="mt-1 w-full truncate text-left text-xs text-muted-foreground">
                  {object.key}
                </div>
                <div className="mt-2 flex w-full flex-wrap gap-x-3 gap-y-1 text-left text-xs text-muted-foreground">
                  <span>{formatBytes(object.size)}</span>
                  <span className="truncate">
                    {formatDate(object.last_modified)}
                  </span>
                </div>
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}
