import { describe, expect, it, vi } from "vitest";
import { renderInBrowser } from "../../lib/renderInBrowser";
import {
  buildRemotionRenderProps,
  burnLocalEditorSubtitles,
  cleanSubtitleCue,
  renderLocalVideoOnBackend,
  renderLocalVideoOnBrowser,
  syncSubtitleCue,
} from "./localEditorRender";

vi.mock("../../lib/renderInBrowser", () => ({ renderInBrowser: vi.fn() }));

describe("local editor Remotion rendering", () => {
  it("removes terminal periods without changing cue or word timings", () => {
    expect(
      cleanSubtitleCue({
        id: "cue-1",
        text: 'Lo sé..."',
        startMs: 120,
        endMs: 980,
        captions: [
          { text: "Lo", startMs: 120, endMs: 400 },
          { text: 'sé..."', startMs: 400, endMs: 980 },
        ],
      }),
    ).toEqual({
      id: "cue-1",
      text: 'Lo sé"',
      startMs: 120,
      endMs: 980,
      captions: [
        { text: "Lo", startMs: 120, endMs: 400 },
        { text: 'sé"', startMs: 400, endMs: 980 },
      ],
    });
  });

  it("converts local editor overlays to the native render contract", () => {
    const props = buildRemotionRenderProps({
      durationSeconds: 6,
      fps: 25,
      width: 608,
      height: 1080,
      subtitleCues: [{ text: "Hello", startMs: 500, endMs: 1500 }],
      subtitleStyle: {
        position: "bottom",
        fontFamily: "Verdana",
        fontSize: 24,
      },
      hook: {
        text: "Hook",
        startMs: 0,
        endMs: 2000,
        position: "center",
        size: "M",
        entranceAnimation: "fade",
        color: "#FFFFFF",
        background: "#111111",
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 48,
        layoutFormat: "standard",
        facecamSize: "medium",
      },
    });

    expect(props).toMatchObject({
      durationInFrames: 150,
      fps: 25,
      width: 608,
      height: 1080,
    });
    expect(props.subtitles.captions).toEqual([
      { text: "Hello", startMs: 500, endMs: 1500 },
    ]);
    expect(props.subtitles.blocks).toEqual([
      {
        words: [{ text: "Hello", startMs: 500, endMs: 1500 }],
        startMs: 500,
        endMs: 1500,
        text: "Hello",
      },
    ]);
    expect(props.subtitles.style).toMatchObject({
      fontFamily: "Verdana",
      fontSize: 52.8,
      borderWidth: 3,
    });
    expect(props.hook).toMatchObject({
      text: "Hook",
      displayDurationSec: 2,
      position: "center",
      color: "#FFFFFF",
      background: "#111111",
      fontFamily: "Arial, Helvetica, sans-serif",
      fontSize: 48,
      layoutFormat: "standard",
      facecamSize: "medium",
    });
  });

  it("preserves Clip Generator word timings when generated cues are rendered", () => {
    const props = buildRemotionRenderProps({
      durationSeconds: 2,
      fps: 25,
      width: 608,
      height: 1080,
      subtitleCues: [
        {
          text: "Do I",
          startMs: 200,
          endMs: 550,
          captions: [
            { text: "Do", startMs: 200, endMs: 400 },
            { text: "I", startMs: 400, endMs: 550 },
          ],
        },
      ],
    });

    expect(props.subtitles.captions).toEqual([
      { text: "Do", startMs: 200, endMs: 400 },
      { text: "I", startMs: 400, endMs: 550 },
    ]);
    expect(props.subtitles.blocks).toHaveLength(1);
  });

  it("uses edited cue text instead of stale generated words", () => {
    const props = buildRemotionRenderProps({
      durationSeconds: 2,
      fps: 25,
      width: 608,
      height: 1080,
      subtitleCues: [
        {
          text: "Updated subtitle text",
          startMs: 200,
          endMs: 800,
          captions: [
            { text: "Original", startMs: 200, endMs: 500 },
            { text: "subtitle", startMs: 500, endMs: 800 },
          ],
        },
      ],
    });

    expect(props.subtitles.captions).toEqual([
      { text: "Updated", startMs: 200, endMs: 400 },
      { text: "subtitle", startMs: 400, endMs: 600 },
      { text: "text", startMs: 600, endMs: 800 },
    ]);
  });

  it("creates word timings when an imported cue is edited", () => {
    const nextCue = syncSubtitleCue(
      { text: "Original text", startMs: 100, endMs: 900 },
      { text: "Edited cue text", startMs: 100, endMs: 900 },
    );

    expect(nextCue.captions).toEqual([
      { text: "Edited", startMs: 100, endMs: 367 },
      { text: "cue", startMs: 367, endMs: 633 },
      { text: "text", startMs: 633, endMs: 900 },
    ]);
  });

  it("moves generated word timings with the cue", () => {
    const nextCue = syncSubtitleCue(
      {
        text: "Move this",
        startMs: 100,
        endMs: 500,
        captions: [
          { text: "Move", startMs: 100, endMs: 300 },
          { text: "this", startMs: 300, endMs: 500 },
        ],
      },
      { text: "Move this", startMs: 600, endMs: 1000 },
    );

    expect(nextCue.captions).toEqual([
      { text: "Move", startMs: 600, endMs: 800 },
      { text: "this", startMs: 800, endMs: 1000 },
    ]);
  });

  it("keeps manually edited word timings when the cue text matches them", () => {
    const nextCue = syncSubtitleCue(
      {
        text: "Keep timing",
        startMs: 0,
        endMs: 1000,
        captions: [
          { text: "Keep", startMs: 0, endMs: 300 },
          { text: "timing", startMs: 300, endMs: 1000 },
        ],
      },
      {
        text: "Keep timing",
        startMs: 0,
        endMs: 1000,
        captions: [
          { text: "Keep", startMs: 0, endMs: 700 },
          { text: "timing", startMs: 700, endMs: 1000 },
        ],
      },
    );

    expect(nextCue.captions[0].endMs).toBe(700);
  });

  it("renders locally with the same Remotion/WebCodecs composition", async () => {
    renderInBrowser.mockResolvedValue("blob:rendered-mp4");

    const outputUrl = await renderLocalVideoOnBrowser({
      videoUrl: "blob:source",
      durationSeconds: 2,
      fps: 25,
      width: 608,
      height: 1080,
      subtitleCues: [{ text: "Hello", startMs: 0, endMs: 1000 }],
      subtitleStyle: { position: "bottom" },
      onProgress: vi.fn(),
    });

    expect(outputUrl).toBe("blob:rendered-mp4");
    expect(renderInBrowser).toHaveBeenCalledWith(
      expect.objectContaining({
        videoUrl: "blob:source",
        durationInSeconds: 2,
        fps: 25,
        width: 608,
        height: 1080,
        subtitles: expect.objectContaining({
          captions: [{ text: "Hello", startMs: 0, endMs: 1000 }],
        }),
      }),
    );
  });

  it("falls back to the native backend renderer for unsupported browser codecs", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ renderId: "render-1", jobId: "local-editor-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "done",
          progress: 100,
          outputUrl: "/output/local-editor-1/render.mp4",
        }),
      });
    const outputUrl = await renderLocalVideoOnBackend({
      file: new File(["video"], "source.mp4", { type: "video/mp4" }),
      durationSeconds: 2,
      width: 608,
      height: 1080,
      pollMs: 0,
      fetchImpl,
    });

    expect(outputUrl).toBe("/output/local-editor-1/render.mp4");
    expect(fetchImpl.mock.calls[0][1].body).toBeInstanceOf(FormData);
  });

  it("uses the project backend render path without downloading the source", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ renderId: "render-1", status: "queued" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "done",
          progress: 100,
          outputUrl: "/output/job-1/render.mp4",
        }),
      });

    const outputUrl = await renderLocalVideoOnBackend({
      sourceUrl: "https://minio.example/openshorts-media/job-1/clips/clip.mp4",
      jobId: "job-1",
      clipIndex: 2,
      durationSeconds: 2,
      fps: 60,
      width: 1080,
      height: 1920,
      pollMs: 0,
      fetchImpl,
    });

    expect(outputUrl).toBe("/output/job-1/render.mp4");
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/render");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      jobId: "job-1",
      clipIndex: 2,
      props: {
        videoUrl: "https://minio.example/openshorts-media/job-1/clips/clip.mp4",
        fps: 60,
      },
    });
  });

  it("renders imported and edited cues through the native Remotion path once", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ renderId: "render-1", jobId: "local-editor-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "done",
          progress: 100,
          outputUrl: "/output/local-editor-1/render.mp4",
        }),
      });

    const outputUrl = await burnLocalEditorSubtitles({
      file: new File(["video"], "source.mp4", { type: "video/mp4" }),
      durationSeconds: 2,
      width: 608,
      height: 1080,
      subtitleCues: [
        { text: "Do I need to undress?", startMs: 0, endMs: 1000 },
      ],
      subtitleStyle: {
        position: "bottom",
        fontFamily: "Verdana",
        fontSize: 24,
      },
      pollMs: 0,
      fetchImpl,
    });

    expect(outputUrl).toBe("/output/local-editor-1/render.mp4");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(fetchImpl.mock.calls[0][1].body.get("props")).subtitles.blocks,
    ).toEqual([
      {
        words: [{ text: "Do I need to undress?", startMs: 0, endMs: 1000 }],
        startMs: 0,
        endMs: 1000,
        text: "Do I need to undress?",
      },
    ]);
  });

  it("uses the Clip Generator Remotion path for word-timed generated cues", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ renderId: "render-1", jobId: "local-editor-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "done",
          progress: 100,
          outputUrl: "/output/local-editor-1/render.mp4",
        }),
      });

    const outputUrl = await burnLocalEditorSubtitles({
      file: new File(["video"], "source.mp4", { type: "video/mp4" }),
      durationSeconds: 2,
      width: 608,
      height: 1080,
      subtitleCues: [
        {
          text: "Do I",
          startMs: 0,
          endMs: 800,
          captions: [
            { text: "Do", startMs: 0, endMs: 400 },
            { text: "I", startMs: 400, endMs: 800 },
          ],
        },
      ],
      pollMs: 0,
      fetchImpl,
    });

    expect(outputUrl).toBe("/output/local-editor-1/render.mp4");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(fetchImpl.mock.calls[0][1].body.get("props")).subtitles
        .captions,
    ).toEqual([
      { text: "Do", startMs: 0, endMs: 400 },
      { text: "I", startMs: 400, endMs: 800 },
    ]);
  });
});
