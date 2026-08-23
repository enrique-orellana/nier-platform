import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FullScreenEditor from "./FullScreenEditor";
import { resolveLocalEditorSourceUrl } from "./fullScreenEditorSource";
import { SUBTITLE_STYLE_TEMPLATES } from "../local-editor/localEditorStyles";

const renderVersionMocks = vi.hoisted(() => ({
  saveDraftVersion: vi.fn(),
  saveAndRenderVersion: vi.fn(),
}));
vi.mock("../../editor/renderVersion", () => renderVersionMocks);
vi.mock("../../components/RemotionPreview", () => ({
  default: ({
    currentFrame = 0,
    durationInSeconds,
    videoUrl,
    videoStartSeconds = 0,
    layout = null,
  }) => (
    <div
      data-testid="remotion-player-frame"
      data-duration={durationInSeconds}
      data-video-url={videoUrl}
      data-video-start-seconds={videoStartSeconds}
      data-layout-format={layout?.format || ""}
    >
      {currentFrame}
    </div>
  ),
}));

const manifest = {
  timeline: {
    source_video_url: "https://example.test/video.mp4",
    trim: { start_sec: 0, end_sec: 10 },
  },
  layers: {
    hook: { text: "Original hook", startMs: 1000, endMs: 3000 },
    subtitles: null,
    effects: null,
  },
  subtitle_tracks: [
    {
      id: "original",
      label: "Original",
      language: "es",
      cues: [{ text: "Hola", startMs: 1000, endMs: 2000 }],
    },
  ],
};

