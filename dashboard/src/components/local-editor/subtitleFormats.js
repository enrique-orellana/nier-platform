const TIMESTAMP_RE = /^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})$/;

const parseTimestamp = (value) => {
    const match = String(value).trim().match(TIMESTAMP_RE);
    if (!match) throw new Error(`Invalid subtitle timestamp: ${value}`);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    if (minutes > 59 || seconds > 59) throw new Error(`Invalid subtitle timestamp: ${value}`);
    return (((Number(match[1] || 0) * 60 + minutes) * 60 + seconds) * 1000) + Number(match[4]);
};

const formatTimestamp = (value) => {
    const ms = Math.max(0, Math.round(Number(value) || 0));
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};

const finalize = (cues) => {
    const parsed = cues.filter(Boolean);
    if (!parsed.length) throw new Error('No subtitle cues found');
    const normalized = parsed.map((cue) => cue.endMs === cue.startMs
        ? { ...cue, endMs: cue.startMs + 1 }
        : cue);
    if (normalized.some((cue) => cue.endMs < cue.startMs)) {
        throw new Error('Subtitle cue end must be after start');
    }
    return normalized.map((cue, index) => ({ ...cue, id: cue.id || `subtitle-${index + 1}` }));
};

const parseCueBlock = (block, index, preserveId = false) => {
    const lines = block.split(/\r?\n/).map((line) => line.trimEnd());
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) return null;
    const [start, rawEnd] = lines[timingIndex].split(/\s+-->\s+/);
    const end = rawEnd?.split(/\s+/)[0];
    const text = lines.slice(timingIndex + 1).join('\n').trim();
    if (!start || !end) throw new Error('Invalid subtitle cue');
    if (!text) return null;
    return {
        id: preserveId ? (lines[timingIndex - 1]?.trim() || `subtitle-${index + 1}`) : `subtitle-${index + 1}`,
        text,
        startMs: parseTimestamp(start),
        endMs: parseTimestamp(end),
    };
};

const splitBlocks = (source) => String(source).trim().split(/\r?\n\s*\r?\n/);

export function parseSrt(source) {
    return finalize(splitBlocks(source).map((block, index) => parseCueBlock(block, index)));
}

export function parseVtt(source) {
    const body = String(source).replace(/^\uFEFF?WEBVTT[^\n]*(?:\r?\n|$)/i, '').trim();
    return finalize(body ? splitBlocks(body).map((block, index) => parseCueBlock(block, index, true)) : []);
}

export function parseSubtitleFile(fileName, source) {
    const name = String(fileName).toLowerCase();
    if (name.endsWith('.srt')) return parseSrt(source);
    if (name.endsWith('.vtt')) return parseVtt(source);
    throw new Error('Only .srt and .vtt subtitle files are supported');
}

export function serializeSrt(cues) {
    return (cues || []).map((cue, index) => (
        `${index + 1}\n${formatTimestamp(cue.startMs)} --> ${formatTimestamp(cue.endMs)}\n${cue.text || ''}\n`
    )).join('\n');
}
