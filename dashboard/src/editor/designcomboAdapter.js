const clone = (value) => JSON.parse(JSON.stringify(value ?? {}));

const durationFromManifest = (manifest) => {
    const trim = manifest?.timeline?.trim || {};
    const end = Number(trim.end_sec ?? manifest?.duration_sec ?? 0);
    const start = Number(trim.start_sec ?? 0);
    return Math.max(0, end - start);
};

const cueText = (cue) => cue.text || cue.captions?.map((word) => word.text).join(' ') || '';

const subtitleItems = (track) => (track?.cues || track?.captions || []).map((cue, index) => ({
    id: `${track.id || 'subtitle'}-${index}`,
    type: 'subtitle',
    label: cueText(cue),
    text: cueText(cue),
    start: Number(cue.startMs || 0) / 1000,
    end: Number(cue.endMs || cue.startMs || 0) / 1000,
    trackId: `subtitles-${track.id}`,
    cueIndex: index,
    trackIdRef: track.id,
}));

const transcriptCues = (transcript) => (transcript?.segments || []).map((segment) => ({
    text: segment.text || '',
    startMs: Math.round(Number(segment.start || 0) * 1000),
    endMs: Math.round(Number(segment.end || segment.start || 0) * 1000),
    captions: (segment.words || []).map((word) => ({
        text: word.word || word.text || '',
        startMs: Math.round(Number(word.start || 0) * 1000),
        endMs: Math.round(Number(word.end || word.start || 0) * 1000),
    })),
}));

const subtitleTracksFromManifest = (manifest) => {
    if (Array.isArray(manifest?.subtitle_tracks) && manifest.subtitle_tracks.length) return manifest.subtitle_tracks;
    const legacy = manifest?.layers?.subtitles;
    if (legacy) return [{ id: 'original', language: legacy.language || 'und', label: legacy.label || 'Original', origin: 'original', cues: legacy.cues || legacy.captions || [] }];
    const transcript = manifest?.timeline?.transcript;
    if (transcript?.segments?.length) return [{ id: 'original', language: transcript.language || 'und', label: 'Original', origin: 'original', cues: transcriptCues(transcript) }];
    return [];
};

export function manifestToEditorState(manifest, { fps = 30 } = {}) {
    const durationSec = durationFromManifest(manifest);
    const tracks = [
        { id: 'video-1', name: 'V1', type: 'video', muted: false, locked: false, visible: true, items: [{ id: 'video-1-source', type: 'video', label: 'Source video', start: 0, end: durationSec, trackId: 'video-1', url: manifest?.timeline?.source_video_url || '' }] },
        { id: 'audio-1', name: 'A1', type: 'audio', muted: false, locked: false, visible: true, items: [{ id: 'audio-1-source', type: 'audio', label: 'Source audio', start: 0, end: durationSec, trackId: 'audio-1', url: manifest?.timeline?.source_video_url || '' }] },
    ];

    const hook = manifest?.layers?.hook;
    if (hook) tracks.push({ id: 'hook', name: 'Hook', type: 'hook', muted: false, locked: false, visible: true, items: [{ ...clone(hook), id: 'hook-1', type: 'hook', label: hook.text || 'Hook', start: Number(hook.startMs || 0) / 1000, end: Number(hook.endMs ?? ((hook.startMs || 0) + (hook.displayDurationSec || 0) * 1000)) / 1000, trackId: 'hook' }] });

    for (const track of subtitleTracksFromManifest(manifest)) {
        tracks.push({ id: `subtitles-${track.id}`, name: track.label || track.language || track.id, type: 'subtitle', language: track.language, origin: track.origin, muted: false, locked: false, visible: true, items: subtitleItems(track) });
    }

    const effects = manifest?.layers?.effects?.segments || [];
    if (effects.length) tracks.push({ id: 'effects', name: 'Effects', type: 'effects', muted: false, locked: false, visible: true, items: effects.map((segment, index) => ({ ...clone(segment), id: `effect-${index}`, type: 'effect', label: 'Effect', start: Number(segment.startSec || 0), end: Number(segment.endSec || 0), trackId: 'effects' })) });

    return { fps, durationSec, durationFrames: Math.max(1, Math.round(durationSec * fps)), playheadFrame: 0, selectedItemId: null, tracks };
}

export function editorStateToManifest(state, sourceManifest) {
    const manifest = clone(sourceManifest);
    const hookItem = state.tracks.find((track) => track.id === 'hook')?.items[0];
    if (hookItem) manifest.layers = { ...(manifest.layers || {}), hook: { ...clone(manifest.layers?.hook), ...clone(hookItem), startMs: Math.round(hookItem.start * 1000), endMs: Math.round(hookItem.end * 1000), displayDurationSec: Math.max(0.001, hookItem.end - hookItem.start) } };

    const subtitleTracks = state.tracks.filter((track) => track.type === 'subtitle').map((track) => {
        const existing = (manifest.subtitle_tracks || []).find((item) => item.id === track.language || item.id === track.id.replace(/^subtitles-/, '')) || {};
        const cues = track.items.map((item) => ({ text: item.text || item.label || '', startMs: Math.round(item.start * 1000), endMs: Math.round(item.end * 1000), captions: [{ text: item.text || item.label || '', startMs: Math.round(item.start * 1000), endMs: Math.round(item.end * 1000) }] }));
        return { ...clone(existing), id: existing.id || track.id.replace(/^subtitles-/, ''), language: existing.language || track.language, label: existing.label || track.name, origin: existing.origin || track.origin || 'manual', cues, captions: cues.flatMap((cue) => cue.captions) };
    });
    if (subtitleTracks.length) {
        manifest.subtitle_tracks = subtitleTracks;
        const original = state.tracks.find((track) => track.id === 'subtitles-original');
        if (original) {
            const legacy = clone(manifest.layers?.subtitles || {});
            const legacyCues = original.items.map((item) => ({ text: item.text || item.label || '', startMs: Math.round(item.start * 1000), endMs: Math.round(item.end * 1000), captions: [{ text: item.text || item.label || '', startMs: Math.round(item.start * 1000), endMs: Math.round(item.end * 1000) }] }));
            manifest.layers = { ...(manifest.layers || {}), subtitles: { ...legacy, cues: legacyCues, captions: legacyCues.flatMap((cue) => cue.captions) } };
            const transcript = manifest.timeline?.transcript;
            if (transcript?.segments?.length) {
                const existingSegments = transcript.segments;
                const segments = original.items.map((item, index) => ({
                    ...(existingSegments[index] || {}),
                    text: item.text || item.label || '',
                    start: item.start,
                    end: item.end,
                }));
                manifest.timeline = { ...(manifest.timeline || {}), transcript: { ...transcript, segments } };
            }
        }
    }
    const effects = state.tracks.find((track) => track.id === 'effects');
    if (effects) manifest.layers = { ...(manifest.layers || {}), effects: { segments: effects.items.map((item) => ({ ...clone(item), startSec: item.start, endSec: item.end })) } };
    return manifest;
}

export function editorStateToDesignComboItems(state) {
    return state.tracks.flatMap((track) => track.items.map((item) => ({ ...item, trackId: track.id })));
}

export function designComboItemsToEditorState(items, state) {
    const next = clone(state);
    const byTrack = new Map();
    for (const item of items) byTrack.set(item.trackId, [...(byTrack.get(item.trackId) || []), item]);
    next.tracks = next.tracks.map((track) => ({ ...track, items: byTrack.get(track.id) || track.items }));
    return next;
}
