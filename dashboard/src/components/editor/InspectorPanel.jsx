import React from 'react';
import AudioInspector from './AudioInspector';
import HookInspector from './HookInspector';
import SubtitleCueInspector from './SubtitleCueInspector';

const subtitleTracksFromState = (state) => state?.tracks?.filter((track) => track.type === 'subtitle').map((track) => ({ id: track.id.replace(/^subtitles-/, ''), label: track.name, language: track.language })) || [];

export default function InspectorPanel({ selectedItem, editorState, onItemChange, onTrackChange, activeTrackId, translationPanel = null }) {
    if (!selectedItem) return <div className="space-y-4"><p className="text-xs text-zinc-500">Select a timeline item to edit its properties.</p>{translationPanel}</div>;
    if (selectedItem.type === 'hook') {
        const hook = { ...selectedItem, startMs: Math.round(selectedItem.start * 1000), endMs: Math.round(selectedItem.end * 1000) };
        return <HookInspector hook={hook} onChange={(next) => onItemChange?.({ ...selectedItem, ...next, start: next.startMs / 1000, end: next.endMs / 1000 })} />;
    }
    if (selectedItem.type === 'subtitle') {
        const cue = { ...selectedItem, startMs: Math.round(selectedItem.start * 1000), endMs: Math.round(selectedItem.end * 1000) };
        return <div className="space-y-4"><SubtitleCueInspector cue={cue} tracks={subtitleTracksFromState(editorState)} activeTrackId={activeTrackId} onTrackChange={onTrackChange} onChange={(next) => onItemChange?.({ ...selectedItem, ...next, start: next.startMs / 1000, end: next.endMs / 1000 })} />{translationPanel}</div>;
    }
    if (selectedItem.type === 'audio') return <AudioInspector audio={selectedItem} onChange={onItemChange} />;
    return <div className="text-xs text-zinc-500">This item has no editable properties yet.</div>;
}
