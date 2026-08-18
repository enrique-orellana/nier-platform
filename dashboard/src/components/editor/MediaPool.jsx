import React from "react";

const versionLabel = (version) =>
  `v${String(version.version_id || "").slice(0, 8)}`;

export default function MediaPool({
  sourceUrl,
  versions = [],
  tracks = [],
  onSelectVersion,
  onSelectTrack,
}) {
  return (
    <div className="space-y-6 text-sm">
      <section aria-label="Source media">
        <h3 className="mb-3 font-bold tracking-widest text-zinc-400 uppercase text-xs">
          Source media
        </h3>
        <div className="rounded-xl border border-white/[0.05] bg-surfaceLight/50 p-4 shadow-sm transition-colors hover:bg-surfaceLight hover:shadow-glow hover:border-primary/30">
          <div className="font-semibold text-white drop-shadow-sm">
            Original video
          </div>
          <div className="mt-1.5 truncate text-xs text-zinc-500 font-medium">
            {sourceUrl || "No source loaded"}
          </div>
        </div>
      </section>
      <section aria-label="Rendered versions">
        <h3 className="mb-3 font-bold tracking-widest text-zinc-400 uppercase text-xs">
          Rendered versions
        </h3>
        <div className="space-y-2">
          {versions.length ? (
            versions.map((version) => (
              <button
                key={version.version_id}
                type="button"
                className="group flex w-full items-center justify-between rounded-xl border border-white/[0.05] bg-surfaceLight/50 px-4 py-3 text-left transition-colors hover:bg-primary/10 hover:border-primary/50 hover:shadow-glow"
                onClick={() => onSelectVersion?.(version)}
              >
                <span className="font-semibold text-white drop-shadow-sm group-hover:text-primary">
                  {versionLabel(version)}
                </span>
                <span className="text-xs font-bold text-zinc-500 group-hover:text-primary/70">
                  {version.status || "draft"}
                </span>
              </button>
            ))
          ) : (
            <p className="text-sm font-medium text-zinc-600">
              No rendered versions yet.
            </p>
          )}
        </div>
      </section>
      <section aria-label="Subtitle tracks">
        <h3 className="mb-3 font-bold tracking-widest text-zinc-400 uppercase text-xs">
          Subtitle tracks
        </h3>
        <div className="space-y-2">
          {tracks.length ? (
            tracks.map((track) => (
              <button
                key={track.id}
                type="button"
                className="group flex w-full items-center justify-between rounded-xl border border-white/[0.05] bg-surfaceLight/50 px-4 py-3 text-left transition-colors hover:bg-accent/10 hover:border-accent/50 hover:shadow-[0_0_20px_rgba(168,85,247,0.3)]"
                onClick={() => onSelectTrack?.(track.id)}
              >
                <span className="font-semibold text-white drop-shadow-sm group-hover:text-accent-100">
                  {track.label || track.language || track.id}
                </span>
                <span className="text-xs font-bold text-zinc-500 group-hover:text-accent/70">
                  {track.language || ""}
                </span>
              </button>
            ))
          ) : (
            <p className="text-sm font-medium text-zinc-600">
              No subtitle tracks.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
