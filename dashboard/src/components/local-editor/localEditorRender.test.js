import { describe, expect, it, vi } from "vitest";
import { renderInBrowser } from "../../lib/renderInBrowser";
import {
  buildRemotionRenderProps,
  burnLocalEditorSubtitles,
  cleanSubtitleCue,
  cueCaptionsForRender,
  renderLocalVideoOnBackend,
  renderLocalVideoOnBrowser,
  resolveProjectExportStartSeconds,
  syncSubtitleCue,
} from "./localEditorRender";

vi.mock("../../lib/renderInBrowser", () => ({ renderInBrowser: vi.fn() }));

describe("local editor Remotion rendering", () => {
  it("uses the master clip offset but not for an already-trimmed source clip", () => {
    expect(
      resolveProjectExportStartSeconds(
        "https://minio.example/openshorts-media/job-1/master/source.mp4",
        1686,
      ),
    ).toBe(1686);
    expect(
      resolveProjectExportStartSeconds(
        "https://minio.example/openshorts-media/job-1/clips/render-1/source_clip_4.mp4",
        1686,
      ),
    ).toBe(0);
  });

  it("prefers the active editor trim over stale clip metadata", () => {
    expect(
      resolveProjectExportStartSeconds(
        "https://minio.example/openshorts-media/job-1/master/source.mp4",
        1686,
        962,
      ),
    ).toBe(962);
  });

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

  it("preserves local editor subtitle styles in the render contract", () => {
    const props = buildRemotionRenderProps({
      durationSeconds: 6,
      fps: 25,
      width: 608,
      height: 1080,
      subtitleCues: [{ text: "Hello", startMs: 500, endMs: 1500 }],
      subtitleStyle: {
        position: "custom",
        positionX: 600.6,
        positionY: -20,
        fontFamily: "Verdana",
        fontSize: 24,
      },
      hook: {
        text: "Hook",
        startMs: 0,
        endMs: 2000,
        size: "M",
        entranceAnimation: "fade",
        color: "#FFFFFF",
        background: "#111111",
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 48,
        layoutFormat: "standard",
        facecamSize: "medium",
        position: "custom",
        positionX: 600.6,
        positionY: -20,
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
    expect(props.subtitles.blocks).toBeUndefined();
    expect(props.subtitles.style).toMatchObject({
      fontFamily: "Verdana",
      fontSize: 24,
      borderWidth: 2,
    });
    expect(props.subtitles).toMatchObject({
      position: "custom",
      positionX: 601,
      positionY: 0,
    });
    expect(props.hook).toMatchObject({
      text: "Hook",
      displayDurationSec: 2,
      position: "custom",
      color: "#FFFFFF",
      background: "#111111",
      fontFamily: "Arial, Helvetica, sans-serif",
      fontSize: 48,
      layoutFormat: "standard",
      facecamSize: "medium",
      positionX: 601,
      positionY: 0,
    });
  });

  it("preserves layout segments in local render props", () => {
    const segments = [
      {
        id: "layout-1",
        startMs: 0,
        endMs: 1000,
        format: "standard",
        transition: "cut",
        transitionDurationMs: 250,
      },
      {
        id: "layout-2",
        startMs: 1000,
        endMs: 2000,
        format: "streamer_stack",
        transition: "crossfade",
        transitionDurationMs: 250,
      },
    ];
    expect(
      buildRemotionRenderProps({
        durationSeconds: 2,
        width: 608,
        height: 1080,
        layout: { format: "standard", segments },
      }).layout,
    ).toEqual({ format: "standard", segments });
  });

  it("leaves subtitle block grouping to the renderer for word-level cues", () => {
    const props = buildRemotionRenderProps({
      durationSeconds: 2,
      fps: 25,
      width: 608,
      height: 1080,
      subtitleCues: [
        { text: "Hello", startMs: 0, endMs: 400 },
        { text: "world", startMs: 400, endMs: 800 },
      ],
      subtitleStyle: { displayMode: "phrase" },
    });

    expect(props.subtitles.blocks).toBeUndefined();
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
    expect(props.subtitles.blocks).toBeUndefined();
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

  it("moves stale nested caption timings into the edited cue range", () => {
    expect(
      cueCaptionsForRender({
        text: "Oh,",
        startMs: 16678,
        endMs: 17078,
        captions: [{ text: "Oh,", startMs: 17500, endMs: 17900 }],
      }),
    ).toEqual([{ text: "Oh,", startMs: 16678, endMs: 17078 }]);
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
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/render/render-1");
  });

  it("keeps backend export progress below 100 until rendering is done", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ renderId: "render-1", jobId: "local-editor-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "rendering", progress: 100 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "done",
          progress: 100,
          outputUrl: "/output/local-editor-1/render.mp4",
        }),
      });
    const progress = [];

    await renderLocalVideoOnBackend({
      file: new File(["video"], "source.mp4", { type: "video/mp4" }),
      durationSeconds: 2,
      width: 608,
      height: 1080,
      pollMs: 0,
      fetchImpl,
      onProgress: (value) => progress.push(value),
    });

    expect(progress).toEqual([0.99, 1]);
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
      videoStartSeconds: 1686,
      width: 1080,
      height: 1920,
      pollMs: 0,
      fetchImpl,
    });

    expect(outputUrl).toBe("/output/job-1/render.mp4");
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/render");
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/render/render-1");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      jobId: "job-1",
      clipIndex: 2,
      props: {
        videoUrl: "https://minio.example/openshorts-media/job-1/clips/clip.mp4",
        fps: 60,
        videoStartSeconds: 1686,
      },
    });
  });

  it("keeps the published MinIO URL returned by the backend", async () => {
    const publishedUrl =
      "http://minio.example/openshorts-media/job-1/clips/render-1/remotion.mp4";
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
          outputUrl: publishedUrl,
        }),
      });

    const outputUrl = await renderLocalVideoOnBackend({
      file: new File(["video"], "source.mp4", { type: "video/mp4" }),
      durationSeconds: 2,
      pollMs: 0,
      fetchImpl,
    });

    expect(outputUrl).toBe(publishedUrl);
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
      videoStartSeconds: 962,
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
      JSON.parse(fetchImpl.mock.calls[0][1].body.get("props")),
    ).toMatchObject({ videoStartSeconds: 962 });
    expect(
      JSON.parse(fetchImpl.mock.calls[0][1].body.get("props")).subtitles.blocks,
    ).toBeUndefined();
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
