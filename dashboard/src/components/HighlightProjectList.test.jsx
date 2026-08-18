import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HighlightProjectList from "./HighlightProjectList";

vi.mock("./MinioObjectPicker", () => ({
  default: ({ onSelect }) => (
    <button
      type="button"
      onClick={() =>
        onSelect({ bucket: "youtube-downloads", key: "videos/source.mp4" })
      }
    >
      Select source.mp4
    </button>
  ),
}));

describe("HighlightProjectList", () => {
  const getAiHeaders = vi.fn(() => ({
    "Content-Type": "application/json",
    "X-AI-Provider": "openai-codex",
  }));

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads persisted projects and renders completed output links", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        projects: [
          {
            id: "project-1",
            name: "Episode one",
            source_object: {
              bucket: "youtube-downloads",
              key: "videos/source.mp4",
            },
            min_minutes: 12,
            ideal_minutes: 20,
            status: "completed",
            job: {
              id: "job-1",
              status: "completed",
              logs: ["Ready"],
              result: {
                video_url: "/videos/job-1/highlights.mp4",
                manifest_url: "/videos/job-1/manifest.json",
              },
            },
          },
        ],
      }),
    });

    render(
      <HighlightProjectList
        getAiHeaders={getAiHeaders}
        aiProvider="openai-codex"
      />,
    );

    expect((await screen.findAllByText("Episode one")).length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getByRole("link", { name: /download highlights/i }),
    ).toHaveAttribute("href", "/videos/job-1/highlights.mp4");
    expect(
      screen.getByRole("link", { name: /view manifest/i }),
    ).toHaveAttribute("href", "/videos/job-1/manifest.json");
    expect(fetch).toHaveBeenCalledWith("/api/highlights/projects");
  });

  it("creates a project without persisting AI credentials", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ projects: [] }),
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "project-1",
        name: "Episode one",
        status: "queued",
        job: { id: "job-1", status: "queued", logs: [] },
      }),
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ projects: [] }),
    });

    render(
      <HighlightProjectList
        getAiHeaders={getAiHeaders}
        aiProvider="openai-codex"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /select source.mp4/i }));
    fireEvent.change(screen.getByLabelText(/project name/i), {
      target: { value: "Episode one" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /create project/i }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/highlights/projects",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const request = fetch.mock.calls[1][1];
    expect(request.headers).toEqual(
      expect.objectContaining({ "X-AI-Provider": "openai-codex" }),
    );
    const body = JSON.parse(request.body);
    expect(body).toEqual(
      expect.objectContaining({
        name: "Episode one",
        source_object: {
          bucket: "youtube-downloads",
          key: "videos/source.mp4",
        },
        min_minutes: 12,
        ideal_minutes: 20,
        acknowledged: true,
      }),
    );
    expect(body).not.toHaveProperty("api_key");
  });

  it("deletes a selected project and reloads the list", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        projects: [
          {
            id: "project-1",
            name: "Episode one",
            status: "failed",
            job: { id: "job-1", status: "failed", logs: [] },
          },
        ],
      }),
    });
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ projects: [] }),
    });

    render(
      <HighlightProjectList
        getAiHeaders={getAiHeaders}
        aiProvider="openai-codex"
      />,
    );
    expect((await screen.findAllByText("Episode one")).length).toBeGreaterThan(
      0,
    );
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/highlights/projects/project-1", {
        method: "DELETE",
      }),
    );
    expect(
      await screen.findByText(/no highlights projects/i),
    ).toBeInTheDocument();
  });
});
