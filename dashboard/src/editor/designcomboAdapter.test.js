import { describe, expect, it } from 'vitest';
import { editorStateToManifest, manifestToEditorState, manifestToRenderProps } from './designcomboAdapter';
import { createSubtitleCue } from './timelineModel';

const manifest = {
    timeline: { source_video_url: 'https://example.test/source.mp4', trim: { start_sec: 0, end_sec: 12.5 } },
    layers: {
        hook: { text: 'Hook', position: 'top', size: 'M', entranceAnimation: 'fade', displayDurationSec: 2, startMs: 1000, endMs: 3000 },
        subtitles: { position: 'bottom', style: { fontFamily: 'Arial', fontSize: 48, fontColor: '#fff', highlightColor: '#0ff', borderColor: '#000', borderWidth: 2, bgColor: '#000', bgOpacity: 0.5, animation: 'none' }, captions: [{ text: 'Hello', startMs: 1200, endMs: 2400 }] },
        effects: { segments: [{ startSec: 0, endSec: 4, zoom: 1, zoomCenterX: 0.5, zoomCenterY: 0.5, brightness: 1, contrast: 1, saturate: 1 }] },
    },
    subtitle_tracks: [{ id: 'original', language: 'en', label: 'Original', origin: 'original', cues: [{ text: 'Hello', startMs: 1200, endMs: 2400, captions: [{ text: 'Hello', startMs: 1200, endMs: 2400 }] }] }, { id: 'es', language: 'es', label: 'ES', origin: 'translation', cues: [{ text: 'Hola', startMs: 1200, endMs: 2400, captions: [{ text: 'Hola', startMs: 1200, endMs: 2400 }] }] }],
    active_subtitle_track_id: 'original',
};

describe('designcomboAdapter', () => {
    it('maps every manifest layer to stable editor tracks', () => {
        const state = manifestToEditorState(manifest);
        expect(state.tracks.map((track) => track.id)).toEqual(['video-1', 'audio-1', 'hook', 'subtitles-original', 'subtitles-es', 'effects']);
        expect(state.tracks.find((track) => track.id === 'subtitles-es').items[0]).toMatchObject({ start: 1.2, end: 2.4, type: 'subtitle' });
    });

    it('round-trips timing without mutating the source manifest', () => {
        const state = manifestToEditorState(manifest);
        state.tracks.find((track) => track.id === 'hook').items[0].start = 1.5;
        const next = editorStateToManifest(state, manifest);
        expect(next.layers.hook.startMs).toBe(1500);
        expect(manifest.layers.hook.startMs).toBe(1000);
    });

    it('preserves frame-accurate boundaries at the clip fps', () => {
        const state = manifestToEditorState(manifest, { fps: 29.97 });
        expect(state.durationFrames).toBe(Math.round(12.5 * 29.97));
    });

    it('normalizes legacy layer subtitles into a visible original track', () => {
        const state = manifestToEditorState({
            timeline: { trim: { start_sec: 0, end_sec: 4 } },
            layers: { subtitles: { cues: [{ text: 'Hola', startMs: 500, endMs: 1500 }] } },
        });
        expect(state.tracks.find((track) => track.id === 'subtitles-original').items[0]).toMatchObject({ text: 'Hola', start: 0.5, end: 1.5 });
    });

    it('round-trips legacy cue edits without mutating the source manifest', () => {
        const source = { timeline: { trim: { start_sec: 0, end_sec: 4 } }, layers: { subtitles: { cues: [{ text: 'Hola', startMs: 500, endMs: 1500 }] } } };
        const state = manifestToEditorState(source);
        state.tracks.find((track) => track.id === 'subtitles-original').items[0].text = 'Hello';
        const next = editorStateToManifest(state, source);
        expect(next.layers.subtitles.cues[0]).toMatchObject({ text: 'Hello', startMs: 500, endMs: 1500 });
        expect(source.layers.subtitles.cues[0].text).toBe('Hola');
    });

    it('normalizes transcript segments into the editable original subtitle track', () => {
        const source = {
            timeline: {
                trim: { start_sec: 0, end_sec: 4 },
                transcript: { language: 'it', segments: [{ start: 0.5, end: 1.5, text: 'Ciao', words: [{ start: 0.5, end: 1.5, word: 'Ciao' }] }] },
            },
            layers: {},
        };
        const state = manifestToEditorState(source);
        expect(state.tracks.find((track) => track.id === 'subtitles-original').items[0]).toMatchObject({ text: 'Ciao', start: 0.5, end: 1.5 });
        state.tracks.find((track) => track.id === 'subtitles-original').items[0].text = 'Hello';
        const next = editorStateToManifest(state, source);
        expect(next.timeline.transcript.segments[0]).toMatchObject({ text: 'Hello', start: 0.5, end: 1.5 });
        expect(source.timeline.transcript.segments[0].text).toBe('Ciao');
    });

    it('serializes a newly created cue into cues and captions', () => {
        const source = { timeline: { trim: { start_sec: 0, end_sec: 10 } }, subtitle_tracks: [{ id: 'original', language: 'en', label: 'Original', cues: [] }], layers: {} };
        const state = manifestToEditorState(source);
        const cue = createSubtitleCue({ playheadMs: 3000, durationMs: 10000, fps: 30, existingIds: [] });
        const original = state.tracks.find((track) => track.id === 'subtitles-original');
        original.items.push({ ...cue, trackId: original.id });
        const next = editorStateToManifest(state, source);
        expect(next.subtitle_tracks[0].cues.at(-1)).toMatchObject({ text: '', startMs: 3000, endMs: 5000 });
        expect(next.subtitle_tracks[0].captions.at(-1)).toMatchObject({ text: '', startMs: 3000, endMs: 5000 });
    });

    it('renders no subtitles when no track is selected', () => {
        const source = { timeline: { source_video_url: '/videos/source.mp4' }, layers: { subtitles: null }, subtitle_tracks: [] };
        expect(manifestToRenderProps(source).subtitles).toBeNull();
    });

    it('renders captions from only the selected subtitle track', () => {
        const props = manifestToRenderProps({ ...manifest, active_subtitle_track_id: 'es' });
        expect(props.activeSubtitleTrackId).toBe('es');
        expect(props.subtitles.captions).toEqual([{ text: 'Hola', startMs: 1200, endMs: 2400 }]);
    });
});
