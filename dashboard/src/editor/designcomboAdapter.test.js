import { describe, expect, it } from "vitest";
import {
  editorStateToManifest,
  manifestToEditorState,
  manifestToRenderProps,
  manifestWithRefreshedSourceRange,
  manifestWithTranscriptCaptions,
} from "./designcomboAdapter";
import { createSubtitleCue } from "./timelineModel";

const manifest = {
  timeline: {
    source_video_url: "https://example.test/source.mp4",
    trim: { start_sec: 0, end_sec: 12.5 },
  },
  layers: {
    hook: {
      text: "Hook",
      position: "top",
      size: "M",
      entranceAnimation: "fade",
      displayDurationSec: 2,
      startMs: 1000,
      endMs: 3000,
    },
    subtitles: {
      position: "bottom",
      style: {
        fontFamily: "Arial",
        fontSize: 48,
        fontColor: "#fff",
        highlightColor: "#0ff",
        borderColor: "#000",
        borderWidth: 2,
        bgColor: "#000",
        bgOpacity: 0.5,
        animation: "none",
      },
      captions: [{ text: "Hello", startMs: 1200, endMs: 2400 }],
    },
    effects: {
      segments: [
        {
          startSec: 0,
          endSec: 4,
          zoom: 1,
          zoomCenterX: 0.5,
          zoomCenterY: 0.5,
          brightness: 1,
          contrast: 1,
          saturate: 1,
        },
      ],
    },
  },
  subtitle_tracks: [
    {
      id: "original",
      language: "en",
      label: "Original",
      origin: "original",
      cues: [
        {
          text: "Hello",
          startMs: 1200,
          endMs: 2400,
          captions: [{ text: "Hello", startMs: 1200, endMs: 2400 }],
        },
      ],
    },
    {
      id: "es",
      language: "es",
      label: "ES",
      origin: "translation",
      cues: [
        {
          text: "Hola",
          startMs: 1200,
          endMs: 2400,
          captions: [{ text: "Hola", startMs: 1200, endMs: 2400 }],
        },
      ],
    },
  ],
  active_subtitle_track_id: "original",
};

