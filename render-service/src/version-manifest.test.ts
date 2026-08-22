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
            style: { fontSize: 42 },
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
        expect.objectContaining({ id: "es" }),
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
      captions: [{ text: "Hola", startMs: 100, endMs: 900 }],
      style: { fontSize: 42 },
    });
  });

  it("rejects versions without a complete render specification", () => {
    expect(() =>
      manifestToVersionRenderProps(
        { timeline: { source_video_url: "/videos/job/source.mp4" } },
        { versionId: "v4", manifestRevision: "rev-4" },
      ),
    ).toThrow("render_spec");
  });
});
