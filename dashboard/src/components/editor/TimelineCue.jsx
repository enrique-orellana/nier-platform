import React, { useRef } from 'react';
import { moveCue, resizeCue } from '../../editor/timelineModel';

export default function TimelineCue({ cue, durationMs, selected, onSelect, onChange, color = '#8b5cf6' }) {
    const trackRef = useRef(null);
    const drag = (event, mode) => {
        event.stopPropagation();
        const originX = event.clientX;
        const original = { ...cue };
        const width = trackRef.current?.parentElement?.getBoundingClientRect().width || 1;
        const update = (moveEvent) => {
            const delta = ((moveEvent.clientX - originX) / width) * durationMs;
            onChange(mode === 'move' ? moveCue(original, delta, durationMs) : resizeCue(original, mode, delta, durationMs));
        };
        const stop = () => { window.removeEventListener('pointermove', update); window.removeEventListener('pointerup', stop); };
        window.addEventListener('pointermove', update); window.addEventListener('pointerup', stop);
    };
    const left = `${Math.max(0, cue.startMs / durationMs) * 100}%`;
    const width = `${Math.max(1, (cue.endMs - cue.startMs) / durationMs) * 100}%`;
    return <div ref={trackRef} role="button" tabIndex={0} onClick={onSelect} onPointerDown={(e) => drag(e, 'move')} className={`absolute top-1 bottom-1 rounded-md px-2 text-[10px] text-white truncate cursor-grab ${selected ? 'ring-2 ring-white' : ''}`} style={{ left, width, background: color }}>
        <span className="pointer-events-none">{cue.text || 'Hook'}</span>
        <button aria-label="resize start" className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 hover:opacity-100" onPointerDown={(e) => drag(e, 'start')} />
        <button aria-label="resize end" className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 hover:opacity-100" onPointerDown={(e) => drag(e, 'end')} />
    </div>;
}

