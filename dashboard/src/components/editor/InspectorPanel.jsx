import React from 'react';
import { Plus } from 'lucide-react';
import AudioInspector from './AudioInspector';
import HookInspector from './HookInspector';
import SubtitleCueInspector from './SubtitleCueInspector';

const subtitleTracksFromState = (state) => state?.tracks?.filter((track) => track.type === 'subtitle').map((track) => ({ id: track.id.replace(/^subtitles-/, ''), label: track.name, language: track.language })) || [];

export default function InspectorPanel({ selectedItem, editorState, onItemChange, onItemDelete, onTrackChange, activeTrackId, translationPanel = null }) {
    const canAddSubtitleCue = subtitleTracksFromState(editorState).length > 0;
    const addCue = () => window.dispatchEvent(new CustomEvent('openshorts:add-subtitle-cue'));
    const addCueControl = <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-3"><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><Plus size={15} className="text-primary" />Add subtitle cue</div><p className="mb-3 text-[11px] leading-4 text-zinc-400">Starts at the current playhead. Select the cue to edit its text and timing.</p><button type="button" className="btn-primary w-full" onClick={addCue} disabled={!canAddSubtitleCue} aria-label="Add subtitle cue">Add cue</button>{!canAddSubtitleCue && <p className="mt-2 text-[11px] leading-4 text-zinc-500">Create or translate a subtitle track before adding cues.</p>}</div>;
    if (!selectedItem) return <div className="space-y-4">{addCueControl}<div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-4 text-center"><p className="text-sm font-semibold text-zinc-300">Nothing selected</p><p className="mt-1 text-xs leading-5 text-zinc-500">Select a clip or cue in the timeline to edit its properties.</p></div>{translationPanel}</div>;
    if (selectedItem.type === 'hook') {
        const hook = { ...selectedItem, startMs: Math.round(selectedItem.start * 1000), endMs: Math.round(selectedItem.end * 1000) };
        return <div className="space-y-4">{addCueControl}<HookInspector hook={hook} onChange={(next) => onItemChange?.({ ...selectedItem, ...next, start: next.startMs / 1000, end: next.endMs / 1000 })} /></div>;
    }
    if (selectedItem.type === 'subtitle') {
        const cue = { ...selectedItem, startMs: Math.round(selectedItem.start * 1000), endMs: Math.round(selectedItem.end * 1000) };
        return <div className="space-y-4">{addCueControl}<SubtitleCueInspector cue={cue} tracks={subtitleTracksFromState(editorState)} activeTrackId={activeTrackId} onTrackChange={onTrackChange} onChange={(next) => onItemChange?.({ ...selectedItem, ...next, start: next.startMs / 1000, end: next.endMs / 1000 })} onDelete={() => onItemDelete?.(selectedItem) || onItemChange?.({ ...selectedItem, __delete: true })} />{translationPanel}</div>;
    }
    if (selectedItem.type === 'audio') return <div className="space-y-4">{addCueControl}<AudioInspector audio={selectedItem} onChange={onItemChange} /></div>;
    return <div className="space-y-4">{addCueControl}<div className="text-xs text-zinc-500">This item has no editable properties yet.</div></div>;
}
