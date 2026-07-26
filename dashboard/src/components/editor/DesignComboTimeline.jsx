import React, { useEffect, useRef, useState } from 'react';
import StateManager from '@designcombo/state';
import { moveCue, resizeCue } from '../../editor/timelineModel';
import TrackControls from './TrackControls';

const colors = { video: '#2563eb', audio: '#16a34a', hook: '#f59e0b', subtitle: '#8b5cf6', effects: '#ec4899' };
const TRACK_CONTROLS_WIDTH = 160;
const BASE_PIXELS_PER_SECOND = 80;

const formatTimecode = (seconds, fps) => {
    const frame = Math.max(0, Math.round(seconds * fps));
    const totalSeconds = Math.floor(frame / fps);
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    const frames = frame % fps;
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
};

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
    const [editingItemId, setEditingItemId] = useState(null);
    const [draftText, setDraftText] = useState('');
    const duration = Math.max(0.001, state.durationSec || 1);
    const pixelsPerSecond = BASE_PIXELS_PER_SECOND * Math.max(0.25, zoom);
    const laneWidth = Math.max(1, duration * pixelsPerSecond);
    const canvasWidth = Math.max(760, TRACK_CONTROLS_WIDTH + laneWidth);
    useEffect(() => {
        const container = timelineRef.current;
        if (!container?.clientWidth) return;
        const playheadX = TRACK_CONTROLS_WIDTH + (Math.max(0, Math.min(duration, playheadFrame / (state.fps || 30))) * pixelsPerSecond);
        const visibleStart = container.scrollLeft + TRACK_CONTROLS_WIDTH;
        const visibleEnd = container.scrollLeft + container.clientWidth - 24;
        if (playheadX < visibleStart || playheadX > visibleEnd) {
            container.scrollLeft = Math.max(0, playheadX - container.clientWidth * 0.5);
        }
    }, [duration, pixelsPerSecond, playheadFrame, state.fps]);
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
    const beginInlineEdit = (event, item) => {
        if (item.type !== 'subtitle') return;
        event.preventDefault(); event.stopPropagation();
        setEditingItemId(item.id); setDraftText(item.text || item.label || '');
    };
    const commitInlineEdit = (item) => {
        if (editingItemId !== item.id) return;
        const text = draftText.trim();
        const nextText = text || item.text || item.label || '';
        const nextItem = { ...item, text: nextText, label: nextText, captions: (item.captions || [{ startMs: Math.round(item.start * 1000), endMs: Math.round(item.end * 1000) }]).map((caption) => ({ ...caption, text: nextText })) };
        emitStateChange({ ...state, tracks: state.tracks.map((track) => ({ ...track, items: track.items.map((candidate) => candidate.id === item.id ? nextItem : candidate) })) });
        setEditingItemId(null);
    };
    const renderItem = (track, item) => {
        const label = item.label || item.text || track.name;
        const isEditing = editingItemId === item.id;
        return <div key={item.id} role="button" tabIndex={0} aria-label={`${label} clip`} title={label} onClick={() => onSelectItem?.(item, track)} onDoubleClick={(event) => beginInlineEdit(event, item)} onPointerDown={(event) => beginDrag(event, track, item)} className="absolute top-2 bottom-2 overflow-hidden rounded border border-white/20 px-1 py-2 text-[10px] text-white shadow" style={{ left: `${(item.start / duration) * 100}%`, width: `${Math.max(0.25, ((item.end - item.start) / duration) * 100)}%`, minWidth: 10, backgroundColor: colors[track.type] || '#52525b', opacity: track.visible === false ? 0.35 : 1 }}>
            {isEditing ? <input autoFocus aria-label={`Edit subtitle ${label}`} value={draftText} onChange={(event) => setDraftText(event.target.value)} onBlur={() => commitInlineEdit(item)} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') commitInlineEdit(item); if (event.key === 'Escape') setEditingItemId(null); }} onPointerDown={(event) => event.stopPropagation()} className="w-full min-w-0 rounded bg-black/30 px-1 text-[10px] text-white outline-none" /> : <span className="truncate">{label}</span>}
            <span role="button" tabIndex={0} aria-label={`${label} resize start`} onPointerDown={(event) => beginDrag(event, track, item, 'start')} className="absolute left-0 top-0 h-full w-1 cursor-ew-resize opacity-0 hover:opacity-100" />
            <span role="button" tabIndex={0} aria-label={`${label} resize end`} onPointerDown={(event) => beginDrag(event, track, item, 'end')} className="absolute right-0 top-0 h-full w-1 cursor-ew-resize opacity-0 hover:opacity-100" />
        </div>;
    };
    const beginDrag = (event, track, item, edge = 'move') => {
        if (track.locked) return;
        event.preventDefault(); event.stopPropagation();
        const originX = event.clientX;
        const original = { startMs: item.start * 1000, endMs: item.end * 1000 };
        const update = (moveEvent) => {
            const deltaMs = ((moveEvent.clientX - originX) / laneWidth) * duration * 1000;
            const next = edge === 'move' ? moveCue(original, deltaMs, duration * 1000) : resizeCue(original, edge, deltaMs, duration * 1000, 1000 / (state.fps || 30));
            const nextItem = { ...item, start: next.startMs / 1000, end: next.endMs / 1000 };
            const tracks = state.tracks.map((candidate) => candidate.id === track.id ? { ...candidate, items: candidate.items.map((candidateItem) => candidateItem.id === item.id ? nextItem : candidateItem) } : candidate);
            emitStateChange({ ...state, tracks });
        };
        const stop = () => { window.removeEventListener('pointermove', update); window.removeEventListener('pointerup', stop); };
        window.addEventListener('pointermove', update); window.addEventListener('pointerup', stop);
    };
    const playheadLeft = `${Math.max(0, Math.min(duration, playheadFrame / (state.fps || 30))) / duration * 100}%`;
    return <div data-testid="timeline-scroll" className="timeline-scroll h-full overflow-auto rounded-lg border border-white/10 bg-[#101014]" ref={timelineRef}>
        <div data-testid="timeline-canvas" className="flex flex-col" style={{ width: `${canvasWidth}px` }}>
            <div data-testid="timeline-ruler" className="relative ml-40 h-8 border-b border-white/10 bg-[#151519]" style={{ width: `${laneWidth}px` }} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onSeek?.(Math.max(0, Math.min(duration, ((event.clientX - rect.left) / rect.width) * duration))); }}><span className="absolute left-1 top-1 text-[10px] text-zinc-600">{formatTimecode(0, state.fps || 30)}</span><span className="absolute right-1 top-1 text-[10px] text-zinc-600">{formatTimecode(duration, state.fps || 30)}</span><div className="absolute top-0 bottom-0 w-px bg-red-400" style={{ left: playheadLeft }} /></div>
            {state.tracks.map((track) => <div key={track.id} className="flex h-14 border-b border-white/10"><TrackControls track={track} onChange={changeTrack} /><div className="relative shrink-0 bg-[#111115]" style={{ width: `${laneWidth}px` }}>{track.items.map((item) => renderItem(track, item))}</div></div>)}
        </div>
    </div>;
}
