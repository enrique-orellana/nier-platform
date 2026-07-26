import React from 'react';
import TimelineCue from './TimelineCue';

export default function TimelineTrack({ label, cues = [], durationMs, selectedCueId, onSelectCue, onChangeCue, color }) {
    return <div className="flex items-stretch min-h-11 border-b border-white/10">
        <div className="w-36 shrink-0 px-3 py-3 text-[11px] text-zinc-300 bg-white/[.03]">{label}</div>
        <div className="relative flex-1 bg-black/20">
            {cues.map((cue, index) => <TimelineCue key={cue.id || index} cue={cue} durationMs={durationMs} selected={selectedCueId === (cue.id || index)} onSelect={() => onSelectCue?.(cue, index)} onChange={(next) => onChangeCue?.(next, index)} color={color} />)}
        </div>
    </div>;
}

