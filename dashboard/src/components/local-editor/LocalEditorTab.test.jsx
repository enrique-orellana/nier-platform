import "fake-indexeddb/auto";

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { StrictMode, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LocalEditorTab from "./LocalEditorTab";
import { DEFAULT_SUBTITLE_STYLE } from "./localEditorStyles";
import { EDITOR_PREFERENCES_STORAGE_KEY } from "./localEditorPreferences";
import {
  EDITOR_PROJECT_DB_NAME,
  EDITOR_VIDEO_DB_NAME,
  createStoredProject,
  listStoredProjects,
} from "./localEditorPersistence";

vi.mock("./AudioWaveform", () => ({
  default: ({ videoUrl }) => (
    <div data-testid="audio-waveform" data-video-url={videoUrl} />
  ),
}));

const remotionPlayerMock = vi.hoisted(() => ({
  play: vi.fn(),
  pause: vi.fn(),
  seekTo: vi.fn(),
  mute: vi.fn(),
  unmute: vi.fn(),
}));

vi.mock("../RemotionPreview", () => ({
  default: function MockRemotionPreview({
    videoUrl,
    currentFrame,
    controls = true,
    hook = null,
    subtitles = null,
    onPlayerReady,
    onMediaTimeChange,
  }) {
    useEffect(() => {
      onPlayerReady?.(remotionPlayerMock);
      return () => onPlayerReady?.(null);
    }, [onPlayerReady]);
    return (
      <div
        data-testid="local-editor-remotion-preview"
        data-video-url={videoUrl}
        data-current-frame={currentFrame ?? "uncontrolled"}
        data-controls={String(controls)}
        data-hook-text={hook?.text || ""}
        data-subtitle-text={
          subtitles?.captions?.map((caption) => caption.text).join("|") || ""
        }
      >
        <button type="button" onClick={() => onMediaTimeChange?.(2000)}>
          Emit native media time
        </button>
      </div>
    );
  },
}));

const makeVideoFile = () =>
  new File(["video"], "demo.mp4", { type: "video/mp4" });

const controlledEditorState = {
  subtitleCues: [],
  subtitleStyle: DEFAULT_SUBTITLE_STYLE,
  subtitleLanguage: "en",
  hook: null,
};

function EchoingEditor() {
  const [state, setState] = useState(controlledEditorState);
  return (
    <LocalEditorTab
      initialEditorState={state}
      initialStateKey="draft-1"
      onStateChange={setState}
    />
  );
}

const deleteDatabase = (name) =>
  new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = resolve;
    request.onerror = resolve;
    request.onblocked = resolve;
  });

if (!URL.createObjectURL) {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: () => "blob:demo",
  });
}

