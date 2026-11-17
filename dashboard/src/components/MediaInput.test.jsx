import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MediaInput from "./MediaInput";

describe("MediaInput", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("explains how the original source URL improves generated metadata", () => {
    render(
      <MediaInput
        onProcess={vi.fn()}
        isProcessing={false}
        targetClipCount={6}
        onTargetClipCountChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/adds context for clip titles and descriptions/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/selected video remains the source for processing/i),
    ).toBeInTheDocument();
  });

  it("uses the saved source language as the generation default", async () => {
    const onProcess = vi.fn();
    const { container } = render(
      <MediaInput
        onProcess={onProcess}
        isProcessing={false}
        targetClipCount={6}
        onTargetClipCountChange={vi.fn()}
        defaultTranscriptionLanguage="it"
      />,
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: /^upload$/i }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: {
        files: [new File(["video"], "source.mp4", { type: "video/mp4" })],
      },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /generate clips/i }));

    expect(onProcess).toHaveBeenCalledWith(
      expect.objectContaining({ transcriptionLanguage: "it" }),
    );
  });

  it("submits a selected MinIO object without YouTube-specific UI", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        bucket: "youtube-downloads",
        objects: [
          {
            key: "videos/source.mp4",
            name: "source.mp4",
            size: 12,
            last_modified: "2026-08-13T00:00:00Z",
          },
        ],
      }),
    });
    const onProcess = vi.fn();
    render(
      <MediaInput
        onProcess={onProcess}
        isProcessing={false}
        targetClipCount={6}
        onTargetClipCountChange={vi.fn()}
        defaultTranscriptionLanguage="it"
      />,
    );

    expect(
      screen.getByRole("tab", { name: /video library/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/youtube url/i)).not.toBeInTheDocument();

    fireEvent.click(
      await screen.findByRole("button", { name: /select source\.mp4/i }),
    );
    fireEvent.change(screen.getByLabelText(/original source url/i), {
      target: { value: "https://www.twitch.tv/videos/2842570758" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /generate clips/i }));

    expect(onProcess).toHaveBeenCalledWith({
      type: "minio-object",
      payload: { bucket: "youtube-downloads", key: "videos/source.mp4" },
      sourceUrl: "https://www.twitch.tv/videos/2842570758",
      acknowledged: true,
      layoutFormat: "standard",
      facecamSize: "medium",
      transcriptionLanguage: "it",
      clipAnalysisBackend: "configured",
      ollamaBaseUrl: "",
      ollamaModel: "",
    });
  });

  it("submits the original source URL with an uploaded file", async () => {
    const onProcess = vi.fn();
    const { container } = render(
      <MediaInput
        onProcess={onProcess}
        isProcessing={false}
        targetClipCount={6}
        onTargetClipCountChange={vi.fn()}
      />,
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: /^upload$/i }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: {
        files: [new File(["video"], "source.mp4", { type: "video/mp4" })],
      },
    });
    fireEvent.change(screen.getByLabelText(/original source url/i), {
      target: { value: "https://www.youtube.com/watch?v=source123" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /generate clips/i }));

    expect(onProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "file",
        sourceUrl: "https://www.youtube.com/watch?v=source123",
        acknowledged: true,
        layoutFormat: "standard",
        facecamSize: "medium",
      }),
    );
  });

  it("includes the selected Ollama model in a clip-generation request", async () => {
    const onProcess = vi.fn();
    const { container } = render(
      <MediaInput
        onProcess={onProcess}
        isProcessing={false}
        targetClipCount={6}
        onTargetClipCountChange={vi.fn()}
        clipAnalysisBackend="ollama"
        ollamaBaseUrl="http://host.docker.internal:11434"
        ollamaModel="qwen3-vl:8b-instruct-q4_K_M"
        ollamaAvailable
      />,
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: /^upload$/i }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: {
        files: [new File(["video"], "source.mp4", { type: "video/mp4" })],
      },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /generate clips/i }));

    expect(onProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        clipAnalysisBackend: "ollama",
        ollamaBaseUrl: "http://host.docker.internal:11434",
        ollamaModel: "qwen3-vl:8b-instruct-q4_K_M",
      }),
    );
  });

  it("allows selecting the configured local model before it is installed", async () => {
    const onClipAnalysisBackendChange = vi.fn();
    render(
      <MediaInput
        onProcess={vi.fn()}
        isProcessing={false}
        targetClipCount={6}
        onTargetClipCountChange={vi.fn()}
        ollamaModel="qwen3-vl:8b-instruct-q4_K_M"
        ollamaAvailable={false}
        onClipAnalysisBackendChange={onClipAnalysisBackendChange}
      />,
    );

    const provider = screen.getByRole("combobox", { name: "Clip analysis" });
    fireEvent.keyDown(provider, { key: "ArrowDown" });
    const localOption = await screen.findByRole("option", {
      name: "Local · qwen3-vl:8b-instruct-q4_K_M",
    });

    expect(localOption).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(localOption);
    expect(onClipAnalysisBackendChange).toHaveBeenCalledWith("ollama");
  });

  it("keeps generation disabled when the selected local model is unavailable", () => {
    const { container } = render(
      <MediaInput
        onProcess={vi.fn()}
        isProcessing={false}
        targetClipCount={6}
        onTargetClipCountChange={vi.fn()}
        clipAnalysisBackend="ollama"
        ollamaModel="qwen3-vl:8b-instruct-q4_K_M"
        ollamaAvailable={false}
      />,
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: /^upload$/i }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: {
        files: [new File(["video"], "source.mp4", { type: "video/mp4" })],
      },
    });
    fireEvent.click(screen.getByRole("checkbox"));

    expect(
      screen.getByRole("button", { name: /generate clips/i }),
    ).toBeDisabled();
  });

  it("submits Streamer Stack with the selected facecam size and no pre-generation hook control", async () => {
    const onProcess = vi.fn();
    const { container } = render(
      <MediaInput
        onProcess={onProcess}
        isProcessing={false}
        targetClipCount={6}
        onTargetClipCountChange={vi.fn()}
      />,
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: /^upload$/i }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: {
        files: [new File(["video"], "source.mp4", { type: "video/mp4" })],
      },
    });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Output layout" }), {
      key: "Enter",
    });
    fireEvent.click(
      await screen.findByRole("option", { name: "Streamer stack" }),
    );
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Facecam size" }), {
      key: "Enter",
    });
    fireEvent.click(await screen.findByRole("option", { name: "Large" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /generate clips/i }));

    expect(screen.queryByLabelText(/hook/i)).not.toBeInTheDocument();
    expect(onProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "file",
        layoutFormat: "streamer_stack",
        facecamSize: "large",
      }),
    );
  });
});
