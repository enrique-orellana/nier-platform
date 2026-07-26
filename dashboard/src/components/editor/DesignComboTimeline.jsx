import React, { useEffect, useRef } from 'react';
import StateManager from '@designcombo/state';
import { moveCue, resizeCue } from '../../editor/timelineModel';
import TrackControls from './TrackControls';

const colors = { video: '#2563eb', audio: '#16a34a', hook: '#f59e0b', subtitle: '#8b5cf6', effects: '#ec4899' };

const toDesignComboState = (editorState) => {
    const trackItemsMap = {};
    const trackItemIds = [];
    const tracks = editorState.tracks.map((track, index) => ({
        id: track.id,
        type: track.type === 'audio' ? 'audio' : 'video',
        items: track.items.map((item) => {
            trackItemIds.push(item.id);
            trackItemsMap[item.id] = {
                id: item.id,
                name: item.label || item.text || track.name,
                type: track.type === 'subtitle' ? 'caption' : track.type,
                display: { from: Math.round(item.start * editorState.fps), to: Math.round(item.end * editorState.fps) },
                duration: Math.max(1, Math.round((item.end - item.start) * editorState.fps)),
                metadata: { openShortsTrackId: track.id },
            };
            return item.id;
        }),
        muted: Boolean(track.muted),
        metadata: { openShortsTrackId: track.id, visible: track.visible !== false, locked: Boolean(track.locked) },
        index,
    }));
    return {
        fps: editorState.fps,
        duration: editorState.durationFrames,
        tracks,
        trackItemIds,
        trackItemsMap,
        transitionIds: [],
        transitionsMap: {},
        activeIds: [],
        structure: [],
        size: { width: 1080, height: 1920 },
        background: { type: 'color', value: '#000000' },
        scale: { unit: 100, zoom: 1, segments: 5, index: 0 },
    };
};

export default function DesignComboTimeline({ state, onStateChange, onSelectItem, playheadFrame = 0, onSeek, zoom = 1 }) {
    const timelineRef = useRef(null);
    const stateManagerRef = useRef(null);
    const duration = Math.max(0.001, state.durationSec || 1);
    const width = `${Math.max(1, zoom * 100)}%`;
    useEffect(() => {
        if (!stateManagerRef.current) {
            stateManagerRef.current = new StateManager(toDesignComboState(state));
        } else {
            stateManagerRef.current.updateState(toDesignComboState(state));
        }
        return () => {
            stateManagerRef.current?.destroyListeners?.();
        };
    }, [state]);
    const emitStateChange = (nextState) => {
        stateManagerRef.current?.updateState(toDesignComboState(nextState));
        onStateChange?.(nextState);
    };
    const changeTrack = (track) => emitStateChange({ ...state, tracks: state.tracks.map((item) => item.id === track.id ? track : item) });
    const beginDrag = (event, track, item, edge = 'move') => {
        if (track.locked) return;
        event.preventDefault(); event.stopPropagation();
        const originX = event.clientX;
        const original = { startMs: item.start * 1000, endMs: item.end * 1000 };
        const rectWidth = timelineRef.current?.getBoundingClientRect().width || 1000;
        const update = (moveEvent) => {
            const deltaMs = ((moveEvent.clientX - originX) / rectWidth) * duration * 1000;
            const next = edge === 'move' ? moveCue(original, deltaMs, duration * 1000) : resizeCue(original, edge, deltaMs, duration * 1000, 1000 / (state.fps || 30));
            const nextItem = { ...item, start: next.startMs / 1000, end: next.endMs / 1000 };
            const tracks = state.tracks.map((candidate) => candidate.id === track.id ? { ...candidate, items: candidate.items.map((candidateItem) => candidateItem.id === item.id ? nextItem : candidateItem) } : candidate);
            emitStateChange({ ...state, tracks });
        };
        const stop = () => { window.removeEventListener('pointermove', update); window.removeEventListener('pointerup', stop); };
        window.addEventListener('pointermove', update); window.addEventListener('pointerup', stop);
    };
    const playheadLeft = `${Math.max(0, Math.min(duration, playheadFrame / (state.fps || 30))) / duration * 100}%`;
    return <div className="h-full overflow-auto rounded-lg border border-white/10 bg-[#101014]" ref={timelineRef}>
        <div className="flex min-w-[760px] flex-col" style={{ width }}>
            <div className="relative ml-40 h-8 border-b border-white/10 bg-[#151519]" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onSeek?.(Math.max(0, Math.min(duration, ((event.clientX - rect.left) / rect.width) * duration))); }}><div className="absolute top-0 bottom-0 w-px bg-red-400" style={{ left: playheadLeft }} /></div>
            {state.tracks.map((track) => <div key={track.id} className="flex h-14 border-b border-white/10"><TrackControls track={track} onChange={changeTrack} /><div className="relative flex-1 bg-[#111115]">{track.items.map((item) => <div key={item.id} role="button" tabIndex={0} aria-label={`${item.label || item.text || track.name} clip`} onClick={() => onSelectItem?.(item, track)} onPointerDown={(event) => beginDrag(event, track, item)} className="absolute top-2 bottom-2 overflow-hidden rounded border border-white/20 px-2 py-2 text-[10px] text-white shadow" style={{ left: `${(item.start / duration) * 100}%`, width: `${Math.max(0.5, ((item.end - item.start) / duration) * 100)}%`, minWidth: 28, backgroundColor: colors[track.type] || '#52525b', opacity: track.visible === false ? 0.35 : 1 }}><span className="truncate">{item.label || item.text || track.name}</span><span role="button" tabIndex={0} aria-label={`${item.label || item.text || track.name} resize start`} onPointerDown={(event) => beginDrag(event, track, item, 'start')} className="absolute left-0 top-0 h-full w-1 cursor-ew-resize opacity-0 hover:opacity-100" /><span role="button" tabIndex={0} aria-label={`${item.label || item.text || track.name} resize end`} onPointerDown={(event) => beginDrag(event, track, item, 'end')} className="absolute right-0 top-0 h-full w-1 cursor-ew-resize opacity-0 hover:opacity-100" /></div>)}</div></div>)}
        </div>
    </div>;
}
