import { describe, expect, it } from "vitest";
import { manifestToVersionRenderProps } from "./version-manifest.js";

describe("manifestToVersionRenderProps", () => {
  it("derives complete render props from the persisted version snapshot", () => {
    const props = manifestToVersionRenderProps(
      {
        timeline: { source_video_url: "/videos/job/source.mp4" },
        render_spec: {
          video_start_seconds: 12.5,
          duration_in_frames: 240,
          fps: 24,
          width: 1080,
          height: 1920,
          video_fit: "contain",
        },
        active_subtitle_track_id: "es",
        subtitle_tracks: [
          { id: "en", style: { fontSize: 20 }, cues: [{ text: "English" }] },
          {
            id: "es",
            style: {
              position: "top",
              fontFamily: "Impact",
              fontSize: 24,
              fontColor: "#00FF00",
              highlightColor: "#FF0000",
              borderColor: "#0000FF",
              borderWidth: 2,
              bgColor: "#111111",
              bgOpacity: 0.5,
              animation: "pop",
            },
            cues: [{ text: "Hola", startMs: 100, endMs: 900 }],
          },
        ],
        layers: {
          layout: { format: "streamer_stack", facecam_size: "large" },
          audio: { tracks: [{ id: "audio-1", volume: 0.8 }] },
          hook: {
            text: "Watch this",
            color: "#FF00AA",
            fontSize: 48,
            background: "#111111",
            size: "M",
          },
          effects: { segments: [{ startSec: 0, endSec: 2, zoom: 1.1 }] },
          subtitles: { animation: "pop" },
        },
      },
      { versionId: "v4", manifestRevision: "rev-4" },
    );

    expect(props).toMatchObject({
      videoUrl: "/videos/job/source.mp4",
      videoStartSeconds: 12.5,
      durationInFrames: 240,
      fps: 24,
      width: 1080,
      height: 1920,
      videoFit: "contain",
      versionId: "v4",
      manifestRevision: "rev-4",
      subtitleTracks: expect.arrayContaining([
        expect.objectContaining({ id: "en" }),
        expect.objectContaining({
          id: "es",
          style: expect.objectContaining({
            position: "top",
            fontSize: 24,
            borderWidth: 2,
          }),
        }),
      ]),
      activeSubtitleTrackId: "es",
      layout: { format: "streamer_stack", facecam_size: "large" },
      audio: { tracks: [{ id: "audio-1", volume: 0.8 }] },
      hook: {
        text: "Watch this",
        color: "#FF00AA",
        fontSize: 48,
        background: "#111111",
        size: "M",
      },
      effects: { segments: [{ startSec: 0, endSec: 2, zoom: 1.1 }] },
    });
    expect(props.subtitles).toEqual({
      animation: "pop",
      position: "top",
      captions: [{ text: "Hola", startMs: 100, endMs: 900 }],
      style: {
        position: "top",
        fontFamily: "Impact",
        fontSize: 24,
        fontColor: "#00FF00",
        highlightColor: "#FF0000",
        borderColor: "#0000FF",
        borderWidth: 2,
        bgColor: "#111111",
        bgOpacity: 0.5,
        animation: "pop",
      },
    });
  });

  it("preserves nested word timings from persisted subtitle cues", () => {
    const props = manifestToVersionRenderProps(
      {
        timeline: { source_video_url: "/videos/job/source.mp4" },
        render_spec: {
          video_start_seconds: 0,
          duration_in_frames: 240,
          fps: 24,
          width: 1080,
          height: 1920,
          video_fit: "contain",
        },
        active_subtitle_track_id: "original",
        subtitle_tracks: [
          {
            id: "original",
            cues: [
              {
                text: "Hola mundo",
                startMs: 100,
                endMs: 900,
                captions: [
                  { text: "Hola", startMs: 100, endMs: 400 },
                  { text: "mundo", startMs: 400, endMs: 900 },
                ],
              },
            ],
          },
        ],
      },
      { versionId: "v4", manifestRevision: "rev-4" },
    );

    expect((props.subtitles as { captions: unknown[] })?.captions).toEqual([
      { text: "Hola", startMs: 100, endMs: 400 },
      { text: "mundo", startMs: 400, endMs: 900 },
    ]);
  });

  it("rejects versions without a complete render specification", () => {
    expect(() =>
      manifestToVersionRenderProps(
        { timeline: { source_video_url: "/videos/job/source.mp4" } },
        { versionId: "v4", manifestRevision: "rev-4" },
      ),
    ).toThrow("render_spec");
  });

  it("does not apply the master timeline offset to generated source clips", () => {
    const props = manifestToVersionRenderProps(
      {
        timeline: {
          source_video_url:
            "https://media.example/clips/clip-1/source_clip_4.mp4",
        },
        render_spec: {
          video_start_seconds: 1686,
          duration_in_frames: 240,
          fps: 24,
          width: 1080,
          height: 1920,
          video_fit: "contain",
        },
      },
      { versionId: "v4", manifestRevision: "rev-4" },
    );

    expect(props.videoStartSeconds).toBe(0);
  });

  it("keeps the timeline offset for master video sources", () => {
    const props = manifestToVersionRenderProps(
      {
        timeline: { source_video_url: "https://media.example/master.mp4" },
        render_spec: {
          video_start_seconds: 1686,
          duration_in_frames: 240,
          fps: 24,
          width: 1080,
          height: 1920,
          video_fit: "contain",
        },
      },
      { versionId: "v4", manifestRevision: "rev-4" },
    );

    expect(props.videoStartSeconds).toBe(1686);
  });

  it("passes persisted layout segments through to the renderer", () => {
    const segments = [
      {
        id: "layout-1",
        startMs: 0,
        endMs: 5000,
        format: "standard",
        transition: "cut",
        transitionDurationMs: 250,
      },
      {
        id: "layout-2",
        startMs: 5000,
        endMs: 10000,
        format: "streamer_stack",
        transition: "crossfade",
        transitionDurationMs: 250,
      },
    ];
    const props = manifestToVersionRenderProps(
      {
        timeline: { source_video_url: "/videos/job/source.mp4" },
        render_spec: {
          video_start_seconds: 0,
          duration_in_frames: 300,
          fps: 30,
          width: 1080,
          height: 1920,
          video_fit: "contain",
        },
        layers: { layout: { format: "standard", segments } },
      },
      { versionId: "v5", manifestRevision: "rev-5" },
    );

    expect(props.layout?.segments).toEqual(segments);
  });

  it("preserves a tracked Standard section and its source metadata", () => {
    const cache = {
      cache_key: "track-1",
      algorithm_version: "yolo-standard-v1",
      source_fingerprint: "source:1:2",
      source_start_seconds: 0,
      source_end_seconds: 10,
      source_width: 1920,
      source_height: 1080,
      track: {
        scenes: [
          {
            start_sec: 0,
            end_sec: 10,
            strategy: "TRACK",
            keyframes: [
              { time_sec: 0, rect: { x: 0.2, y: 0, width: 0.5, height: 1 } },
            ],
          },
        ],
      },
    };
    const props = manifestToVersionRenderProps(
      {
        timeline: {
          source_asset_id: "master",
          source_video_url: "/videos/master.mp4",
        },
        assets: { master: { probe: { width: 1920, height: 1080 } } },
        render_spec: {
          video_start_seconds: 0,
          duration_in_frames: 300,
          fps: 30,
          width: 1080,
          height: 1920,
        },
        layers: {
          layout: {
            format: "standard",
            segments: [
              {
                id: "standard",
                startMs: 0,
                endMs: 10000,
                format: "standard",
                face_tracking_enabled: true,
                face_tracking_cache: cache,
              },
            ],
          },
        },
      },
      { versionId: "v7", manifestRevision: "rev-7" },
    );

    expect(props.layout).toMatchObject({
      source_width: 1920,
      source_height: 1080,
      segments: [{ face_tracking_enabled: true, face_tracking_cache: cache }],
    });
  });

  it("adds source dimensions to selected streamer regions", () => {
    const props = manifestToVersionRenderProps(
      {
        timeline: { source_asset_id: "master", source_video_url: "/videos/master.mp4" },
        assets: { master: { probe: { width: 1920, height: 1080 } } },
        render_spec: {
          video_start_seconds: 0,
          duration_in_frames: 300,
          fps: 30,
          width: 1080,
          height: 1920,
          video_fit: "contain",
        },
        layers: {
          layout: {
            format: "streamer_stack",
            webcam_region: { x: 0.05, y: 0.1, width: 0.25, height: 0.3 },
          },
        },
      },
      { versionId: "v6", manifestRevision: "rev-6" },
    );

    expect(props.layout).toMatchObject({
      source_width: 1920,
      source_height: 1080,
      webcam_region: { x: 0.05, y: 0.1, width: 0.25, height: 0.3 },
    });
  });
});
