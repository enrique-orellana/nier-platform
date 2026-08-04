import React, { useEffect, useRef } from 'react';
import { moveCue, resizeCue } from '../../editor/timelineModel';

const TRACK_LABEL_WIDTH = 144;
const BASE_PIXELS_PER_SECOND = 80;
const MIN_LANE_WIDTH = 760;

const clampPercent = (value) => Math.max(0, Math.min(100, value));

function CueBlock({ cue, durationMs, color, selected, onSelect, onChange }) {
    const blockRef = useRef(null);

    const beginDrag = (event, mode) => {
        event.preventDefault();
        event.stopPropagation();
        const originX = event.clientX;
        const original = { ...cue };
        const width = blockRef.current?.parentElement?.getBoundingClientRect().width || 1;
        const update = (moveEvent) => {
            const delta = ((moveEvent.clientX - originX) / width) * durationMs;
            onChange(mode === 'move' ? moveCue(original, delta, durationMs) : resizeCue(original, mode, delta, durationMs));
        };
        const stop = () => {
            window.removeEventListener('pointermove', update);
            window.removeEventListener('pointerup', stop);
        };
        window.addEventListener('pointermove', update);
        window.addEventListener('pointerup', stop, { once: true });
    };

    const left = clampPercent((cue.startMs / durationMs) * 100);
    const width = Math.max(1, Math.min(100 - left, ((cue.endMs - cue.startMs) / durationMs) * 100));

    return (
        <div
            ref={blockRef}
            role="button"
            tabIndex={0}
            aria-label={cue.text || 'Timeline cue'}
            onClick={() => onSelect(cue)}
            onPointerDown={(event) => beginDrag(event, 'move')}
            onKeyDown={(event) => event.key === 'Enter' && onSelect(cue)}
            className={`absolute inset-y-1 rounded-md border px-2 py-1 text-left text-[10px] text-white shadow-sm transition-shadow ${selected ? 'ring-2 ring-white' : ''}`}
            style={{ left: `${left}%`, width: `${width}%`, background: color }}
        >
            <span className="pointer-events-none block truncate">{cue.text || 'Untitled cue'}</span>
            <button
                type="button"
                aria-label="Resize cue start"
                className="absolute left-0 top-0 h-full w-2 cursor-ew-resize opacity-0 hover:opacity-100"
                onPointerDown={(event) => beginDrag(event, 'start')}
            />
            <button
                type="button"
                aria-label="Resize cue end"
                className="absolute right-0 top-0 h-full w-2 cursor-ew-resize opacity-0 hover:opacity-100"
                onPointerDown={(event) => beginDrag(event, 'end')}
            />
        </div>
    );
}

function Track({ label, cues, durationMs, timelineWidth, color, selectedId, onSelect, onChange }) {
    return (
        <div className="flex min-h-12 w-full items-stretch border-b border-white/10 last:border-b-0">
            <div className="flex w-36 shrink-0 items-center bg-white/[.03] px-3 text-[11px] font-medium text-zinc-300">{label}</div>
            <div className="relative shrink-0 bg-black/20" style={{ width: `${timelineWidth}px` }}>
                {cues.map((cue) => (
                    <CueBlock
                        key={cue.id}
                        cue={cue}
                        durationMs={durationMs}
                        color={color}
                        selected={selectedId === cue.id}
                        onSelect={onSelect}
                        onChange={onChange}
                    />
                ))}
            </div>
        </div>
    );
}

export default function LocalEditorTimeline({ durationMs = 1, subtitleCues = [], hook = null, selectedId, onSelect, onChange, playheadMs = 0, onSeek }) {
    const timelineRef = useRef(null);
    const safeDuration = Math.max(1, durationMs);
    const timelineWidth = Math.max(MIN_LANE_WIDTH, Math.ceil((safeDuration / 1000) * BASE_PIXELS_PER_SECOND));
    const canvasWidth = TRACK_LABEL_WIDTH + timelineWidth;
    const durationSeconds = safeDuration / 1000;
    const tickCount = Math.min(12, Math.max(2, Math.ceil(durationSeconds / 5) + 1));
    const rulerMarks = Array.from({ length: tickCount }, (_, index) => (index / (tickCount - 1)) * 100);

    useEffect(() => {
        const container = timelineRef.current;
        if (!container?.clientWidth) return;
        const playheadX = TRACK_LABEL_WIDTH + (Math.max(0, Math.min(safeDuration, playheadMs)) / safeDuration) * timelineWidth;
        const visibleStart = container.scrollLeft + TRACK_LABEL_WIDTH;
        const visibleEnd = container.scrollLeft + container.clientWidth - 24;
        if (playheadX < visibleStart || playheadX > visibleEnd) {
            container.scrollLeft = Math.max(0, playheadX - container.clientWidth * 0.5);
        }
    }, [playheadMs, safeDuration, timelineWidth]);

    const seek = (event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onSeek?.(Math.max(0, Math.min(safeDuration, ((event.clientX - rect.left) / rect.width) * safeDuration)));
    };
    const hookCues = hook ? [hook] : [];

    return (
        <div className="rounded-xl border border-white/10 bg-[#101014]">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-[10px] text-zinc-500"><span>Timeline</span><span>Scroll horizontally for precise subtitle timing</span></div>
            <div ref={timelineRef} data-testid="local-editor-timeline-scroll" className="max-w-full overflow-x-auto overflow-y-hidden">
                <div data-testid="local-editor-timeline-canvas" className="relative" style={{ width: `${canvasWidth}px` }}>
                    <div className="relative ml-36 h-9 cursor-pointer border-b border-white/10" style={{ width: `${timelineWidth}px` }} onClick={seek} role="slider" aria-label="Timeline seek" aria-valuemin={0} aria-valuemax={safeDuration} aria-valuenow={playheadMs} tabIndex={0}>
                        {rulerMarks.map((mark) => <span key={mark} className="absolute top-2 -translate-x-1/2 text-[9px] text-zinc-600" style={{ left: `${mark}%` }}>{Math.round((safeDuration * mark) / 1000) / 10}s</span>)}
                        <div className="absolute bottom-0 top-0 w-px bg-cyan-300" style={{ left: `${(playheadMs / safeDuration) * 100}%` }} />
                    </div>
                    <Track label="Viral Hook" cues={hookCues} durationMs={safeDuration} timelineWidth={timelineWidth} color="#f59e0b" selectedId={selectedId} onSelect={(cue) => onSelect?.(cue, 'hook')} onChange={(cue) => onChange?.(cue, 'hook')} />
                    <Track label="Subtitles" cues={subtitleCues} durationMs={safeDuration} timelineWidth={timelineWidth} color="#8b5cf6" selectedId={selectedId} onSelect={(cue) => onSelect?.(cue, 'subtitle')} onChange={(cue) => onChange?.(cue, 'subtitle')} />
                    <div className="pointer-events-none absolute bottom-0 top-0 ml-36" style={{ width: `${timelineWidth}px` }}><div className="absolute bottom-0 top-0 z-10 w-px bg-cyan-300/80" style={{ left: `${(playheadMs / safeDuration) * 100}%` }} /></div>
                </div>
            </div>
        </div>
    );
}
