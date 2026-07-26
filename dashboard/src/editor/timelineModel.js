export const msToFrame = (ms, fps) => Math.max(0, Math.round((Number(ms) * Number(fps)) / 1000));
export const frameToMs = (frame, fps) => Math.max(0, Math.round((Number(frame) * 1000) / Number(fps)));

export function clampCue(cue, durationMs, minimumMs = 1) {
    const duration = Math.max(1, Number(durationMs) || 1);
    const start = Math.max(0, Math.min(Number(cue.startMs) || 0, duration));
    const end = Math.max(start + minimumMs, Number(cue.endMs) || start + minimumMs);
    return { ...cue, startMs: Math.min(start, duration), endMs: Math.min(duration, Math.max(start, end)) };
}

export function moveCue(cue, deltaMs, durationMs) {
    const duration = Math.max(1, Number(durationMs) || 1);
    const length = Math.max(1, (Number(cue.endMs) || 0) - (Number(cue.startMs) || 0));
    const start = Math.max(0, Math.min(duration - length, (Number(cue.startMs) || 0) + Number(deltaMs || 0)));
    return { ...cue, startMs: Math.round(start), endMs: Math.round(start + length) };
}

export function resizeCue(cue, edge, deltaMs, durationMs, minimumMs = 80) {
    const duration = Math.max(1, Number(durationMs) || 1);
    let start = Number(cue.startMs) || 0;
    let end = Number(cue.endMs) || start + minimumMs;
    if (edge === 'start') start = Math.min(end - minimumMs, Math.max(0, start + Number(deltaMs || 0)));
    else end = Math.max(start + minimumMs, Math.min(duration, end + Number(deltaMs || 0)));
    return { ...cue, startMs: Math.round(start), endMs: Math.round(end) };
}

export function makeEditorDraft(version) {
    return JSON.parse(JSON.stringify(version?.manifest || version || {}));
}

