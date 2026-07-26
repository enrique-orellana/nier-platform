import React from 'react';

const versionLabel = (version) => `v${String(version.version_id || '').slice(0, 8)}`;

export default function MediaPool({ sourceUrl, versions = [], tracks = [], onSelectVersion, onSelectTrack }) {
    return <div className="space-y-4 text-xs">
        <section aria-label="Source media">
            <h3 className="mb-2 font-semibold text-zinc-300">Source media</h3>
            <div className="rounded-lg border border-white/10 bg-white/[.03] p-3">
                <div className="font-medium text-white">Original video</div>
                <div className="mt-1 truncate text-[10px] text-zinc-500">{sourceUrl || 'No source loaded'}</div>
            </div>
        </section>
        <section aria-label="Rendered versions">
            <h3 className="mb-2 font-semibold text-zinc-300">Rendered versions</h3>
            <div className="space-y-1">
                {versions.length ? versions.map((version) => <button key={version.version_id} type="button" className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/[.03] px-3 py-2 text-left hover:bg-white/[.08]" onClick={() => onSelectVersion?.(version)}>
                    <span className="font-medium text-white">{versionLabel(version)}</span><span className="text-[10px] text-zinc-500">{version.status || 'draft'}</span>
                </button>) : <p className="text-zinc-600">No rendered versions yet.</p>}
            </div>
        </section>
        <section aria-label="Subtitle tracks">
            <h3 className="mb-2 font-semibold text-zinc-300">Subtitle tracks</h3>
            <div className="space-y-1">
                {tracks.length ? tracks.map((track) => <button key={track.id} type="button" className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/[.03] px-3 py-2 text-left hover:bg-white/[.08]" onClick={() => onSelectTrack?.(track.id)}>
                    <span className="font-medium text-white">{track.label || track.language || track.id}</span><span className="text-[10px] text-zinc-500">{track.language || ''}</span>
                </button>) : <p className="text-zinc-600">No subtitle tracks.</p>}
            </div>
        </section>
    </div>;
}
