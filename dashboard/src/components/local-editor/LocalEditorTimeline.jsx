import React, { useRef } from 'react';
import { moveCue, resizeCue } from '../../editor/timelineModel';

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
            style={{ left: `${left}%`, width: `${width}%`, background: color, minWidth: 18 }}
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

function Track({ label, cues, durationMs, color, selectedId, onSelect, onChange }) {
    return (
        <div className="flex min-h-12 items-stretch border-b border-white/10 last:border-b-0">
            <div className="flex w-36 shrink-0 items-center bg-white/[.03] px-3 text-[11px] font-medium text-zinc-300">{label}</div>
            <div className="relative flex-1 bg-black/20">
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
    const safeDuration = Math.max(1, durationMs);
    const seek = (event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onSeek?.(Math.max(0, Math.min(safeDuration, ((event.clientX - rect.left) / rect.width) * safeDuration)));
    };
    const hookCues = hook ? [hook] : [];

    return (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-[#101014]">
            <div className="relative ml-36 h-9 cursor-pointer border-b border-white/10" onClick={seek} role="slider" aria-label="Timeline seek" aria-valuemin={0} aria-valuemax={safeDuration} aria-valuenow={playheadMs} tabIndex={0}>
                {[0, 25, 50, 75, 100].map((mark) => <span key={mark} className="absolute top-2 -translate-x-1/2 text-[9px] text-zinc-600" style={{ left: `${mark}%` }}>{Math.round((safeDuration * mark) / 1000) / 10}s</span>)}
                <div className="absolute bottom-0 top-0 w-px bg-cyan-300" style={{ left: `${(playheadMs / safeDuration) * 100}%` }} />
            </div>
            <Track label="Viral Hook" cues={hookCues} durationMs={safeDuration} color="#f59e0b" selectedId={selectedId} onSelect={(cue) => onSelect?.(cue, 'hook')} onChange={(cue) => onChange?.(cue, 'hook')} />
            <Track label="Subtitles" cues={subtitleCues} durationMs={safeDuration} color="#8b5cf6" selectedId={selectedId} onSelect={(cue) => onSelect?.(cue, 'subtitle')} onChange={(cue) => onChange?.(cue, 'subtitle')} />
        </div>
    );
}
