import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SourceTranscriptEditor from "./SourceTranscriptEditor";

vi.mock("../local-editor/LocalEditorTab", () => ({
  default: ({ activeSubtitleTrackId, onSubtitleTrackChange }) => (
    <div>
      <output data-testid="active-track">{activeSubtitleTrackId}</output>
      <button
        type="button"
        onClick={() => onSubtitleTrackChange("translation-it")}
      >
        Select Italian translation
      </button>
    </div>
  ),
}));

vi.mock("../../lib/videoUrls", () => ({
  useRenewableMediaUrl: () => ({ url: "http://localhost/source.mp4" }),
}));

const sourcePayload = {
  source_video_url: "/source.mp4",
  transcript: {
    language: "it",
    segments: [{ start: 0, end: 1, text: "Ciao" }],
  },
  subtitle_tracks: [
    {
      id: "original",
      language: "it",
      origin: "original",
      cues: [{ text: "Ciao", startMs: 0, endMs: 1000 }],
    },
    {
      id: "translation-it",
      language: "en",
      origin: "translation",
      label: "English translation",
      cues: [{ text: "Hello", startMs: 0, endMs: 1000 }],
    },
  ],
};

const mockFetch = () => {
  globalThis.fetch = vi.fn((input) => {
    const url = String(input);
    const payload = url.includes("/source-transcript")
      ? sourcePayload
      : { clips: [] };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });
  });
};

describe("SourceTranscriptEditor active subtitle track", () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetch();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("restores the selected translation after the editor remounts", async () => {
    const firstMount = render(
      <SourceTranscriptEditor projectId="project-1" onClose={vi.fn()} />,
    );
    expect(await screen.findByTestId("active-track")).toHaveTextContent(
      "original",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Select Italian translation" }),
    );
    expect(screen.getByTestId("active-track")).toHaveTextContent(
      "translation-it",
    );
    firstMount.unmount();

    render(<SourceTranscriptEditor projectId="project-1" onClose={vi.fn()} />);

    expect(await screen.findByTestId("active-track")).toHaveTextContent(
      "translation-it",
    );
  });
});
