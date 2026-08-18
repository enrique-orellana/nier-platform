import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SubtitleTranslationPanel from "./SubtitleTranslationPanel";

describe("SubtitleTranslationPanel", () => {
  it("keeps original and adds a translated track", async () => {
    const onTrackAdded = vi.fn();
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
          translationId: "translation-1",
          status: "done",
          track: { id: "es", label: "ES", language: "es" },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SubtitleTranslationPanel
        jobId="job"
        clipIndex={0}
        versionId="v1"
        tracks={[
          {
            id: "original",
            language: "en",
            label: "Original",
            cues: [{ text: "One" }, { text: "Two" }],
          },
        ]}
        activeTrackId="original"
        aiHeaders={{ "X-AI-Api-Key": "test" }}
        onTrackAdded={onTrackAdded}
        onSelectTrack={vi.fn()}
      />,
    );

    expect(screen.getByText(/2 cues/)).toBeInTheDocument();
    expect(screen.getByText(/source track/i)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Translate Track" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Translate entire track" }),
    );
    await waitFor(() => expect(onTrackAdded).toHaveBeenCalled());
    expect(
      screen.getByRole("option", { name: "Original" }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("offers English as a translation target for non-English source tracks", () => {
    render(
      <SubtitleTranslationPanel
        jobId="job"
        clipIndex={0}
        versionId="v1"
        tracks={[{ id: "original", language: "es", label: "Original" }]}
        activeTrackId="original"
        onTrackAdded={vi.fn()}
        onSelectTrack={vi.fn()}
      />,
    );

    expect(screen.getByRole("option", { name: "English" })).toBeInTheDocument();
  });

  it("offers deletion for translated tracks", () => {
    const onTrackRemoved = vi.fn();
    render(
      <SubtitleTranslationPanel
        jobId="job"
        clipIndex={0}
        versionId="v1"
        tracks={[
          {
            id: "original",
            language: "en",
            label: "Original",
            origin: "original",
          },
          { id: "es", language: "es", label: "ES", origin: "translation" },
        ]}
        activeTrackId="original"
        onTrackAdded={vi.fn()}
        onTrackRemoved={onTrackRemoved}
        onSelectTrack={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Delete ES translation" }),
    );
    expect(onTrackRemoved).toHaveBeenCalledWith("es");
  });
});