describe("FullScreenEditor", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "open",
      vi.fn(() => null),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    renderVersionMocks.saveDraftVersion.mockReset();
    renderVersionMocks.saveAndRenderVersion.mockReset();
  });

  it("shows a loading screen while a direct-link editor is loading", async () => {
    let resolveHistory;
    const historyResponse = new Promise((resolve) => {
      resolveHistory = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((url) => {
        if (String(url).endsWith("/versions")) return historyResponse;
        if (String(url).endsWith("/versions/v1"))
          return Promise.resolve({
            ok: true,
            json: async () => ({
              version: { version_id: "v1", status: "done" },
              manifest,
            }),
          });
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({}),
        });
      }),
    );

    render(
      <FullScreenEditor
        jobId="job"
        clipIndex={0}
        clip={{ output_fps: 30, video_url: manifest.timeline.source_video_url }}
      />,
    );

    expect(
      screen.getByRole("status", { name: "Loading editor" }),
    ).toBeInTheDocument();

    resolveHistory({
      ok: true,
      json: async () => ({
        current_version_id: "v1",
        versions: [{ version_id: "v1", status: "done" }],
      }),
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Export Video" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("status", { name: "Loading editor" }),
    ).not.toBeInTheDocument();
  });

  it("uses the renewed master URL for local editor media", () => {
    expect(
      resolveLocalEditorSourceUrl({
        refreshedMasterVideoUrl:
          "https://minio.example/master/source.mp4?X-Amz-Date=fresh",
        clip: {
          video_url: "https://minio.example/master/source.mp4?X-Amz-Date=stale",
          source_video_url:
            "https://minio.example/master/source.mp4?X-Amz-Date=stale",
        },
        projectManifest: {
          timeline: {
            source_video_url:
              "https://minio.example/master/source.mp4?X-Amz-Date=manifest-stale",
          },
        },
      }),
    ).toBe("https://minio.example/master/source.mp4?X-Amz-Date=fresh");
  });

  it("prefers a project source URL over the generated clip URL", () => {
    expect(
      resolveLocalEditorSourceUrl({
        clip: {
          video_url:
            "https://minio.example/openshorts-media/job/clips/clip-1/source_clip_14.mp4?X-Amz-Date=stale",
          source_video_url:
            "https://minio.example/openshorts-media/job/master/source.mp4?X-Amz-Date=fresh",
        },
      }),
    ).toBe(
      "https://minio.example/openshorts-media/job/master/source.mp4?X-Amz-Date=fresh",
    );
  });

  it("deletes the selected version and loads the newest remaining version", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      const value = String(url);
      if (value.endsWith("/versions") && !options.method) {
        return {
          ok: true,
          json: async () => ({
            current_version_id: "v2",
            versions: [
              { version_id: "v1", status: "done" },
              { version_id: "v2", status: "done" },
            ],
          }),
        };
      }
      if (value.endsWith("/versions/v2") && options.method === "DELETE") {
        return {
          ok: true,
          json: async () => ({
            current_version_id: "v1",
            deleted_version: { version_id: "v2" },
          }),
        };
      }
      if (value.endsWith("/versions/v2") || value.endsWith("/versions/v1")) {
        const versionId = value.endsWith("/versions/v2") ? "v2" : "v1";
        return {
          ok: true,
          json: async () => ({
            version: { version_id: versionId, status: "done" },
            manifest: {
              ...manifest,
              subtitle_tracks: [{ id: "original", cues: [] }],
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );

    render(
      <FullScreenEditor
        jobId="job"
        clipIndex={0}
        clip={{ output_fps: 30, video_url: manifest.timeline.source_video_url }}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /delete version v2/i }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/clip/job/0/versions/v2",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    expect(await screen.findByText(/v1/)).toBeInTheDocument();
  });

  it("replaces the editor with every saved field when switching versions", async () => {
    const versionOne = {
      version_id: "version-1",
      status: "done",
      output_url: "/videos/job/v1.mp4",
    };
    const versionTwo = {
      version_id: "version-2",
      status: "done",
      output_url: "/videos/job/v2.mp4",
    };
    const versionOneManifest = {
      timeline: {
        source_video_url: "/videos/job/source.mp4",
        trim: { start_sec: 3, end_sec: 13 },
        transcript: { segments: [{ text: "one" }] },
      },
      render_spec: {
        video_start_seconds: 3,
        duration_in_frames: 300,
        fps: 30,
        width: 1080,
        height: 1920,
        video_fit: "cover",
      },
      subtitle_tracks: [
        {
          id: "en",
          language: "en",
          style: { fontSize: 20 },
          cues: [{ text: "Hello", startMs: 0, endMs: 800 }],
        },
      ],
      active_subtitle_track_id: "en",
      layers: {
        layout: { format: "standard", facecam_size: "medium" },
        hook: {
          text: "Old hook",
          color: "#FF0000",
          fontSize: 48,
          background: "#111111",
          size: "M",
        },
        effects: { segments: [{ startSec: 0, endSec: 1 }] },
        audio: { tracks: [{ id: "old-audio" }] },
      },
      publishing_metadata: { hashtags: ["#old"] },
    };
    const versionTwoManifest = {
      timeline: {
        source_video_url: "/videos/job/source.mp4",
        trim: { start_sec: 7, end_sec: 14 },
        transcript: { segments: [{ text: "two" }] },
      },
      render_spec: {
        video_start_seconds: 7,
        duration_in_frames: 168,
        fps: 24,
        width: 720,
        height: 1280,
        video_fit: "contain",
      },
      subtitle_tracks: [
        {
          id: "es",
          language: "es",
          style: { fontSize: 42 },
          cues: [{ text: "Hola", startMs: 100, endMs: 900 }],
        },
      ],
      active_subtitle_track_id: "es",
      layers: {
        layout: { format: "streamer_stack", facecam_size: "large" },
        hook: {
          text: "New hook",
          color: "#00FFAA",
          fontSize: 72,
          background: "#222222",
          size: "L",
        },
        effects: { segments: [{ startSec: 2, endSec: 4, zoom: 1.2 }] },
        audio: { tracks: [{ id: "new-audio" }] },
      },
      publishing_metadata: { hashtags: ["#new"] },
    };
    const fetchMock = vi.fn(async (url) => {
      const value = String(url);
      if (value.endsWith("/versions") && !value.endsWith("/version-1"))
        return {
          ok: true,
          json: async () => ({
            current_version_id: versionOne.version_id,
            versions: [versionOne, versionTwo],
          }),
        };
      if (value.endsWith("/manifest"))
        return { ok: false, status: 404, json: async () => ({}) };
      if (value.endsWith("/version-1"))
        return {
          ok: true,
          json: async () => ({
            version: versionOne,
            manifest: versionOneManifest,
          }),
        };
      if (value.endsWith("/version-2"))
        return {
          ok: true,
          json: async () => ({
            version: versionTwo,
            manifest: versionTwoManifest,
          }),
        };
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    let session;
    render(
      <FullScreenEditor
        useLocalEditor
        jobId="job"
        clipIndex={0}
        clip={{ output_fps: 30, video_url: "/videos/job/source.mp4" }}
        onSessionReady={(nextSession) => {
          session = nextSession;
        }}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Old hook" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Old hook" }));
    fireEvent.click(
      screen.getAllByRole("button", { name: /vversio.*done/i })[1],
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "New hook" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "New hook" }));
    expect(screen.getByLabelText("Hook text")).toHaveValue("New hook");
    expect(screen.getByLabelText("Hook text color")).toHaveValue("#00ffaa");
    expect(screen.getByLabelText("Hook font size")).toHaveValue(72);
    expect(screen.getByLabelText("Hook background")).toHaveValue("#222222");
    expect(screen.getByTestId("remotion-player-frame")).toHaveAttribute(
      "data-duration",
      "7",
    );
    expect(screen.getByTestId("remotion-player-frame")).toHaveAttribute(
      "data-video-start-seconds",
      "7",
    );
    expect(screen.getByRole("group", { name: "Hashtags" })).toHaveTextContent(
      "#new",
    );
    expect(session.getManifest()).toMatchObject({
      active_subtitle_track_id: "es",
      layers: {
        layout: { format: "streamer_stack", facecam_size: "large" },
        effects: { segments: [{ startSec: 2, endSec: 4, zoom: 1.2 }] },
        audio: { tracks: [{ id: "new-audio" }] },
      },
    });
  });

  it.skip("renders the editor workspace and advances the preview one frame", () => {
    render(
      <FullScreenEditor
        jobId="job"
        clipIndex={0}
        clip={{
          output_fps: 30,
          output_width: 1080,
          output_height: 1920,
          video_url: manifest.timeline.source_video_url,
        }}
        initialManifest={manifest}
        initialVersion={{ version_id: "v1", status: "done" }}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /media pool/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /timeline/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Subtitle translation")).toBeInTheDocument();
    expect(
      screen.getByText(/starts at the current playhead/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/nothing selected/i)).toBeInTheDocument();
    expect(
      screen.getByText(/select a clip or cue in the timeline/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /next frame/i }));
    expect(screen.getByTestId("remotion-player-frame")).toHaveTextContent("1");
  });

  it.skip("starts an unrendered master preview at the clip source offset", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const value = String(url);
        if (value.endsWith("/versions"))
          return {
            ok: true,
            json: async () => ({ current_version_id: "", versions: [] }),
          };
        return { ok: false, status: 404, json: async () => ({}) };
      }),
    );

    render(
      <FullScreenEditor
        useLocalEditor
        jobId="job"
        clipIndex={12}
        clip={{
          output_fps: 60,
          source_video_url: "https://minio.example/master/source.mp4",
          start: 579.082,
          end: 631.35,
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId("remotion-player-frame")).toHaveAttribute(
      "data-video-url",
      "https://minio.example/master/source.mp4",
    );
    expect(screen.getByTestId("remotion-player-frame")).toHaveAttribute(
      "data-video-start-seconds",
      "579.082",
    );
  });

  it.skip("connects timeline selection to hook and subtitle inspectors", () => {
    render(
      <FullScreenEditor
        jobId="job"
        clipIndex={0}
        clip={{
          output_fps: 30,
          output_width: 1080,
          output_height: 1920,
          video_url: manifest.timeline.source_video_url,
        }}
        initialManifest={manifest}
        initialVersion={{ version_id: "v1", status: "done" }}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Original hook clip" }));
    expect(screen.getByLabelText("Text")).toHaveValue("Original hook");
    fireEvent.click(screen.getByRole("button", { name: "Hola clip" }));
    expect(screen.getByRole("option", { name: "English" })).toBeInTheDocument();
    expect(screen.getByLabelText("Subtitle translation")).toBeInTheDocument();
  });

  it.skip("keeps inspector subtitle text edits in the selected cue", () => {
    render(
      <FullScreenEditor
        jobId="job"
        clipIndex={0}
        clip={{
          output_fps: 30,
          output_width: 1080,
          output_height: 1920,
          video_url: manifest.timeline.source_video_url,
        }}
        initialManifest={manifest}
        initialVersion={{ version_id: "v1", status: "done" }}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Hola clip" }));
    const text = screen.getByLabelText("Text");
    fireEvent.change(text, { target: { value: "Piano corrected" } });
    expect(text).toHaveValue("Piano corrected");
    expect(
      screen.getByRole("button", { name: "Piano corrected clip" }),
    ).toBeInTheDocument();
  });

  it.skip("deletes the selected subtitle cue from the timeline", () => {
    render(
      <FullScreenEditor
        jobId="job"
        clipIndex={0}
        clip={{
          output_fps: 30,
          output_width: 1080,
          output_height: 1920,
          video_url: manifest.timeline.source_video_url,
        }}
        initialManifest={manifest}
        initialVersion={{ version_id: "v1", status: "done" }}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Hola clip" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Delete subtitle cue" }),
    );
    expect(
      screen.queryByRole("button", { name: "Hola clip" }),
    ).not.toBeInTheDocument();
  });

  it.skip("deletes a translated subtitle track while keeping the original", () => {
    const translatedManifest = {
      ...manifest,
      subtitle_tracks: [
        ...manifest.subtitle_tracks,
        {
          id: "en",
          label: "EN",
          language: "en",
          origin: "translation",
          cues: [{ text: "Hello", startMs: 1000, endMs: 2000 }],
        },
      ],
    };
    render(
      <FullScreenEditor
        jobId="job"
        clipIndex={0}
        clip={{
          output_fps: 30,
          output_width: 1080,
          output_height: 1920,
          video_url: manifest.timeline.source_video_url,
        }}
        initialManifest={translatedManifest}
        initialVersion={{ version_id: "v1", status: "done" }}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete EN translation" }),
    );
    expect(
      screen.queryByRole("button", { name: "EN" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Original" }),
    ).toBeInTheDocument();
  });

  it.skip("adds a new translated subtitle track to the current draft", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            translationId: "translation-1",
            status: "queued",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            translationId: "translation-1",
            status: "done",
            track: {
              id: "en",
              label: "EN",
              language: "en",
              origin: "translation",
              cues: [{ text: "Hello", startMs: 1000, endMs: 2000 }],
            },
          }),
        }),
    );
    render(
      <FullScreenEditor
        jobId="job"
        clipIndex={0}
        clip={{
          output_fps: 30,
          output_width: 1080,
          output_height: 1920,
          video_url: manifest.timeline.source_video_url,
        }}
        initialManifest={manifest}
        initialVersion={{ version_id: "v1", status: "done" }}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Translate entire track" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "EN" })).toBeInTheDocument(),
    );
  });

  it.skip("adds a subtitle cue at the current playhead and selects it", () => {
    render(
      <FullScreenEditor
        jobId="job"
        clipIndex={0}
        clip={{
          output_fps: 30,
          output_width: 1080,
          output_height: 1920,
          video_url: manifest.timeline.source_video_url,
        }}
        initialManifest={manifest}
        initialVersion={{ version_id: "v1", status: "done" }}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /next frame/i }));
    fireEvent.click(screen.getByRole("button", { name: "Add subtitle cue" }));
    const text = screen.getByLabelText("Text");
    expect(text).toHaveValue("");
    fireEvent.change(text, { target: { value: "Manual cue" } });
    expect(
      screen.getByRole("button", { name: "Manual cue clip" }),
    ).toBeInTheDocument();
  });

  it.skip("keeps cue creation available while another editor item is selected", () => {
    render(
      <FullScreenEditor
        jobId="job"
        clipIndex={0}
        clip={{
          output_fps: 30,
          output_width: 1080,
          output_height: 1920,
          video_url: manifest.timeline.source_video_url,
        }}
        initialManifest={manifest}
        initialVersion={{ version_id: "v1", status: "done" }}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Original hook clip" }));
    expect(
      screen.getByRole("button", { name: "Add subtitle cue" }),
    ).toBeInTheDocument();
  });

  it("renders the complete action toolbar when opened from a result card", () => {
    const editorActions = Object.fromEntries(
      [
        "onAutoEdit",
        "onConvertNativeShort",
        "onSubtitles",
        "onViralHook",
        "onDubVoice",
        "onPost",
        "onDownload",
      ].map((name) => [name, vi.fn()]),
    );
    render(
      <FullScreenEditor
        jobId="job"
        clipIndex={0}
        clip={{ output_fps: 30, video_url: manifest.timeline.source_video_url }}
        initialManifest={manifest}
        initialVersion={{ version_id: "v1", status: "done" }}
        editorActions={editorActions}
        onClose={vi.fn()}
      />,
    );
    const actionsRegion = screen.getByRole("region", {
      name: "Editor actions",
    });
    expect(actionsRegion).toBeInTheDocument();
    expect(actionsRegion.closest("aside")).toHaveAttribute(
      "aria-label",
      "Inspector",
    );
    expect(
      screen.getByRole("button", { name: "Auto Edit" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Download" }),
    ).toBeInTheDocument();
  });

  it("uses the local editor workspace while retaining project actions and version history", async () => {
    let session = null;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => "blob:project-video"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(["video"], { type: "video/mp4" }),
      }),
    );
    render(
      <FullScreenEditor
        useLocalEditor
        jobId="job"
        clipIndex={0}
        clip={{ output_fps: 30, video_url: manifest.timeline.source_video_url }}
        initialManifest={manifest}
        initialVersion={{ version_id: "v1", status: "done" }}
        editorActions={Object.fromEntries(
          [
            "onAutoEdit",
            "onConvertNativeShort",
            "onSubtitles",
            "onViralHook",
            "onDubVoice",
            "onPost",
            "onDownload",
          ].map((name) => [name, vi.fn()]),
        )}
        onSessionReady={(nextSession) => {
          if (nextSession) session = nextSession;
        }}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle subtitles settings/i }),
      ).toBeInTheDocument(),
    );
    const actionsRegion = screen.getByRole("region", {
      name: "Editor actions",
    });
    expect(actionsRegion).toBeInTheDocument();
    expect(actionsRegion.closest("aside")).toHaveAttribute(
      "aria-label",
      "Inspector",
    );
    expect(screen.getByText(/version history/i)).toBeInTheDocument();
    expect(screen.getByTestId("remotion-player-frame")).toHaveAttribute(
      "data-layout-format",
      "standard",
    );
    expect(
      screen.getByRole("button", { name: /save as new version/i }),
    ).toBeInTheDocument();
    expect(session).toBeTruthy();
  });

  it("loads legacy project subtitles into the local editor timeline", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => "blob:legacy-project-video"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(["video"], { type: "video/mp4" }),
      }),
    );
    const legacyManifest = {
      timeline: {
        source_video_url: "https://example.test/video.mp4",
        trim: { start_sec: 0, end_sec: 4 },
      },
      layers: {
        subtitles: { cues: [{ text: "Hola", startMs: 500, endMs: 1500 }] },
      },
    };

    render(
      <FullScreenEditor
        useLocalEditor
        jobId="job"
        clipIndex={0}
        clip={{
          output_fps: 30,
          video_url: legacyManifest.timeline.source_video_url,
        }}
        initialManifest={legacyManifest}
        initialVersion={{ version_id: "v1", status: "done" }}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("local-editor-subtitles-track"),
      ).toHaveTextContent("Hola"),
    );
  });

  it("streams the rendered clip instead of downloading the source video", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("/api/projects/clips/job?refresh=true")) {
        return {
          ok: true,
          json: async () => ({
            clips: [{ source_video_url: "/videos/job/source.mp4" }],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const localManifest = {
      timeline: {
        source_video_url: "",
        trim: { start_sec: 34.2, end_sec: 60.64 },
      },
      layers: {},
      subtitle_tracks: [],
    };

    render(
      <FullScreenEditor
        useLocalEditor
        jobId="job"
        clipIndex={0}
        clip={{
          output_fps: 30,
          video_url: "/videos/job/source_clip_1.mp4",
          source_video_url: "/videos/job/source.mp4",
        }}
        initialManifest={localManifest}
        initialVersion={{ version_id: "v1", status: "done" }}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle subtitles settings/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /toggle subtitles settings/i }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("remotion-player-frame")).toHaveAttribute(
      "data-video-url",
      "/videos/job/source_clip_1.mp4",
    );
    expect(screen.getByTestId("remotion-player-frame")).toHaveAttribute(
      "data-video-start-seconds",
      "0",
    );
    expect(
      screen.getByRole("button", { name: /generate subtitles/i }),
    ).not.toBeDisabled();
    expect(screen.getAllByText(/00:00:00:00/)).toHaveLength(1);
  });

  it("refreshes the direct MinIO master URL for the project preview", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("/api/media-url?url=")) {
        return {
          ok: true,
          json: async () => ({
            url: "https://minio.example/master/source.mp4?X-Amz-Date=fresh",
            expiresAt: "2026-08-23T06:00:00.000Z",
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <FullScreenEditor
        useLocalEditor
        jobId="job"
        clipIndex={0}
        clip={{
          output_fps: 30,
          video_url: "https://minio.example/master/source.mp4?X-Amz-Date=stale",
          source_video_url:
            "https://minio.example/master/source.mp4?X-Amz-Date=stale",
        }}
        initialManifest={{
          timeline: {
            source_video_url:
              "https://minio.example/master/source.mp4?X-Amz-Date=stale",
            trim: { start_sec: 0, end_sec: 10 },
          },
          layers: {},
          subtitle_tracks: [],
        }}
        initialVersion={{ version_id: "v1", status: "done" }}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("remotion-player-frame")).toHaveAttribute(
        "data-video-url",
        "https://minio.example/master/source.mp4?X-Amz-Date=fresh",
      ),
    );
  });

  it("shows the current source while a presigned URL refresh is pending", async () => {
    const staleUrl =
      "https://minio.example/master/source.mp4?X-Amz-Date=20200101T000000Z&X-Amz-Expires=60";
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );

    render(
      <FullScreenEditor
        useLocalEditor
        jobId="job"
        clipIndex={0}
        clip={{
          output_fps: 30,
          video_url: staleUrl,
          source_video_url: staleUrl,
        }}
        initialManifest={{
          timeline: {
            source_video_url: staleUrl,
            trim: { start_sec: 0, end_sec: 10 },
          },
          layers: {},
          subtitle_tracks: [],
        }}
        initialVersion={{ version_id: "v1", status: "done" }}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("remotion-player-frame")).toHaveAttribute(
        "data-video-url",
        staleUrl,
      ),
    );
  });

  it("keeps a still-valid direct MinIO URL stable for browser caching", async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
    const cachedUrl = `https://minio.example/master/source.mp4?X-Amz-Date=${expiresAt}&X-Amz-Expires=7200`;
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <FullScreenEditor
        useLocalEditor
        jobId="job"
        clipIndex={0}
        clip={{
          output_fps: 30,
          video_url: cachedUrl,
          source_video_url: cachedUrl,
        }}
        initialManifest={{
          timeline: {
            source_video_url: cachedUrl,
            trim: { start_sec: 0, end_sec: 10 },
          },
          layers: {},
          subtitle_tracks: [],
        }}
        initialVersion={{ version_id: "v1", status: "done" }}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("remotion-player-frame")).toHaveAttribute(
        "data-video-url",
        cachedUrl,
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves generated hashtags as soon as they are generated", async () => {
    renderVersionMocks.saveDraftVersion.mockResolvedValue({
      status: "saved",
      versionId: "v2",
      version: { version_id: "v2", status: "pending" },
      manifest,
    });
    const fetchMock = vi.fn((url) =>
      String(url).includes("/api/local-editor/hashtags")
        ? Promise.resolve({
            ok: true,
            json: async () => ({ hashtags: ["#editedclip"] }),
          })
        : Promise.resolve({
            ok: true,
            blob: async () => new Blob(["video"], { type: "video/mp4" }),
          }),
    );
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => "blob:project-video"),
    });

    render(
      <FullScreenEditor
        useLocalEditor
        jobId="job"
        clipIndex={0}
        clip={{
          output_fps: 30,
          video_url: manifest.timeline.source_video_url,
          video_title_for_youtube_short: "Título",
          video_description_for_tiktok: "Caption",
        }}
        initialManifest={manifest}
        initialVersion={{ version_id: "v1", status: "done" }}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /generate hashtags/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /generate hashtags/i }));
    await waitFor(() =>
      expect(screen.getByRole("group", { name: "Hashtags" })).toHaveTextContent(
        "#editedclip",
      ),
    );
    await waitFor(() =>
      expect(renderVersionMocks.saveDraftVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          manifest: expect.objectContaining({
            publishing_metadata: { hashtags: ["#editedclip"] },
            subtitle_tracks: [
              expect.objectContaining({
                cues: [expect.objectContaining({ text: "Hola" })],
              }),
            ],
            layers: expect.objectContaining({
              layout: { format: "standard", facecam_size: "medium" },
            }),
          }),
        }),
      ),
    );
    expect(renderVersionMocks.saveAndRenderVersion).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/job/clips/0/metadata",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ hashtags: ["#editedclip"] }),
        }),
      ),
    );
  });

  it("persists generated hashtags after an earlier save finishes", async () => {
    let resolveFirstSave;
    renderVersionMocks.saveDraftVersion.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstSave = resolve;
        }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((url) =>
        String(url).includes("/api/local-editor/hashtags")
          ? Promise.resolve({
              ok: true,
              json: async () => ({ hashtags: ["#queued"] }),
            })
          : Promise.resolve({
              ok: true,
              blob: async () => new Blob(["video"], { type: "video/mp4" }),
            }),
      ),
    );
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => "blob:project-video"),
    });

    render(
      <FullScreenEditor
        useLocalEditor
        jobId="job"
        clipIndex={0}
        clip={{
          output_fps: 30,
          video_url: manifest.timeline.source_video_url,
          video_title_for_youtube_short: "Título",
          video_description_for_tiktok: "Caption",
        }}
        initialManifest={manifest}
        initialVersion={{ version_id: "v1", status: "done" }}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /save as new version/i }),
    );
    await waitFor(() =>
      expect(renderVersionMocks.saveDraftVersion).toHaveBeenCalledTimes(1),
    );

    fireEvent.click(screen.getByRole("button", { name: /generate hashtags/i }));
    await waitFor(() =>
      expect(screen.getByRole("group", { name: "Hashtags" })).toHaveTextContent(
        "#queued",
      ),
    );

    resolveFirstSave({
      status: "saved",
      versionId: "v2",
      version: { version_id: "v2", status: "pending" },
      manifest,
    });

    await waitFor(() =>
      expect(renderVersionMocks.saveDraftVersion).toHaveBeenCalledTimes(2),
    );
    expect(
      renderVersionMocks.saveDraftVersion.mock.calls[1][0].manifest,
    ).toEqual(
      expect.objectContaining({
        publishing_metadata: { hashtags: ["#queued"] },
      }),
    );
  });

  it("shows and clears the local editor render-ready badge", async () => {
    renderVersionMocks.saveAndRenderVersion.mockResolvedValue({
      status: "done",
      outputUrl: "/videos/job/generated.mp4",
      version: { version_id: "v2", status: "done" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          blob: async () => new Blob(["video"], { type: "video/mp4" }),
        }),
      ),
    );
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => "blob:project-video"),
    });

    render(
      <FullScreenEditor
        useLocalEditor
        jobId="job"
        clipIndex={0}
        clip={{ output_fps: 30, video_url: manifest.timeline.source_video_url }}
        initialManifest={manifest}
        initialVersion={{ version_id: "v1", status: "done" }}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Export Video" }),
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("version-render-ready-badge"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /v2 done current/i }),
    ).toBeInTheDocument();
    const historyToggle = screen.getByRole("button", {
      name: /version history/i,
    });
    fireEvent.click(historyToggle);
    fireEvent.click(historyToggle);
    expect(
      screen.queryByTestId("version-render-ready-badge"),
    ).not.toBeInTheDocument();
  });

  it("preserves local subtitle timeline edits when saving and exporting versions", async () => {
    let session = null;
    renderVersionMocks.saveDraftVersion.mockResolvedValue({
      status: "saved",
      versionId: "v2",
      version: { version_id: "v2", status: "pending" },
      manifest,
    });
    renderVersionMocks.saveAndRenderVersion.mockResolvedValue({
      status: "done",
      outputUrl: "/videos/job/v3.mp4",
      version: { version_id: "v3", status: "done" },
    });

    render(
      <FullScreenEditor
        useLocalEditor
        jobId="job"
        clipIndex={0}
        clip={{ output_fps: 30, video_url: manifest.timeline.source_video_url }}
        initialManifest={manifest}
        initialVersion={{ version_id: "v1", status: "done" }}
        onSessionReady={(nextSession) => {
          if (nextSession) session = nextSession;
        }}
        onClose={vi.fn()}
      />,
    );

    fireEvent.doubleClick(await screen.findByRole("button", { name: "Hola" }));
    fireEvent.change(
      await screen.findByRole("spinbutton", { name: "Subtitle start" }),
      { target: { value: "1500" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save cue" }));
    await waitFor(() => expect(session).toBeTruthy());
    await session.save();

    await waitFor(() =>
      expect(renderVersionMocks.saveDraftVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          parentVersionId: "v1",
          manifest: expect.objectContaining({
            subtitle_tracks: [
              expect.objectContaining({
                cues: [expect.objectContaining({ startMs: 1500 })],
              }),
            ],
          }),
        }),
      ),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Export Video" }),
    );
    await waitFor(() =>
      expect(renderVersionMocks.saveAndRenderVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          versionId: "v2",
          manifest: expect.objectContaining({
            subtitle_tracks: [
              expect.objectContaining({
                cues: [expect.objectContaining({ startMs: 1500 })],
              }),
            ],
          }),
        }),
      ),
    );
  });

  it("saves and renders a subtitle quick-pick style in the version manifest", async () => {
    const selectedTemplate = SUBTITLE_STYLE_TEMPLATES[0];
    let session = null;
    renderVersionMocks.saveDraftVersion.mockResolvedValue({
      status: "saved",
      versionId: "v2",
      version: { version_id: "v2", status: "pending" },
      manifest,
    });
    renderVersionMocks.saveAndRenderVersion.mockResolvedValue({
      status: "done",
      outputUrl: "/videos/job/v3.mp4",
      version: { version_id: "v3", status: "done" },
    });

    render(
      <FullScreenEditor
        useLocalEditor
        jobId="job"
        clipIndex={0}
        clip={{ output_fps: 30, video_url: manifest.timeline.source_video_url }}
        initialManifest={manifest}
        initialVersion={{ version_id: "v1", status: "done" }}
        onSessionReady={(nextSession) => {
          if (nextSession) session = nextSession;
        }}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: /toggle subtitles settings/i,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: selectedTemplate.ariaLabel }),
    );
    await waitFor(() => expect(session).toBeTruthy());
    await session.save();

    await waitFor(() =>
      expect(renderVersionMocks.saveDraftVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          manifest: expect.objectContaining({
            subtitle_tracks: [
              expect.objectContaining({ style: selectedTemplate.style }),
            ],
            layers: expect.objectContaining({
              subtitles: expect.objectContaining({
                style: selectedTemplate.style,
              }),
            }),
          }),
        }),
      ),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Export Video" }),
    );
    await waitFor(() =>
      expect(renderVersionMocks.saveAndRenderVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          manifest: expect.objectContaining({
            subtitle_tracks: [
              expect.objectContaining({ style: selectedTemplate.style }),
            ],
          }),
          props: expect.objectContaining({
            subtitles: expect.objectContaining({
              style: selectedTemplate.style,
            }),
          }),
        }),
      ),
    );
  });

  it("uses the latest saved draft from a stale export callback", async () => {
    let initialSession = null;
    renderVersionMocks.saveDraftVersion.mockResolvedValue({
      status: "saved",
      versionId: "v2",
      version: { version_id: "v2", status: "pending" },
      manifest,
    });
    renderVersionMocks.saveAndRenderVersion.mockResolvedValue({
      status: "done",
      outputUrl: "/videos/job/v3.mp4",
      version: { version_id: "v3", status: "done" },
    });

    render(
      <FullScreenEditor
        useLocalEditor
        jobId="job"
        clipIndex={0}
        clip={{ output_fps: 30, video_url: manifest.timeline.source_video_url }}
        initialManifest={manifest}
        initialVersion={{ version_id: "v1", status: "done" }}
        onSessionReady={(session) => {
          if (session && !initialSession) initialSession = session;
        }}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(initialSession).toBeTruthy());
    fireEvent.doubleClick(await screen.findByRole("button", { name: "Hola" }));
    fireEvent.change(
      await screen.findByRole("spinbutton", { name: "Subtitle start" }),
      { target: { value: "1500" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save cue" }));
    await initialSession.save();
    await waitFor(() =>
      expect(renderVersionMocks.saveDraftVersion).toHaveBeenCalled(),
    );

    await initialSession.export();
    expect(renderVersionMocks.saveAndRenderVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        versionId: "v2",
        manifest: expect.objectContaining({
          subtitle_tracks: [
            expect.objectContaining({
              cues: [expect.objectContaining({ startMs: 1500 })],
            }),
          ],
        }),
      }),
    );
  });

  it("restores saved hashtags from the version manifest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(["video"], { type: "video/mp4" }),
      }),
    );
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => "blob:saved-hashtags"),
    });

    render(
      <FullScreenEditor
        useLocalEditor
        jobId="job"
        clipIndex={0}
        clip={{
          output_fps: 30,
          video_url: manifest.timeline.source_video_url,
          video_title_for_youtube_short: "Título",
          video_description_for_tiktok: "Caption",
        }}
        initialManifest={{
          ...manifest,
          publishing_metadata: { hashtags: ["#savedtag"] },
        }}
        initialVersion={{ version_id: "v1", status: "done" }}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("group", { name: "Hashtags" })).toHaveTextContent(
        "#savedtag",
      ),
    );
    expect(screen.queryByText("#shorts")).not.toBeInTheDocument();
  });

  it("exposes a draft session that accumulates effects and optional subtitle tracks", async () => {
    let session;
    render(
      <FullScreenEditor
        jobId="job"
        clipIndex={0}
        clip={{ output_fps: 30, video_url: manifest.timeline.source_video_url }}
        initialManifest={{
          ...manifest,
          subtitle_tracks: [],
          layers: {
            hook: manifest.layers.hook,
            effects: null,
            subtitles: null,
          },
        }}
        initialVersion={{
          version_id: "v1",
          status: "done",
          output_url: "/videos/job/v1.mp4",
        }}
        onSessionReady={(api) => {
          session = api;
        }}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(session).toBeTruthy());
    session.applyLayer("effects", {
      segments: [{ startSec: 0, endSec: 2, zoom: 1.1 }],
    });
    session.applyLayer("subtitles", {
      captions: [{ text: "Hello", startMs: 500, endMs: 1200 }],
      style: { animation: "pop" },
    });
    expect(session.getManifest()).toMatchObject({
      layers: {
        hook: { text: "Original hook" },
        effects: { segments: [{ startSec: 0, endSec: 2, zoom: 1.1 }] },
        subtitles: { style: { animation: "pop" } },
      },
      subtitle_tracks: [
        {
          id: "original",
          cues: [{ text: "Hello", startMs: 500, endMs: 1200 }],
        },
      ],
      active_subtitle_track_id: "original",
    });
  });

  it("shows and edits subtitles from the legacy layer shape", () => {
    const legacyManifest = {
      timeline: {
        source_video_url: "https://example.test/video.mp4",
        trim: { start_sec: 0, end_sec: 4 },
      },
      layers: {
        subtitles: { cues: [{ text: "Hola", startMs: 500, endMs: 1500 }] },
      },
    };
    render(
      <FullScreenEditor
        jobId="job"
        clipIndex={0}
        clip={{
          output_fps: 30,
          video_url: legacyManifest.timeline.source_video_url,
        }}
        initialManifest={legacyManifest}
        initialVersion={{ version_id: "v1", status: "done" }}
        onClose={vi.fn()}
      />,
    );
    fireEvent.doubleClick(screen.getByRole("button", { name: "Hola" }));
    const input = screen.getByRole("textbox", { name: "Subtitle text" });
    fireEvent.change(input, { target: { value: "Hello" } });
    expect(input).toHaveValue("Hello");
    expect(legacyManifest.layers.subtitles.cues[0].text).toBe("Hola");
  });

  it("shows subtitle cues from the transcript manifest shape used by generated clips", () => {
    const transcriptManifest = {
      timeline: {
        source_video_url: "https://example.test/video.mp4",
        trim: { start_sec: 0, end_sec: 4 },
        transcript: {
          language: "it",
          segments: [{ start: 0.5, end: 1.5, text: "Ciao" }],
        },
      },
      layers: {},
    };
    render(
      <FullScreenEditor
        jobId="job"
        clipIndex={0}
        clip={{
          output_fps: 30,
          video_url: transcriptManifest.timeline.source_video_url,
        }}
        initialManifest={transcriptManifest}
        initialVersion={{ version_id: "v1", status: "done" }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Ciao" })).toBeInTheDocument();
  });

  it("preloads generated transcript subtitles in the local editor timeline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(["video"], { type: "video/mp4" }),
      }),
    );
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => "blob:generated-clip"),
    });
    const transcriptManifest = {
      timeline: {
        source_video_url: "https://example.test/video.mp4",
        trim: { start_sec: 10, end_sec: 14 },
        transcript: {
          language: "it",
          segments: [{ start: 10.5, end: 11.5, text: "Ciao" }],
        },
      },
      layers: {},
      subtitle_tracks: [],
    };
    render(
      <FullScreenEditor
        useLocalEditor
        jobId="job"
        clipIndex={0}
        clip={{
          output_fps: 30,
          video_url: transcriptManifest.timeline.source_video_url,
        }}
        initialManifest={transcriptManifest}
        initialVersion={{ version_id: "v1", status: "done" }}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Ciao" })).toBeInTheDocument(),
    );
  });

  it("hydrates subtitles from the clip transcript endpoint when a legacy version has no subtitle track", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).endsWith("/versions")) {
          return {
            ok: true,
            json: async () => ({
              current_version_id: "v3",
              versions: [{ version_id: "v3", status: "done" }],
            }),
          };
        }
        if (String(url).endsWith("/versions/v3")) {
          return {
            ok: true,
            json: async () => ({
              version: { version_id: "v3", status: "done" },
              manifest: {
                timeline: {
                  source_video_url: "/videos/clip.mp4",
                  trim: { start_sec: 10, end_sec: 14 },
                  transcript: {
                    language: "it",
                    segments: [
                      { start: 10.5, end: 11.5, text: "Source transcript" },
                    ],
                  },
                },
                subtitle_tracks: [],
                layers: {},
              },
            }),
          };
        }
        if (String(url).endsWith("/transcript")) {
          return {
            ok: true,
            json: async () => ({
              language: "it",
              durationSec: 4,
              captions: [{ text: "Ciao", startMs: 500, endMs: 1500 }],
            }),
          };
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    render(
      <FullScreenEditor
        jobId="job"
        clipIndex={1}
        clip={{ output_fps: 30, video_url: "/videos/clip.mp4" }}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Ciao" })).toBeInTheDocument(),
    );
  });

  it("hydrates an empty saved subtitle track before loading the editor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).endsWith("/versions")) {
          return {
            ok: true,
            json: async () => ({
              current_version_id: "v4",
              versions: [{ version_id: "v4", status: "done" }],
            }),
          };
        }
        if (String(url).endsWith("/versions/v4")) {
          return {
            ok: true,
            json: async () => ({
              version: { version_id: "v4", status: "done" },
              manifest: {
                timeline: {
                  source_video_url: "/videos/clip.mp4",
                  trim: { start_sec: 10, end_sec: 14 },
                  transcript: {
                    language: "it",
                    segments: [
                      { start: 10.5, end: 11.5, text: "Source transcript" },
                    ],
                  },
                },
                subtitle_tracks: [{ id: "original", cues: [] }],
                layers: {},
              },
            }),
          };
        }
        if (String(url).endsWith("/transcript")) {
          return {
            ok: true,
            json: async () => ({
              language: "it",
              durationSec: 4,
              captions: [{ text: "Ciao", startMs: 500, endMs: 1500 }],
            }),
          };
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(
      <FullScreenEditor
        jobId="job"
        clipIndex={1}
        clip={{ output_fps: 30, video_url: "/videos/clip.mp4" }}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Ciao" })).toBeInTheDocument(),
    );
  });

  it("applies asynchronously hydrated subtitles when a source preview URL stays unchanged", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).endsWith("/versions")) {
          return {
            ok: true,
            json: async () => ({ current_version_id: "", versions: [] }),
          };
        }
        if (String(url).endsWith("/manifest")) {
          return {
            ok: false,
            status: 404,
            json: async () => ({ detail: "Clip has no render manifest" }),
          };
        }
        if (String(url).endsWith("/transcript")) {
          return {
            ok: true,
            json: async () => ({
              language: "es",
              durationSec: 4,
              captions: [{ text: "Cargado", startMs: 500, endMs: 1500 }],
            }),
          };
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(
      <FullScreenEditor
        useLocalEditor
        jobId="job"
        clipIndex={0}
        clip={{
          start: 10,
          end: 14,
          output_fps: 30,
          video_url: "/videos/job/master.mp4",
          source_video_url: "/videos/job/master.mp4",
          source_preview: true,
        }}
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Cargado" }),
    ).toBeInTheDocument();
  });

  it("refreshes stale version subtitles when the clip source range was extended", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).endsWith("/versions")) {
          return {
            ok: true,
            json: async () => ({
              current_version_id: "v3",
              versions: [{ version_id: "v3", status: "done" }],
            }),
          };
        }
        if (String(url).endsWith("/versions/v3")) {
          return {
            ok: true,
            json: async () => ({
              version: { version_id: "v3", status: "done" },
              manifest: {
                timeline: {
                  source_video_url: "/videos/clip.mp4",
                  trim: { start_sec: 10, end_sec: 14 },
                },
                subtitle_tracks: [
                  {
                    id: "original",
                    language: "en",
                    label: "Original",
                    origin: "original",
                    cues: [{ text: "Old", startMs: 500, endMs: 1500 }],
                  },
                ],
                layers: {},
              },
            }),
          };
        }
        if (String(url).endsWith("/transcript")) {
          return {
            ok: true,
            json: async () => ({
              language: "en",
              captions: [
                { text: "Old", startMs: 500, endMs: 1500 },
                { text: "Between", startMs: 4500, endMs: 5500 },
              ],
            }),
          };
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(
      <FullScreenEditor
        jobId="job"
        clipIndex={1}
        clip={{
          start: 10,
          end: 16,
          output_fps: 30,
          video_url: "/videos/clip.mp4",
        }}
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Between" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("remotion-player-frame")).toHaveAttribute(
      "data-duration",
      "6",
    );
  });

  it("bootstraps the editor from a persisted manifest when no saved version exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).endsWith("/versions")) {
          return {
            ok: true,
            json: async () => ({ current_version_id: "", versions: [] }),
          };
        }
        if (String(url).endsWith("/manifest")) {
          return {
            ok: true,
            json: async () => ({
              manifest: {
                timeline: {
                  source_video_url: "/videos/clip.mp4",
                  trim: { start_sec: 0, end_sec: 4 },
                },
                subtitle_tracks: [],
                layers: {},
              },
            }),
          };
        }
        if (String(url).endsWith("/transcript")) {
          return {
            ok: true,
            json: async () => ({
              language: "it",
              captions: [{ text: "Ciao", startMs: 500, endMs: 1500 }],
            }),
          };
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    render(
      <FullScreenEditor
        jobId="job"
        clipIndex={0}
        clip={{ output_fps: 30, video_url: "/videos/clip.mp4" }}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Ciao" })).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Save as new version" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Download version" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
  });

  it("shows the save-as-new-version action in the local editor header", async () => {
    render(
      <FullScreenEditor
        useLocalEditor
        jobId="job"
        clipIndex={0}
        clip={{ output_fps: 30, video_url: manifest.timeline.source_video_url }}
        initialManifest={manifest}
        initialVersion={{ version_id: "v1", status: "done" }}
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Export Video" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save as new version" }),
    ).toBeInTheDocument();
  });

  it("loads changed master subtitles instead of a stale generated version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const value = String(url);
        if (value.endsWith("/versions")) {
          return {
            ok: true,
            json: async () => ({
              current_version_id: "v1",
              versions: [{ version_id: "v1", status: "done" }],
            }),
          };
        }
        if (value.endsWith("/manifest")) {
          return {
            ok: true,
            json: async () => ({
              master_current: false,
              manifest: {
                ...manifest,
                subtitle_tracks: [
                  {
                    id: "original",
                    language: "es",
                    cues: [
                      { text: "New master text", startMs: 0, endMs: 1000 },
                    ],
                  },
                ],
              },
            }),
          };
        }
        if (value.endsWith("/versions/v1")) {
          return {
            ok: true,
            json: async () => ({
              version: { version_id: "v1", status: "done" },
              manifest: {
                ...manifest,
                subtitle_tracks: [
                  {
                    id: "original",
                    language: "es",
                    cues: [
                      { text: "Old generated text", startMs: 0, endMs: 1000 },
                    ],
                  },
                ],
              },
            }),
          };
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(
      <FullScreenEditor
        useLocalEditor
        jobId="job"
        clipIndex={0}
        clip={{ output_fps: 30, video_url: "/videos/clip.mp4" }}
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "New master text" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Old generated text" }),
    ).not.toBeInTheDocument();
  });

  it("falls back to the clip range when a legacy clip has no manifest", async () => {
    const onClose = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).endsWith("/versions")) {
          return {
            ok: true,
            json: async () => ({ current_version_id: "", versions: [] }),
          };
        }
        if (String(url).endsWith("/manifest")) {
          return { ok: false, status: 404, json: async () => ({}) };
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(
      <FullScreenEditor
        jobId="job"
        clipIndex={0}
        clip={{
          output_fps: 30,
          video_url: "/videos/clip.mp4",
          start: 34.2,
          end: 51.8,
        }}
        onClose={onClose}
      />,
    );

    await waitFor(() => {
      const duration = Number(
        screen.getByTestId("remotion-player-frame").dataset.duration,
      );
      expect(duration).toBeCloseTo(17.6, 5);
    });
    expect(screen.getByTestId("remotion-player-frame")).toHaveAttribute(
      "data-video-url",
      "/videos/clip.mp4",
    );

    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
