import React, { useEffect, useState } from "react";
import { Check, Database, RefreshCw, Search } from "lucide-react";
import { getApiUrl } from "../config";

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
      <div className="flex items-center gap-2 text-sm text-zinc-300">
        <Database size={18} className="text-primary" />
        <span>
          MinIO source bucket: <strong className="text-white">{bucket}</strong>
        </span>
      </div>

      <div className="relative">
        <Search
          size={17}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
        />
        <input
          type="search"
          aria-label="Search MinIO objects"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search objects by name or path"
          className="input-field pl-10"
        />
      </div>

      {loading && (
        <p className="text-sm text-zinc-500">Loading MinIO objects...</p>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <p>Could not load MinIO objects: {error}</p>
          <button
            type="button"
            onClick={() => setReloadToken((value) => value + 1)}
            className="mt-3 inline-flex items-center gap-2 text-red-100 underline"
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}

      {!loading && !error && objects.length === 0 && (
        <p className="rounded-xl border border-white/5 bg-white/[0.03] p-4 text-sm text-zinc-500">
          No MinIO objects match this search.
        </p>
      )}

      {!loading && !error && objects.length > 0 && (
        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {objects.map((object) => {
            const isSelected = object.key === selectedKey;
            return (
              <button
                key={object.key}
                type="button"
                aria-label={`Select ${object.name || object.key}`}
                onClick={() => onSelect({ bucket, ...object })}
                className={`w-full rounded-xl border p-3 text-left transition ${isSelected ? "border-primary bg-primary/10" : "border-white/10 bg-white/[0.03] hover:border-primary/50"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 truncate font-medium text-white">
                    {object.name || object.key}
                  </span>
                  {isSelected && (
                    <Check size={17} className="shrink-0 text-primary" />
                  )}
                </div>
                <div className="mt-1 truncate text-xs text-zinc-500">
                  {object.key}
                </div>
                <div className="mt-2 flex gap-3 text-xs text-zinc-600">
                  <span>{formatBytes(object.size)}</span>
                  <span>{formatDate(object.last_modified)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm text-zinc-300">
          Selected:{" "}
          <span className="font-medium text-white">{selected.key}</span>
        </div>
      )}
    </div>
  );
}