describe("designcomboAdapter", () => {
  it("maps every manifest layer to stable editor tracks", () => {
    const state = manifestToEditorState(manifest);
    expect(state.tracks.map((track) => track.id)).toEqual([
      "video-1",
      "audio-1",
      "hook",
      "subtitles-original",
      "subtitles-es",
      "effects",
    ]);
    expect(
      state.tracks.find((track) => track.id === "subtitles-es").items[0],
    ).toMatchObject({ start: 1.2, end: 2.4, type: "subtitle" });
  });

  it("round-trips timing without mutating the source manifest", () => {
    const state = manifestToEditorState(manifest);
    state.tracks.find((track) => track.id === "hook").items[0].start = 1.5;
    const next = editorStateToManifest(state, manifest);
    expect(next.layers.hook.startMs).toBe(1500);
    expect(manifest.layers.hook.startMs).toBe(1000);
  });

  it("preserves frame-accurate boundaries at the clip fps", () => {
    const state = manifestToEditorState(manifest, { fps: 29.97 });
    expect(state.durationFrames).toBe(Math.round(12.5 * 29.97));
  });

  it("normalizes legacy layer subtitles into a visible original track", () => {
    const state = manifestToEditorState({
      timeline: { trim: { start_sec: 0, end_sec: 4 } },
      layers: {
        subtitles: { cues: [{ text: "Hola", startMs: 500, endMs: 1500 }] },
      },
    });
    expect(
      state.tracks.find((track) => track.id === "subtitles-original").items[0],
    ).toMatchObject({ text: "Hola", start: 0.5, end: 1.5 });
  });

  it("round-trips legacy cue edits without mutating the source manifest", () => {
    const source = {
      timeline: { trim: { start_sec: 0, end_sec: 4 } },
      layers: {
        subtitles: { cues: [{ text: "Hola", startMs: 500, endMs: 1500 }] },
      },
    };
    const state = manifestToEditorState(source);
    state.tracks.find(
      (track) => track.id === "subtitles-original",
    ).items[0].text = "Hello";
    const next = editorStateToManifest(state, source);
    expect(next.layers.subtitles.cues[0]).toMatchObject({
      text: "Hello",
      startMs: 500,
      endMs: 1500,
    });
    expect(source.layers.subtitles.cues[0].text).toBe("Hola");
  });

  it("normalizes transcript segments into the editable original subtitle track", () => {
    const source = {
      timeline: {
        trim: { start_sec: 0, end_sec: 4 },
        transcript: {
          language: "it",
          segments: [
            {
              start: 0.5,
              end: 1.5,
              text: "Ciao",
              words: [{ start: 0.5, end: 1.5, word: "Ciao" }],
            },
          ],
        },
      },
      layers: {},
    };
    const state = manifestToEditorState(source);
    expect(
      state.tracks.find((track) => track.id === "subtitles-original").items[0],
    ).toMatchObject({ text: "Ciao", start: 0.5, end: 1.5 });
    state.tracks.find(
      (track) => track.id === "subtitles-original",
    ).items[0].text = "Hello";
    const next = editorStateToManifest(state, source);
    expect(next.timeline.transcript.segments[0]).toMatchObject({
      text: "Hello",
      start: 0.5,
      end: 1.5,
    });
    expect(source.timeline.transcript.segments[0].text).toBe("Ciao");
  });

  it("materializes clip-relative transcript captions when a generated manifest has only the source transcript", () => {
    const source = {
      timeline: {
        trim: { start_sec: 1758.5, end_sec: 1818.5 },
        transcript: {
          language: "es",
          segments: [
            {
              start: 1758.84,
              end: 1759.96,
              text: "¡Hostia, el laberinto, tú!",
            },
          ],
        },
      },
      layers: {},
      subtitle_tracks: [],
    };
    const next = manifestWithTranscriptCaptions(source, {
      language: "es",
      captions: [{ text: "¡Hostia,", startMs: 340, endMs: 680 }],
    });
    expect(next.subtitle_tracks[0]).toMatchObject({
      id: "original",
      language: "es",
      origin: "original",
    });
    expect(next.subtitle_tracks[0].cues[0]).toMatchObject({
      text: "¡Hostia,",
      startMs: 340,
      endMs: 680,
    });
    expect(next.active_subtitle_track_id).toBe("original");
  });

  it("refreshes the original track for an extended source range without replacing translations", () => {
    const source = {
      timeline: {
        trim: { start_sec: 10, end_sec: 14 },
        transcript: {
          language: "en",
          segments: [{ start: 10.5, end: 11.5, text: "Old" }],
        },
      },
      layers: {
        subtitles: {
          style: { fontFamily: "Arial" },
          captions: [{ text: "Old", startMs: 500, endMs: 1500 }],
        },
      },
      subtitle_tracks: [
        {
          id: "original",
          language: "en",
          label: "Original",
          origin: "original",
          style: { fontFamily: "Arial" },
          cues: [{ text: "Old", startMs: 500, endMs: 1500 }],
        },
        {
          id: "es",
          language: "es",
          label: "ES",
          origin: "translation",
          cues: [{ text: "Viejo", startMs: 500, endMs: 1500 }],
        },
      ],
      active_subtitle_track_id: "es",
    };
    const transcript = {
      language: "en",
      captions: [
        { text: "Old", startMs: 500, endMs: 1500 },
        { text: "Between", startMs: 4500, endMs: 5500 },
      ],
    };

    const next = manifestWithRefreshedSourceRange(
      source,
      { startSec: 10, endSec: 16 },
      transcript,
    );

    expect(next.timeline.trim).toEqual({ start_sec: 10, end_sec: 16 });
    expect(next.subtitle_tracks[0].cues).toEqual([
      expect.objectContaining({ text: "Old", startMs: 500, endMs: 1500 }),
      expect.objectContaining({
        text: "Between",
        startMs: 4500,
        endMs: 5500,
      }),
    ]);
    expect(next.subtitle_tracks[0].style).toEqual({ fontFamily: "Arial" });
    expect(next.subtitle_tracks[1]).toEqual(source.subtitle_tracks[1]);
    expect(next.active_subtitle_track_id).toBe("es");
    expect(source.subtitle_tracks[0].cues).toHaveLength(1);
  });

  it("serializes a newly created cue into cues and captions", () => {
    const source = {
      timeline: { trim: { start_sec: 0, end_sec: 10 } },
      subtitle_tracks: [
        { id: "original", language: "en", label: "Original", cues: [] },
      ],
      layers: {},
    };
    const state = manifestToEditorState(source);
    const cue = createSubtitleCue({
      playheadMs: 3000,
      durationMs: 10000,
      fps: 30,
      existingIds: [],
    });
    const original = state.tracks.find(
      (track) => track.id === "subtitles-original",
    );
    original.items.push({ ...cue, trackId: original.id });
    const next = editorStateToManifest(state, source);
    expect(next.subtitle_tracks[0].cues.at(-1)).toMatchObject({
      text: "",
      startMs: 3000,
      endMs: 5000,
    });
    expect(next.subtitle_tracks[0].captions.at(-1)).toMatchObject({
      text: "",
      startMs: 3000,
      endMs: 5000,
    });
  });

  it("renders no subtitles when no track is selected", () => {
    const source = {
      timeline: { source_video_url: "/videos/source.mp4" },
      layers: { subtitles: null },
      subtitle_tracks: [],
    };
    expect(manifestToRenderProps(source).subtitles).toBeNull();
  });

  it("renders captions from only the selected subtitle track", () => {
    const props = manifestToRenderProps({
      ...manifest,
      active_subtitle_track_id: "es",
    });
    expect(props.activeSubtitleTrackId).toBe("es");
    expect(props.subtitles.captions).toEqual([
      { text: "Hola", startMs: 1200, endMs: 2400 },
    ]);
  });

  it("preserves nested word timings when building render props", () => {
    const props = manifestToRenderProps({
      timeline: { source_video_url: "/videos/source.mp4" },
      layers: {},
      subtitle_tracks: [
        {
          id: "original",
          cues: [
            {
              text: "Hola mundo",
              startMs: 500,
              endMs: 1500,
              captions: [
                { text: "Hola", startMs: 500, endMs: 900 },
                { text: "mundo", startMs: 900, endMs: 1500 },
              ],
            },
          ],
        },
      ],
      active_subtitle_track_id: "original",
    });

    expect(props.subtitles.captions).toEqual([
      { text: "Hola", startMs: 500, endMs: 900 },
      { text: "mundo", startMs: 900, endMs: 1500 },
    ]);
  });

  it("does not emit subtitles for an empty active track", () => {
    const props = manifestToRenderProps({
      timeline: { source_video_url: "/videos/source.mp4" },
      layers: { subtitles: { style: { fontSize: 24 } } },
      subtitle_tracks: [{ id: "original", cues: [], captions: [] }],
      active_subtitle_track_id: "original",
    });

    expect(props.subtitles).toBeNull();
    expect(props.activeSubtitleTrackId).toBeNull();
  });

  it("passes the manifest layout to the render props", () => {
    const props = manifestToRenderProps({
      timeline: { source_video_url: "/videos/source.mp4" },
      layers: { layout: { format: "standard", facecam_size: "medium" } },
      subtitle_tracks: [],
    });

    expect(props.layout).toEqual({
      format: "standard",
      facecam_size: "medium",
    });
  });

  it("preserves segmented layout data in render props", () => {
    const segments = [
      {
        id: "layout-1",
        startMs: 0,
        endMs: 2500,
        format: "standard",
        transition: "cut",
        transitionDurationMs: 250,
      },
      {
        id: "layout-2",
        startMs: 2500,
        endMs: 5000,
        format: "streamer_stack",
        transition: "crossfade",
        transitionDurationMs: 250,
      },
    ];
    const props = manifestToRenderProps({
      timeline: { source_video_url: "/videos/source.mp4" },
      layers: {
        layout: { format: "standard", facecam_size: "medium", segments },
      },
      subtitle_tracks: [],
    });

    expect(props.layout.segments).toEqual(segments);
  });

  it("uses populated captions when a subtitle track has an empty cues array", () => {
    const source = {
      timeline: { trim: { start_sec: 0, end_sec: 4 } },
      subtitle_tracks: [
        {
          id: "original",
          language: "es",
          label: "Original",
          captions: [{ text: "Hola", startMs: 500, endMs: 1500 }],
          cues: [],
        },
      ],
      active_subtitle_track_id: "original",
    };
    const state = manifestToEditorState(source);
    expect(
      state.tracks.find((track) => track.id === "subtitles-original").items[0],
    ).toMatchObject({ text: "Hola", start: 0.5, end: 1.5 });
    expect(manifestToRenderProps(source).subtitles.captions).toEqual([
      { text: "Hola", startMs: 500, endMs: 1500 },
    ]);
  });

  it("fills an empty original subtitle track from the source transcript", () => {
    const source = {
      timeline: {
        trim: { start_sec: 10, end_sec: 14 },
        transcript: {
          language: "it",
          segments: [{ start: 10.5, end: 11.5, text: "Ciao" }],
        },
      },
      subtitle_tracks: [{ id: "original", language: "it", cues: [] }],
      layers: {},
    };

    const hydrated = manifestWithTranscriptCaptions(source, null);

    expect(hydrated.subtitle_tracks[0].cues).toEqual([
      expect.objectContaining({ text: "Ciao", startMs: 500, endMs: 1500 }),
    ]);
    expect(hydrated.active_subtitle_track_id).toBe("original");
  });

  it("does not recreate subtitles when the manifest explicitly disables them", () => {
    const source = {
      subtitle_tracks: [],
      subtitle_tracks_disabled: true,
      layers: { subtitles: null },
      timeline: {
        transcript: {
          language: "it",
          segments: [{ start: 10.5, end: 11.5, text: "Ciao" }],
        },
      },
    };

    const hydrated = manifestWithTranscriptCaptions(source, {
      language: "it",
      captions: [{ text: "Ciao", startMs: 500, endMs: 1500 }],
    });

    expect(hydrated).toBe(source);
    expect(hydrated.subtitle_tracks).toEqual([]);
    expect(hydrated.active_subtitle_track_id).toBeUndefined();
  });

  it("exposes the master-video offset for a clip preview", () => {
    const props = manifestToRenderProps({
      ...manifest,
      timeline: {
        ...manifest.timeline,
        trim: { start_sec: 1042.5, end_sec: 1050.5 },
      },
    });
    expect(props.videoStartSeconds).toBe(1042.5);
  });

  it("does not apply the master-video offset to a generated source clip", () => {
    const props = manifestToRenderProps({
      ...manifest,
      timeline: {
        ...manifest.timeline,
        source_video_url:
          "https://media.example/clips/74036096/source_clip_9.mp4",
        trim: { start_sec: 1042.5, end_sec: 1050.5 },
      },
    });
    expect(props.videoStartSeconds).toBe(0);
  });

  it("keeps saved transcript timestamps on the master-video clock", () => {
    const source = {
      timeline: {
        trim: { start_sec: 10, end_sec: 14 },
        transcript: {
          language: "it",
          segments: [{ start: 10.5, end: 11.5, text: "Ciao" }],
        },
      },
      subtitle_tracks: [
        {
          id: "original",
          language: "it",
          label: "Original",
          cues: [{ text: "Ciao", startMs: 500, endMs: 1500 }],
        },
      ],
      active_subtitle_track_id: "original",
      layers: {},
    };
    const state = manifestToEditorState(source);
    const next = editorStateToManifest(state, source);
    expect(next.timeline.transcript.segments[0]).toMatchObject({
      start: 10.5,
      end: 11.5,
    });
  });
});
