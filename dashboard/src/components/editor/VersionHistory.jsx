import React from 'react';

export default function VersionHistory({ versions = [], currentVersionId, selectedVersionId, onSelect, onBranch }) {
    return <div className="space-y-1">{versions.map((version) => <div key={version.version_id} className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${selectedVersionId === version.version_id ? 'bg-white/10' : ''}`}><button className="flex-1 text-left" onClick={() => onSelect?.(version)} disabled={version.status === 'failed'}>v{version.version_id.slice(0, 6)} <span className="text-zinc-500">{version.status}</span>{currentVersionId === version.version_id && <span className="ml-1 text-cyan-300">current</span>}</button><button className="text-[10px] text-cyan-300" onClick={() => onBranch?.(version.version_id)}>Branch</button></div>)}</div>;
}

