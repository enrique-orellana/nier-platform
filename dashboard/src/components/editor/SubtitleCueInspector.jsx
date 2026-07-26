import React from 'react';

export default function SubtitleCueInspector({ cue, tracks = [], activeTrackId, onTrackChange, onChange }) {
    if (!cue) return <div className="text-xs text-zinc-500">Select a subtitle cue on the timeline.</div>;
    const set = (key, value) => onChange({ ...cue, [key]: key === 'startMs' || key === 'endMs' ? Number(value) : value });
    return <div className="space-y-2 text-xs"><label className="block">Subtitle track<select className="mt-1 w-full rounded bg-black/30 p-2" value={activeTrackId || ''} onChange={(e) => onTrackChange?.(e.target.value)}>{tracks.map((track) => <option key={track.id} value={track.id}>{track.label || track.language}</option>)}</select></label><label className="block">Text<textarea className="mt-1 w-full rounded bg-black/30 p-2" rows={3} value={cue.text || ''} onChange={(e) => set('text', e.target.value)} /></label><div className="grid grid-cols-2 gap-2"><label>Start (ms)<input type="number" className="mt-1 w-full rounded bg-black/30 p-2" value={cue.startMs || 0} onChange={(e) => set('startMs', e.target.value)} /></label><label>End (ms)<input type="number" className="mt-1 w-full rounded bg-black/30 p-2" value={cue.endMs || 0} onChange={(e) => set('endMs', e.target.value)} /></label></div></div>;
}

