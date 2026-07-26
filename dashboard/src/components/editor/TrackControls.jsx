import React from 'react';

export default function TrackControls({ track, onChange }) {
    return <div className="flex w-40 shrink-0 items-center gap-1 border-r border-white/10 bg-[#17171b] px-2 text-[10px] text-zinc-300"><span className="min-w-8 font-mono text-cyan-300">{track.name}</span><button type="button" aria-label={`${track.name} mute`} onClick={() => onChange({ ...track, muted: !track.muted })} className={track.muted ? 'text-red-300' : 'text-zinc-500'}>M</button><button type="button" aria-label={`${track.name} lock`} onClick={() => onChange({ ...track, locked: !track.locked })} className={track.locked ? 'text-amber-300' : 'text-zinc-500'}>L</button><button type="button" aria-label={`${track.name} visibility`} onClick={() => onChange({ ...track, visible: track.visible === false })} className={track.visible === false ? 'text-zinc-700' : 'text-zinc-500'}>◉</button></div>;
}