describe("LocalEditorTab", () => {
  beforeEach(async () => {
    localStorage.clear();
    await deleteDatabase(EDITOR_PROJECT_DB_NAME);
    await deleteDatabase(EDITOR_VIDEO_DB_NAME);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("switches feature panels while keeping the player and timeline mounted", async () => {
    render(
      <LocalEditorTab
        initialVideoUrl="/videos/project.mp4"
        initialPlaybackDurationMs={10000}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("local-editor-player")).toBeInTheDocument(),
    );

    const player = screen.getByTestId("local-editor-player");
    const timeline = screen.getByTestId("local-editor-timeline-scroll");
    expect(screen.getByRole("button", { name: "Details" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.click(screen.getByRole("button", { name: "Subtitles" }));

    expect(screen.getByRole("button", { name: "Subtitles" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByTestId("local-editor-player")).toBe(player);
    expect(screen.getByTestId("local-editor-timeline-scroll")).toBe(timeline);
    expect(
      screen.getByRole("region", { name: "Subtitles" }),
    ).toBeInTheDocument();
  });

  it("keeps the editor header compact like a desktop video editor toolbar", () => {
    render(
      <LocalEditorTab
        initialVideoUrl="/videos/project.mp4"
        initialPlaybackDurationMs={10000}
      />,
    );

    const header = screen.getByTestId("local-editor-header");
    expect(header).toHaveClass("h-11", "px-3", "py-1");
    expect(screen.getByRole("heading", { name: "Local Editor" })).toHaveClass(
      "text-sm",
      "leading-4",
    );
    expect(screen.getByTestId("local-editor-header-actions")).toHaveClass(
      "gap-1",
    );
  });

  it("organizes header actions into workspace, edit, output, and utility groups", () => {
    render(
      <LocalEditorTab
        initialVideoUrl="/videos/project.mp4"
        initialPlaybackDurationMs={10000}
        headerActions={
          <button type="button" onClick={() => {}}>
            Save as new version
          </button>
        }
        onClose={() => {}}
      />,
    );

    const actions = screen.getByTestId("local-editor-header-actions");
    expect(
      Array.from(actions.children).map((group) => group.dataset.testid),
    ).toEqual([
      "local-editor-header-workspace",
      "local-editor-header-edit",
      "local-editor-header-output",
      "local-editor-header-utility",
    ]);
    expect(
      within(screen.getByTestId("local-editor-header-output")).getByRole(
        "button",
        { name: "Save as new version" },
      ),
    ).toBeInTheDocument();
  });

  it("keeps the subtitle workspace visible inside the resizable editor viewport", () => {
    render(
      <LocalEditorTab
        initialVideoUrl="/videos/project.mp4"
        initialPlaybackDurationMs={10000}
      />,
    );

    const workspace = screen.getByTestId("local-editor-workspace");
    expect(workspace).toHaveClass(
      "flex-1",
      "min-h-0",
      "overflow-hidden",
      "gap-2",
      "p-0",
    );
    expect(workspace).toHaveClass(
      "xl:grid-rows-[minmax(0,1fr)_minmax(280px,40vh)]",
    );

    const subtitleWorkspace = screen.getByTestId(
      "local-editor-subtitle-workspace",
    );
    expect(screen.queryByText("Subtitle workspace")).not.toBeInTheDocument();
    expect(screen.getByTestId("local-editor-subtitle-toolbar")).toHaveClass(
      "h-9",
      "border-b",
    );
    expect(
      screen.queryByTestId("local-editor-timeline-toolbar"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Timeline zoom" })).toHaveValue(
      "1",
    );
    expect(subtitleWorkspace).toHaveClass(
      "min-h-0",
      "flex",
      "flex-col",
      "overflow-hidden",
    );
    expect(screen.getByTestId("local-editor-timeline-scroll")).toBeVisible();
  });

  it("does not repeat playhead timing in the inspector sections", () => {
    render(
      <LocalEditorTab
        initialVideoUrl="/videos/project.mp4"
        initialPlaybackDurationMs={10000}
      />,
    );

    expect(screen.queryByText("Playhead")).not.toBeInTheDocument();
  });

  it("selects the Project feature and keeps supplied project actions in the context area", () => {
    render(
      <LocalEditorTab
        initialVideoUrl="/videos/project.mp4"
        sidePanel={<div data-testid="project-side-panel">Project actions</div>}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Project" }));

    expect(screen.getByTestId("project-side-panel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Project" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("region", { name: "Project context" }),
    ).toContainElement(screen.getByTestId("project-side-panel"));
  });

  it("shows a local-only upload state", () => {
    render(<LocalEditorTab />);
    expect(
      screen.getByRole("heading", { name: "Local Editor" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/stays in your browser/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/upload video/i)).toBeInTheDocument();
  });

  it("does not reapply an echoed initial editor state on every render", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<EchoingEditor />)).not.toThrow();
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain(
      "Maximum update depth exceeded",
    );
  });

  it("streams a project clip without downloading it into a browser blob", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <LocalEditorTab
        initialVideoUrl="/api/video-proxy/project.mp4"
        initialVideoName="project.mp4"
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle subtitles settings/i }),
      ).toBeInTheDocument(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/upload video/i)).not.toBeInTheDocument();
    expect(screen.getByText(/project\.mp4/)).toBeInTheDocument();
    expect(
      screen.getByTestId("local-editor-player").querySelector("video"),
    ).toHaveAttribute("src", "/api/video-proxy/project.mp4");
  });

  it("passes the Play button gesture to the Remotion player for audio", async () => {
    remotionPlayerMock.play.mockClear();

    render(
      <LocalEditorTab
        initialVideoUrl="/videos/project.mp4"
        remotionPreviewProps={{
          videoUrl: "/videos/project.mp4",
          durationInSeconds: 10,
          fps: 30,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /play video/i }));

    await waitFor(() =>
      expect(remotionPlayerMock.play).toHaveBeenCalledWith(
        expect.objectContaining({ type: "click" }),
      ),
    );
  });

  it("uses the native media clock for the editor playhead", async () => {
    render(
      <LocalEditorTab
        initialVideoUrl="/videos/project.mp4"
        remotionPreviewProps={{
          videoUrl: "/videos/project.mp4",
          durationInSeconds: 10,
          fps: 30,
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /emit native media time/i }),
    );

    await waitFor(() =>
      expect(screen.getAllByText(/00:00:02:00/).length).toBeGreaterThan(0),
    );
  });

  it("hides unavailable local-only controls for streamed project clips", async () => {
    render(
      <LocalEditorTab
        initialVideoUrl="https://minio.example/project.mp4"
        initialVideoName="project.mp4"
        initialProjectId="job-1"
        initialClipIndex={0}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle subtitles settings/i }),
      ).toBeInTheDocument(),
    );

    expect(
      screen.queryByRole("button", { name: "Save Project" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Undo" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Redo" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export Video" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Export Subtitles" }),
    ).not.toBeInTheDocument();
  });

  it("uses the rendered export URL when both export and source URLs exist", async () => {
    const sourceUrl = "/videos/job/source.mp4";
    const exportUrl = "/videos/job/rendered.mp4";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <LocalEditorTab
        initialVideoUrl={sourceUrl}
        initialExportVideoUrl={exportUrl}
        initialVideoName="rendered.mp4"
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle subtitles settings/i }),
      ).toBeInTheDocument(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole("region", { name: /video preview/i })
        .querySelector("video"),
    ).toHaveAttribute("src", exportUrl);
  });

  it("delegates project video export and downloads the completed version URL", async () => {
    const onExport = vi.fn().mockResolvedValue("/videos/job/exported.mp4");
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(
      <LocalEditorTab
        initialVideoUrl="/videos/job/source.mp4"
        initialExportVideoUrl="/videos/job/source.mp4"
        initialPlaybackDurationMs={10000}
        remotionPreviewProps={{
          videoUrl: "/videos/job/source.mp4",
          durationInSeconds: 10,
          width: 1080,
          height: 1920,
        }}
        onExport={onExport}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Export Video" }),
    );

    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    expect(anchorClick).toHaveBeenCalled();
  });

  it("opens the subtitle cue modal on double click instead of single click", async () => {
    render(
      <LocalEditorTab
        initialVideoUrl="/videos/project.mp4"
        initialPlaybackDurationMs={10000}
        initialEditorState={{
          subtitleCues: [
            { id: "cue-1", text: "Caption", startMs: 1000, endMs: 2000 },
          ],
          subtitleStyle: DEFAULT_SUBTITLE_STYLE,
          subtitleLanguage: "en",
          hook: null,
        }}
      />,
    );

    const cue = await screen.findByRole("button", { name: "Caption" });
    fireEvent.click(cue);
    expect(
      screen.queryByRole("dialog", { name: /subtitle cue/i }),
    ).not.toBeInTheDocument();

    fireEvent.doubleClick(cue);
    expect(
      await screen.findByRole("dialog", { name: /subtitle cue/i }),
    ).toBeInTheDocument();
  });

  it("does not offer local upload when a project editor has no remote video", () => {
    render(<LocalEditorTab allowLocalUpload={false} />);

    expect(screen.queryByLabelText(/upload video/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/project video is unavailable/i),
    ).toBeInTheDocument();
  });

  it("shows generated clip metadata beside the project video", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:project-clip");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(["video"], { type: "video/mp4" }),
      }),
    );

    render(
      <LocalEditorTab
        initialVideoUrl="/api/video-proxy/project.mp4"
        initialVideoName="project.mp4"
        clipMetadata={{
          start: 12,
          end: 51,
          video_title_for_youtube_short:
            "La foto que según él parece Juan Guarnizo",
          video_description_for_tiktok:
            "Una chica de Internet tiene una foto de cuerpo entero y le pide ayuda.",
        }}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: "La foto que según él parece Juan Guarnizo",
        }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("39s")).toBeInTheDocument();
    const player = screen.getByTestId("local-editor-player");
    expect(player).toBeInTheDocument();
    expect(player.parentElement).toHaveClass(
      "xl:col-start-3",
      "xl:row-start-1",
    );
  });

  it("uses current edited subtitle cues when generating hashtags", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hashtags: ["#editedclip"] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:project-clip");

    render(
      <LocalEditorTab
        initialVideoUrl="/api/video-proxy/project.mp4"
        initialEditorState={{
          subtitleCues: [
            { id: "a", text: "Primera frase" },
            { id: "b", text: "Segunda frase" },
          ],
          subtitleStyle: DEFAULT_SUBTITLE_STYLE,
          subtitleLanguage: "es",
          hook: null,
        }}
        initialStateKey="hashtags-test"
        clipMetadata={{
          video_title_for_youtube_short: "Título",
          video_description_for_tiktok: "Caption",
        }}
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
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).subtitle_text).toBe(
      "Primera frase Segunda frase",
    );
  });

  it("shows timeline controls after selecting a video", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle subtitles settings/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /toggle subtitles settings/i }),
    );
    expect(
      screen.getByRole("button", { name: /import subtitles/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Viral Hook").length).toBeGreaterThan(0);
    expect(screen.getByTestId("local-editor-audio-track")).toBeInTheDocument();
    expect(screen.getByTestId("audio-waveform")).toHaveAttribute(
      "data-video-url",
      "blob:demo",
    );
  });

  it("allows replacing the subtitle font size one digit at a time", async () => {
    render(
      <LocalEditorTab
        initialVideoUrl="/api/video-proxy/project.mp4"
        initialVideoName="project.mp4"
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

    const input = screen.getByLabelText("Subtitle font size");
    fireEvent.change(input, { target: { value: "4" } });
    expect(input).toHaveValue(4);
    fireEvent.change(input, { target: { value: "48" } });
    expect(input).toHaveValue(48);
  });

  it("applies remembered settings to a new editor without copying content", async () => {
    localStorage.setItem(
      EDITOR_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        subtitleStyle: { fontSize: 42 },
        subtitleLanguage: "fr",
        hookDefaults: {
          position: "center",
          size: "L",
          entranceAnimation: "fade",
          durationMs: 4000,
          fontSize: 60,
        },
      }),
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");

    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle subtitles settings/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /toggle subtitles settings/i }),
    );

    expect(screen.getByLabelText("Subtitle font size")).toHaveValue(42);
    expect(screen.getByLabelText("Subtitle source language")).toHaveValue("fr");
    expect(screen.queryByLabelText("Subtitle text")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add Viral Hook" }));
    expect(screen.getByLabelText("Hook text")).toHaveValue("Your viral hook");
    expect(screen.getByRole("button", { name: "Center" })).toHaveClass(
      "border-white",
    );
    expect(screen.getByRole("button", { name: "Large" })).toHaveClass(
      "border-white",
    );
    expect(screen.getByRole("button", { name: "Fade" })).toHaveClass(
      "border-white",
    );
  });

  it("saves changed settings without storing subtitle or hook content", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");

    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle subtitles settings/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /toggle subtitles settings/i }),
    );
    fireEvent.change(screen.getByLabelText("Subtitle font size"), {
      target: { value: "44" },
    });
    fireEvent.change(screen.getByLabelText("Subtitle source language"), {
      target: { value: "it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add subtitle cue" }));
    fireEvent.change(screen.getByLabelText("Subtitle text"), {
      target: { value: "private subtitle" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Viral Hook" }));
    fireEvent.change(screen.getByLabelText("Hook text"), {
      target: { value: "private hook text" },
    });
    const hookPanel = document.getElementById("viral-hook-settings-panel");
    fireEvent.click(within(hookPanel).getByRole("button", { name: "Bottom" }));

    const stored = JSON.parse(
      localStorage.getItem(EDITOR_PREFERENCES_STORAGE_KEY),
    );
    expect(stored.subtitleStyle.fontSize).toBe(44);
    expect(stored.subtitleLanguage).toBe("it");
    expect(stored.hookDefaults.position).toBe("bottom");
    expect(stored).not.toHaveProperty("subtitleCues");
    expect(stored.hookDefaults).not.toHaveProperty("text");
    expect(JSON.stringify(stored)).not.toContain("private subtitle");
    expect(JSON.stringify(stored)).not.toContain("private hook text");
  });

  it("keeps existing project settings authoritative over remembered defaults", async () => {
    localStorage.setItem(
      EDITOR_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        subtitleStyle: { fontSize: 42 },
        subtitleLanguage: "fr",
        hookDefaults: {
          position: "center",
          size: "L",
          entranceAnimation: "fade",
        },
      }),
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    const initialEditorState = {
      subtitleCues: [
        {
          id: "existing-cue",
          text: "Existing subtitle",
          startMs: 0,
          endMs: 1000,
        },
      ],
      subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE, fontSize: 18 },
      subtitleLanguage: "it",
      hook: {
        id: "hook",
        text: "Existing hook",
        startMs: 0,
        endMs: 2000,
        position: "bottom",
        size: "S",
        entranceAnimation: "none",
        color: "#ffffff",
        fontSize: 30,
        background: "#111111",
        fontFamily: "Arial",
      },
    };

    render(
      <LocalEditorTab
        initialEditorState={initialEditorState}
        initialStateKey="existing-project-1"
      />,
    );
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle subtitles settings/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /toggle subtitles settings/i }),
    );
    expect(screen.getByLabelText("Subtitle font size")).toHaveValue(18);
    expect(screen.getByLabelText("Subtitle source language")).toHaveValue("it");

    fireEvent.click(screen.getByRole("button", { name: "Existing hook" }));
    fireEvent.click(
      screen.getByRole("button", { name: /toggle viral hook settings/i }),
    );
    expect(screen.getByLabelText("Hook text")).toHaveValue("Existing hook");
    const hookPanel = document.getElementById("viral-hook-settings-panel");
    expect(
      within(hookPanel).getByRole("button", { name: "Bottom" }),
    ).toHaveClass("border-white");
    expect(
      within(hookPanel).getByRole("button", { name: "Small" }),
    ).toHaveClass("border-white");
    expect(within(hookPanel).getByRole("button", { name: "None" })).toHaveClass(
      "border-white",
    );
  });

  it("switches between the subtitle timeline and cue table", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /add subtitle cue/i }),
      ).toBeInTheDocument(),
    );

    expect(
      screen.getByRole("tab", { name: "Timeline view" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Subtitle table view" }));
    expect(
      screen.getByRole("columnheader", { name: "Start" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "End" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Text" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Scroll to current subtitle" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Follow audio" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Timeline view" }));
    expect(
      screen.getByTestId("local-editor-timeline-canvas"),
    ).toBeInTheDocument();
  });

  it("shows word timings for a cue after its text is entered", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /add subtitle cue/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /add subtitle cue/i }));
    fireEvent.change(screen.getByLabelText("Subtitle text"), {
      target: { value: "One two" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save cue" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Word 1 text")).toHaveValue("One"),
    );
    expect(screen.getByLabelText("Word 2 text")).toHaveValue("two");
    expect(screen.getByLabelText("Word 1 start")).toHaveValue(0);
    expect(screen.getByLabelText("Word 2 end")).toHaveValue(2000);
  });

  it("offers a viewport-sized player and fullscreen control", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      writable: true,
      value: requestFullscreen,
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /enter fullscreen/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("local-editor-player")).toHaveClass(
      "h-full",
      "max-h-full",
    );
    fireEvent.click(screen.getByRole("button", { name: /enter fullscreen/i }));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("renders the preview in a player panel while keeping controls in a dedicated strip", async () => {
    render(
      <LocalEditorTab
        initialVideoUrl="/videos/project.mp4"
        initialPlaybackDurationMs={10000}
      />,
    );

    expect(
      screen.queryByRole("heading", { name: "Player-Timeline 01" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("local-editor-player")).toHaveClass(
      "flex",
      "flex-col",
      "bg-[#242424]",
      "rounded-none",
    );
    expect(screen.getByTestId("local-editor-player-stage")).toHaveClass(
      "flex-1",
      "items-center",
      "justify-center",
    );
    expect(screen.getByTestId("local-editor-video-controls")).toHaveClass(
      "flex-none",
      "h-9",
      "min-h-0",
      "grid",
      "grid-cols-[1fr_auto_1fr]",
    );
    expect(
      screen.getByRole("button", { name: "Play video" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("local-editor-timecode")).toHaveTextContent(
      /00:00:00:00 \/ 00:00:10:00/,
    );
    expect(
      screen.getByRole("button", { name: "Mute video" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /change preview fit|fill video/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Aspect ratio 9:16" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Aspect ratio 9:16" }),
    ).toHaveClass("border", "bg-[#2b2b2b]", "rounded-sm");
    expect(
      screen.queryByRole("button", { name: "Preview zoom" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Enter fullscreen" }),
    ).toBeInTheDocument();
  });

  it("uses the standard Remotion preview for project clips", async () => {
    render(
      <LocalEditorTab
        initialVideoUrl="https://example.test/master.mp4"
        initialExportVideoUrl="https://example.test/master.mp4"
        initialPlaybackDurationMs={10000}
        remotionPreviewProps={{
          videoUrl: "https://example.test/master.mp4",
          durationInSeconds: 10,
          fps: 30,
          width: 1080,
          height: 1920,
        }}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("local-editor-remotion-preview"),
      ).toHaveAttribute("data-video-url", "https://example.test/master.mp4"),
    );
    expect(
      screen.queryByTestId("local-editor-native-video"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("local-editor-remotion-preview")).toHaveAttribute(
      "data-current-frame",
      "0",
    );
    expect(screen.getByTestId("local-editor-remotion-preview")).toHaveAttribute(
      "data-controls",
      "false",
    );
  });

  it("renders the current local hook state in the Remotion preview", async () => {
    render(
      <LocalEditorTab
        initialVideoUrl="https://example.test/master.mp4"
        initialExportVideoUrl="https://example.test/master.mp4"
        initialPlaybackDurationMs={10000}
        initialEditorState={{
          ...controlledEditorState,
          hook: { text: "Current local hook", startMs: 0, endMs: 5000 },
        }}
        remotionPreviewProps={{
          videoUrl: "https://example.test/master.mp4",
          durationInSeconds: 10,
          fps: 30,
          width: 1080,
          height: 1920,
          hook: { text: "Stale parent hook", startMs: 0, endMs: 5000 },
        }}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("local-editor-remotion-preview"),
      ).toHaveAttribute("data-hook-text", "Current local hook"),
    );
  });

  it("renders the current local subtitle state in the Remotion preview", async () => {
    render(
      <LocalEditorTab
        initialVideoUrl="https://example.test/master.mp4"
        initialExportVideoUrl="https://example.test/master.mp4"
        initialPlaybackDurationMs={10000}
        initialEditorState={{
          ...controlledEditorState,
          subtitleCues: [
            { id: "current", text: "Current cue", startMs: 0, endMs: 1000 },
          ],
        }}
        remotionPreviewProps={{
          videoUrl: "https://example.test/master.mp4",
          durationInSeconds: 10,
          fps: 30,
          width: 1080,
          height: 1920,
          subtitles: {
            captions: [{ text: "Stale cue", startMs: 0, endMs: 1000 }],
          },
        }}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("local-editor-remotion-preview"),
      ).toHaveAttribute("data-subtitle-text", "Current cue"),
    );
  });

  it("allows the player to fill the preview when fit mode leaves bars visible", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /fill video/i }),
      ).toBeInTheDocument(),
    );
    const video = screen
      .getByTestId("local-editor-player")
      .querySelector("video");
    expect(video).toHaveClass("object-contain");
    fireEvent.click(screen.getByRole("button", { name: /fill video/i }));
    expect(video).toHaveClass("object-cover");
  });

  it("collapses overlay settings and exposes custom video controls", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle subtitles settings/i }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /play video/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /stop video/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /rewind 5 seconds/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /fast forward 5 seconds/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /toggle subtitles settings/i }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByRole("button", { name: /toggle viral hook settings/i }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: /import subtitles/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /toggle subtitles settings/i }),
    );
    expect(
      screen.getByRole("button", { name: /toggle subtitles settings/i }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: /import subtitles/i }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /toggle viral hook settings/i }),
    );
    expect(
      screen.getByRole("button", { name: /toggle viral hook settings/i }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("supports standard video keyboard controls", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      writable: true,
      value: requestFullscreen,
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(screen.getByTestId("local-editor-player")).toBeInTheDocument(),
    );
    const player = screen.getByTestId("local-editor-player");
    const video = player.querySelector("video");
    fireEvent.keyDown(player, { key: "ArrowRight" });
    expect(video.currentTime).toBe(5);
    fireEvent.keyDown(player, { key: "Home" });
    expect(video.currentTime).toBe(0);
    fireEvent.keyDown(player, { key: "m" });
    expect(video.muted).toBe(true);
    fireEvent.keyDown(player, { key: "f" });
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(player, { key: " " });
    await waitFor(() => expect(video.play).toHaveBeenCalled());
  });

  it("imports an SRT file", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle subtitles settings/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /toggle subtitles settings/i }),
    );
    expect(screen.getByLabelText("Subtitle source language")).toHaveStyle({
      colorScheme: "dark",
    });
    expect(screen.getByLabelText("Translation target language")).toHaveStyle({
      colorScheme: "dark",
    });
    expect(screen.getByText(/timings stay intact/i)).toBeInTheDocument();
    const subtitleFile = new File(["subtitle"], "captions.srt", {
      type: "application/x-subrip",
    });
    subtitleFile.text = async () => "1\n00:00:00,000 --> 00:00:01,000\nHello";
    fireEvent.change(screen.getByLabelText(/subtitle file/i), {
      target: { files: [subtitleFile] },
    });
    fireEvent.click(screen.getByRole("button", { name: /import subtitles/i }));
    await waitFor(() =>
      expect(screen.getAllByText("Hello").length).toBeGreaterThan(0),
    );
  });

  it("generates subtitles from the local video and records one undoable action", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        language: "en",
        segments: [{ start: 0.25, end: 1.4, text: "Generated caption" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle subtitles settings/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /toggle subtitles settings/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /generate subtitles/i }),
    );

    await waitFor(() =>
      expect(screen.getAllByText("Generated caption").length).toBeGreaterThan(
        0,
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/local-editor/transcribe",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
    expect(
      screen.getByRole("button", { name: "Undo", exact: true }),
    ).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Undo", exact: true }));
    expect(screen.queryByText("Generated caption")).not.toBeInTheDocument();
  });

  it("generates subtitles for a streamed project clip from the cached master", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        language: "es",
        segments: [
          { start: 0.25, end: 1.4, text: "Generated project caption" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <LocalEditorTab
        initialVideoUrl="/videos/job-1/source.mp4"
        initialVideoName="clip-1.mp4"
        initialProjectId="job-1"
        initialClipIndex={2}
        initialPlaybackDurationMs={4000}
        allowLocalUpload={false}
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
    const generateButton = screen.getByRole("button", {
      name: /generate subtitles/i,
    });
    expect(generateButton).not.toBeDisabled();
    fireEvent.click(generateButton);

    await waitFor(() =>
      expect(
        screen.getAllByText("Generated project caption").length,
      ).toBeGreaterThan(0),
    );
    const request = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/api/projects/job-1/clips/2/transcribe"),
    );
    expect(request?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
  });

  it("cleans subtitle dots in the current editor state", async () => {
    const onStateChange = vi.fn();
    render(
      <LocalEditorTab
        initialVideoUrl="/videos/job-1/source.mp4"
        initialProjectId="job-1"
        initialClipIndex={2}
        initialEditorState={{
          subtitleCues: [
            {
              id: "cue-1",
              text: "Lo sé.",
              startMs: 0,
              endMs: 1000,
              captions: [{ text: "sé.", startMs: 500, endMs: 1000 }],
            },
          ],
          subtitleStyle: DEFAULT_SUBTITLE_STYLE,
          subtitleLanguage: "es",
          hook: null,
        }}
        initialStateKey="clean-dots"
        onStateChange={onStateChange}
        allowLocalUpload={false}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /toggle subtitles settings/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Clean subtitle dots" }),
    );

    await waitFor(() =>
      expect(onStateChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          subtitleCues: [
            expect.objectContaining({
              text: "Lo sé",
              captions: [{ text: "sé", startMs: 500, endMs: 1000 }],
            }),
          ],
        }),
      ),
    );
  });

  it("does not expose master subtitle persistence controls", async () => {
    render(
      <LocalEditorTab
        initialVideoUrl="/videos/job-1/source.mp4"
        initialProjectId="job-1"
        initialClipIndex={2}
        initialEditorState={{
          subtitleCues: [{ id: "cue-1", text: "sé", startMs: 0, endMs: 1000 }],
          subtitleStyle: DEFAULT_SUBTITLE_STYLE,
          subtitleLanguage: "es",
          hook: null,
        }}
        initialStateKey="persist-subtitles"
        allowLocalUpload={false}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /toggle subtitles settings/i }),
    );
    expect(
      screen.queryByRole("button", { name: "Persist on master" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: /persist subtitles/i }),
    ).not.toBeInTheDocument();
  });

  it("translates the current subtitle track and records one undoable action", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    const fetchMock = vi
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
          status: "done",
          track: {
            id: "it",
            language: "it",
            cues: [{ text: "Ciao", startMs: 0, endMs: 1000 }],
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle subtitles settings/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /toggle subtitles settings/i }),
    );
    const subtitleFile = new File(["subtitle"], "captions.srt", {
      type: "application/x-subrip",
    });
    subtitleFile.text = async () => "1\n00:00:00,000 --> 00:00:01,000\nHello";
    fireEvent.change(screen.getByLabelText(/subtitle file/i), {
      target: { files: [subtitleFile] },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Subtitle table view" }));
    await waitFor(() =>
      expect(screen.getByDisplayValue("Hello")).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText(/translation target language/i), {
      target: { value: "it" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /translate subtitles/i }),
    );

    await waitFor(() =>
      expect(screen.getByDisplayValue("Ciao")).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/local-editor/translate",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"target_language":"it"'),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/translation/translation-1",
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo", exact: true }));
    expect(screen.getByDisplayValue("Hello")).toBeInTheDocument();
  });

  it("replaces stale word captions when applying a translated track", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          translationId: "translation-with-words",
          status: "queued",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "done",
          track: {
            id: "it",
            language: "it",
            cues: [
              {
                text: "Ciao mondo",
                startMs: 0,
                endMs: 1000,
                captions: [
                  { text: "Ciao", startMs: 0, endMs: 500 },
                  { text: "mondo", startMs: 500, endMs: 1000 },
                ],
              },
            ],
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <LocalEditorTab
        initialEditorState={{
          subtitleCues: [
            {
              id: "cue-1",
              type: "subtitle",
              label: "Hello world",
              text: "Hello world",
              startMs: 0,
              endMs: 1000,
              captions: [
                { text: "Hello", startMs: 0, endMs: 500 },
                { text: "world", startMs: 500, endMs: 1000 },
              ],
            },
          ],
          subtitleStyle: DEFAULT_SUBTITLE_STYLE,
          subtitleLanguage: "en",
          hook: null,
        }}
        initialStateKey="translation-with-words"
      />,
    );
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle subtitles settings/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /toggle subtitles settings/i }),
    );
    fireEvent.change(screen.getByLabelText(/translation target language/i), {
      target: { value: "it" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /translate subtitles/i }),
    );

    await waitFor(() => {
      const saved = JSON.parse(
        localStorage.getItem("openshorts_local_editor_state_v1"),
      );
      expect(saved.present.subtitleCues[0].captions).toEqual([
        { text: "Ciao", startMs: 0, endMs: 500 },
        { text: "mondo", startMs: 500, endMs: 1000 },
      ]);
    });
  });

  it("uses the current cue text in the preview when saved word captions are stale", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    render(
      <LocalEditorTab
        initialEditorState={{
          subtitleCues: [
            {
              id: "cue-1",
              type: "subtitle",
              label: "Ciao mondo",
              text: "Ciao mondo",
              startMs: 0,
              endMs: 1000,
              captions: [
                { text: "Hello", startMs: 0, endMs: 500 },
                { text: "world", startMs: 500, endMs: 1000 },
              ],
            },
          ],
          subtitleStyle: DEFAULT_SUBTITLE_STYLE,
          subtitleLanguage: "it",
          hook: null,
        }}
        initialStateKey="stale-preview-captions"
      />,
    );
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });

    await waitFor(() =>
      expect(
        within(screen.getByTestId("local-editor-player")).getByText("Ciao"),
      ).toBeInTheDocument(),
    );
    expect(
      within(screen.getByTestId("local-editor-player")).queryByText("Hello"),
    ).not.toBeInTheDocument();
  });

  it("asks before replacing existing subtitles during generation", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle subtitles settings/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /toggle subtitles settings/i }),
    );
    const subtitleFile = new File(["subtitle"], "captions.srt", {
      type: "application/x-subrip",
    });
    subtitleFile.text = async () =>
      "1\n00:00:00,000 --> 00:00:01,000\nExisting";
    fireEvent.change(screen.getByLabelText(/subtitle file/i), {
      target: { files: [subtitleFile] },
    });
    await waitFor(() =>
      expect(screen.getAllByText("Existing").length).toBeGreaterThan(0),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /generate subtitles/i }),
    );
    expect(confirm).toHaveBeenCalledWith("Replace the current subtitle track?");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getAllByText("Existing").length).toBeGreaterThan(0);
  });

  it("keeps existing subtitles when generation fails", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ detail: "Transcription unavailable" }),
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle subtitles settings/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /toggle subtitles settings/i }),
    );
    const subtitleFile = new File(["subtitle"], "captions.srt", {
      type: "application/x-subrip",
    });
    subtitleFile.text = async () => "1\n00:00:00,000 --> 00:00:01,000\nKeep me";
    fireEvent.change(screen.getByLabelText(/subtitle file/i), {
      target: { files: [subtitleFile] },
    });
    await waitFor(() =>
      expect(screen.getAllByText("Keep me").length).toBeGreaterThan(0),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /generate subtitles/i }),
    );
    await waitFor(() =>
      expect(screen.getByText("Transcription unavailable")).toBeInTheDocument(),
    );
    expect(screen.getAllByText("Keep me").length).toBeGreaterThan(0);
  });

  it("undoes an imported subtitle track as one action", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle subtitles settings/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /toggle subtitles settings/i }),
    );
    const subtitleFile = new File(["subtitle"], "captions.srt", {
      type: "application/x-subrip",
    });
    subtitleFile.text = async () => "1\n00:00:00,000 --> 00:00:01,000\nHello";
    fireEvent.change(screen.getByLabelText(/subtitle file/i), {
      target: { files: [subtitleFile] },
    });

    await waitFor(() =>
      expect(screen.getAllByText("Hello").length).toBeGreaterThan(0),
    );
    expect(
      screen.getByRole("button", { name: "Undo", exact: true }),
    ).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Undo", exact: true }));
    expect(screen.queryByText("Hello")).not.toBeInTheDocument();
  });

  it("undoes the latest imported cue edit without removing the imported track", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle subtitles settings/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /toggle subtitles settings/i }),
    );
    const subtitleFile = new File(["subtitle"], "captions.srt", {
      type: "application/x-subrip",
    });
    subtitleFile.text = async () => "1\n00:00:00,000 --> 00:00:01,000\nHello";
    fireEvent.change(screen.getByLabelText(/subtitle file/i), {
      target: { files: [subtitleFile] },
    });

    await waitFor(() =>
      expect(screen.getAllByText("Hello").length).toBeGreaterThan(0),
    );
    fireEvent.doubleClick(screen.getAllByRole("button", { name: "Hello" })[0]);
    fireEvent.change(screen.getByLabelText("Subtitle text"), {
      target: { value: "Changed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save cue" }));
    fireEvent.keyDown(screen.getByTestId("local-editor-player"), {
      key: "z",
      ctrlKey: true,
    });

    expect(screen.getByLabelText("Subtitle text")).toHaveValue("Hello");
    expect(screen.getAllByText("Hello").length).toBeGreaterThan(0);
  });

  it("uses editor history for Ctrl+Z while editing a cue", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle subtitles settings/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /toggle subtitles settings/i }),
    );
    const subtitleFile = new File(["subtitle"], "captions.srt", {
      type: "application/x-subrip",
    });
    subtitleFile.text = async () => "1\n00:00:00,000 --> 00:00:01,000\nHello";
    fireEvent.change(screen.getByLabelText(/subtitle file/i), {
      target: { files: [subtitleFile] },
    });

    await waitFor(() =>
      expect(screen.getAllByText("Hello").length).toBeGreaterThan(0),
    );
    fireEvent.doubleClick(screen.getAllByRole("button", { name: "Hello" })[0]);
    fireEvent.change(screen.getByLabelText("Subtitle text"), {
      target: { value: "Changed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save cue" }));
    fireEvent.keyDown(screen.getByLabelText("Subtitle text"), {
      key: "z",
      ctrlKey: true,
    });

    expect(screen.getByLabelText("Subtitle text")).toHaveValue("Hello");
  });

  it("keeps the last ten editor actions undoable", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /add subtitle cue/i }),
      ).toBeInTheDocument(),
    );

    for (let index = 0; index < 12; index += 1)
      fireEvent.click(
        screen.getByRole("button", { name: /add subtitle cue/i }),
      );
    for (let index = 0; index < 10; index += 1)
      fireEvent.click(
        screen.getByRole("button", { name: "Undo", exact: true }),
      );

    expect(
      screen.queryByRole("button", { name: "Undo", exact: true }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Timeline cue" }),
    ).toHaveLength(2);
  });

  it("persists editor actions in local browser storage", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /add subtitle cue/i }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /add subtitle cue/i }));

    const saved = JSON.parse(
      localStorage.getItem("openshorts_local_editor_state_v1"),
    );
    expect(saved.present.subtitleCues).toHaveLength(1);
    expect(saved.past).toHaveLength(1);
  });

  it("restores saved editor actions after the component is mounted again", async () => {
    const restoredCue = {
      id: "restored",
      type: "subtitle",
      label: "Restored",
      text: "Restored",
      startMs: 0,
      endMs: 1000,
    };
    localStorage.setItem(
      "openshorts_local_editor_state_v1",
      JSON.stringify({
        past: [],
        present: {
          subtitleCues: [restoredCue],
          subtitleStyle: DEFAULT_SUBTITLE_STYLE,
          hook: null,
        },
        future: [],
      }),
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });

    await waitFor(() =>
      expect(screen.getAllByText("Restored").length).toBeGreaterThan(0),
    );
  });

  it("persists the final position of an imported cue after a timeline move", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => ({
        width: 1000,
        height: 100,
        top: 0,
        left: 0,
        right: 1000,
        bottom: 100,
      }),
    );
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle subtitles settings/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /toggle subtitles settings/i }),
    );
    const subtitleFile = new File(["subtitle"], "captions.srt", {
      type: "application/x-subrip",
    });
    subtitleFile.text = async () => "1\n00:00:00,000 --> 00:00:01,000\nHello";
    fireEvent.change(screen.getByLabelText(/subtitle file/i), {
      target: { files: [subtitleFile] },
    });
    await waitFor(() =>
      expect(screen.getAllByText("Hello").length).toBeGreaterThan(0),
    );

    const cue = screen.getByRole("button", { name: "Hello" });
    act(() =>
      cue.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientX: 0 }),
      ),
    );
    act(() => {
      window.dispatchEvent(
        new MouseEvent("pointermove", { clientX: 200, bubbles: true }),
      );
      window.dispatchEvent(
        new MouseEvent("pointerup", { clientX: 200, bubbles: true }),
      );
    });

    await waitFor(() => {
      const saved = JSON.parse(
        localStorage.getItem("openshorts_local_editor_state_v1"),
      );
      expect(saved.present.subtitleCues[0].startMs).toBe(6000);
    });

    fireEvent.click(screen.getByRole("button", { name: "Undo", exact: true }));
    expect(screen.getByRole("button", { name: "Hello" })).toHaveStyle({
      left: "0%",
    });
    fireEvent.click(screen.getByRole("button", { name: "Redo", exact: true }));
    expect(screen.getByRole("button", { name: "Hello" })).toHaveStyle({
      left: "20%",
    });

    localStorage.removeItem("openshorts_local_editor_state_v1");
    window.dispatchEvent(new Event("pagehide"));
    const flushed = JSON.parse(
      localStorage.getItem("openshorts_local_editor_state_v1"),
    );
    expect(flushed.present.subtitleCues[0].startMs).toBe(6000);
  });

  it("records each imported cue timeline move as its own undoable action", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => ({
        width: 1000,
        height: 100,
        top: 0,
        left: 0,
        right: 1000,
        bottom: 100,
      }),
    );
    render(
      <StrictMode>
        <LocalEditorTab />
      </StrictMode>,
    );
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle subtitles settings/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /toggle subtitles settings/i }),
    );
    const subtitleFile = new File(["subtitle"], "captions.srt", {
      type: "application/x-subrip",
    });
    subtitleFile.text = async () =>
      "1\n00:00:00,000 --> 00:00:01,000\nFirst\n\n2\n00:00:01,000 --> 00:00:02,000\nSecond";
    fireEvent.change(screen.getByLabelText(/subtitle file/i), {
      target: { files: [subtitleFile] },
    });
    await waitFor(() =>
      expect(screen.getAllByText("First").length).toBeGreaterThan(0),
    );

    const dragCue = (name, clientX) => {
      const cue = screen.getByRole("button", { name });
      act(() => fireEvent.pointerDown(cue, { clientX: 0 }));
      act(() => {
        fireEvent.pointerMove(window, { clientX });
        fireEvent.pointerUp(window, { clientX });
      });
    };
    dragCue("First", 100);
    dragCue("Second", 200);

    await waitFor(() => {
      const saved = JSON.parse(
        localStorage.getItem("openshorts_local_editor_state_v1"),
      );
      expect(saved.past).toHaveLength(3);
    });
    fireEvent.click(screen.getByRole("button", { name: "Undo", exact: true }));
    expect(screen.getByRole("button", { name: "Second" })).toHaveStyle({
      left: "3.3333333333333335%",
    });
    fireEvent.click(screen.getByRole("button", { name: "Undo", exact: true }));
    expect(screen.getByRole("button", { name: "First" })).toHaveStyle({
      left: "0%",
    });
  });

  it("adds and edits a hook, then resets", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    fireEvent.click(screen.getByRole("button", { name: /add viral hook/i }));
    fireEvent.change(screen.getByLabelText("Hook text", { exact: true }), {
      target: { value: "Watch this" },
    });
    expect(screen.getByLabelText("Hook text", { exact: true })).toHaveValue(
      "Watch this",
    );
    expect(screen.getByLabelText("Hook text", { exact: true }).tagName).toBe(
      "TEXTAREA",
    );
    expect(screen.getByText("Duration")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Top" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Center" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bottom" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Small" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bounce" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove hook/i }));
    expect(screen.getByText(/add a hook/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() =>
      expect(screen.queryByText("Viral Hook")).not.toBeInTheDocument(),
    );
  });

  it("creates subtitle cues and confirms cue removal", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /add subtitle cue/i }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /add subtitle cue/i }));
    expect(screen.getByLabelText("Subtitle text")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /delete subtitle cue/i }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /delete subtitle cue/i }),
    );
    expect(confirm).toHaveBeenCalledWith("Remove this subtitle cue?");
    expect(screen.getByLabelText("Subtitle text")).toBeInTheDocument();

    confirm.mockReturnValue(true);
    fireEvent.click(
      screen.getByRole("button", { name: /delete subtitle cue/i }),
    );
    expect(screen.queryByLabelText("Subtitle text")).not.toBeInTheDocument();
  });

  it("undoes and redoes subtitle edits", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /add subtitle cue/i }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /add subtitle cue/i }));
    fireEvent.change(screen.getByLabelText("Subtitle text"), {
      target: { value: "Undo me" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save cue" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo", exact: true }));
    expect(screen.getByLabelText("Subtitle text")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Redo", exact: true }));
    expect(screen.getByLabelText("Subtitle text")).toHaveValue("Undo me");
  });

  it("undoes a multi-step subtitle cue drag as one action", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => ({
        width: 1000,
        height: 100,
        top: 0,
        left: 0,
        right: 1000,
        bottom: 100,
      }),
    );
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /add subtitle cue/i }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /add subtitle cue/i }));
    const cue = screen.getByRole("button", { name: "Timeline cue" });
    act(() =>
      cue.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientX: 0 }),
      ),
    );
    act(() => {
      window.dispatchEvent(
        new MouseEvent("pointermove", { clientX: 100, bubbles: true }),
      );
      window.dispatchEvent(
        new MouseEvent("pointermove", { clientX: 200, bubbles: true }),
      );
      window.dispatchEvent(
        new MouseEvent("pointerup", { clientX: 200, bubbles: true }),
      );
    });
    expect(screen.getByRole("button", { name: "Timeline cue" })).toHaveStyle({
      left: "20%",
    });

    fireEvent.click(screen.getByRole("button", { name: "Undo", exact: true }));
    expect(screen.getByRole("button", { name: "Timeline cue" })).toHaveStyle({
      left: "0%",
    });
    fireEvent.click(screen.getByRole("button", { name: "Redo", exact: true }));
    expect(screen.getByRole("button", { name: "Timeline cue" })).toHaveStyle({
      left: "20%",
    });
  });

  it("exposes subtitle styling and removes the whole subtitle track", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /toggle subtitles settings/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /toggle subtitles settings/i }),
    );
    const subtitleFile = new File(["subtitle"], "captions.srt", {
      type: "application/x-subrip",
    });
    subtitleFile.text = async () => "1\n00:00:00,000 --> 00:00:01,000\nHello";
    fireEvent.change(screen.getByLabelText(/subtitle file/i), {
      target: { files: [subtitleFile] },
    });
    await waitFor(() =>
      expect(screen.getAllByText("Hello").length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Hello" })[0]);
    expect(screen.getByLabelText("Subtitle font")).toBeInTheDocument();
    expect(screen.getByLabelText("Subtitle position")).toBeInTheDocument();
    expect(screen.getByLabelText("Subtitle font size")).toBeInTheDocument();
    expect(screen.getByLabelText("Subtitle text color")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Subtitle highlight color"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Subtitle outline width")).toBeInTheDocument();
    expect(screen.getByText("Text Color")).toBeInTheDocument();
    expect(screen.getByText("Highlight Color")).toBeInTheDocument();
    expect(screen.getByText("Border")).toBeInTheDocument();
    expect(screen.getByText("Background Box")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Top" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Middle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bottom" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pop" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Subtitles" }),
    ).toHaveClass("w-full");
    expect(
      screen.getByRole("button", { name: "Show background box" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Show background box" }),
    );
    expect(
      screen.getByLabelText("Subtitle background opacity"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hide background box" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Hide background box" }),
    );
    expect(
      screen.getByRole("button", { name: "Show background box" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove subtitles/i }));
    expect(screen.queryByText("Hello")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /export subtitles/i }),
    ).not.toBeInTheDocument();
  });

  it("saves a named project and auto-saves later edits", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:demo");
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), {
      target: { files: [makeVideoFile()] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /save project/i }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /save project/i }));
    const saveDialog = screen.getByRole("dialog", { name: /save project/i });
    expect(saveDialog).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "Demo project" },
    });
    fireEvent.click(
      within(saveDialog).getByRole("button", { name: /^save project$/i }),
    );
    await waitFor(async () =>
      expect(
        (await listStoredProjects()).map((project) => project.name),
      ).toEqual(["Demo project"]),
    );

    fireEvent.click(screen.getByRole("button", { name: /add subtitle cue/i }));
    await waitFor(
      async () =>
        expect(
          (await listStoredProjects())[0].history.present.subtitleCues,
        ).toHaveLength(1),
      { timeout: 1500 },
    );
  });

  it("opens another project and requires confirmation before deleting it", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:project");
    const other = await createStoredProject({
      name: "Other project",
      history: {
        past: [],
        present: {
          subtitleCues: [],
          subtitleStyle: DEFAULT_SUBTITLE_STYLE,
          subtitleLanguage: "en",
          hook: null,
        },
        future: [],
      },
      file: new File(["other"], "other.mp4", { type: "video/mp4" }),
    });
    render(<LocalEditorTab />);

    fireEvent.click(screen.getByRole("button", { name: /^Projects$/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: /saved projects/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Other project" }));
    await waitFor(() =>
      expect(screen.getByText(/other\.mp4/)).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /saved projects/i }),
      ).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Projects$/i }));
    const projectsDialog = await screen.findByRole("dialog", {
      name: /saved projects/i,
    });
    const deleteOtherProject = await within(projectsDialog).findByRole(
      "button",
      { name: "Delete Other project" },
    );
    vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(deleteOtherProject);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open Other project" }),
      ).toBeInTheDocument(),
    );

    window.confirm.mockReturnValue(true);
    fireEvent.click(
      await within(
        screen.getByRole("dialog", { name: /saved projects/i }),
      ).findByRole("button", { name: "Delete Other project" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Open Other project" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      (await listStoredProjects()).find((project) => project.id === other.id),
    ).toBeUndefined();
  });
});
