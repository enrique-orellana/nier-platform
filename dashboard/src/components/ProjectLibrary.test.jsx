import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProjectLibrary from "./ProjectLibrary";

describe("ProjectLibrary", () => {
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.removeItem(
      "openshorts.project-library.status-filters:job-filter",
    );
  });

  it("shows an editor loading screen while opening a direct editor link", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );

    render(
      <ProjectLibrary projectId="job-direct" editorOpen editorClipIndex={0} />,
    );

    expect(
      screen.getByRole("status", { name: "Loading editor" }),
    ).toBeInTheDocument();
  });

  it("opens the processing timeline drawer and renders audited request bodies", async () => {
    const fetchMock = vi.fn((url) => {
      const value = String(url);
      if (value.includes("/api/projects/history")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            projects: [
              {
                job_id: "job-audit",
                title: "Audited project",
                clips: [],
                clip_count: 0,
              },
            ],
          }),
        });
      }
      if (value.includes("/api/projects/clips/job-audit")) {
        return Promise.resolve({ ok: true, json: async () => ({ clips: [] }) });
      }
      if (value.includes("/api/projects/job-audit/statuses")) {
        return Promise.resolve({ ok: true, json: async () => ({ clips: {} }) });
      }
      if (value.includes("/api/projects/job-audit/audit")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            job_id: "job-audit",
            policy: {
              body_allowlist: ["openrouter.ai"],
              non_allowlisted_mode: "metadata_only",
              binary_mode: "metadata_only",
              body_truncated: false,
            },
            events: [
              {
                id: "audit-1",
                sequence: 1,
                category: "external_request",
                name: "ai.analysis",
                status: "completed",
                provider: "openrouter",
                host: "openrouter.ai",
                method: "POST",
                http_status: 200,
                duration_ms: 842,
                request_body: '{"prompt":"hello"}',
                response_body: '{"result":"ok"}',
                capture_mode: "full_redacted",
                started_at: "2026-08-21T08:40:52Z",
                finished_at: "2026-08-21T08:40:53Z",
              },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectLibrary projectId="job-audit" />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: /open processing timeline/i,
      }),
    );

    expect(
      await screen.findByRole("dialog", { name: /processing timeline/i }),
    ).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: /processing timeline/i });
    expect(dialog.className).toContain("flex-col");
    expect(dialog.className).toContain("overflow-hidden");
    expect(screen.getByTestId("audit-scroll-region").className).toContain(
      "overflow-y-auto",
    );
    expect(screen.getByText("ai.analysis")).toBeInTheDocument();
    expect(screen.getByText(/POST openrouter\.ai/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Inspect captured details"));
    const auditBodies = Array.from(document.querySelectorAll("pre")).map(
      (element) => element.textContent,
    );
    expect(auditBodies).toContain('{\n  "prompt": "hello"\n}');
    expect(auditBodies).toContain('{\n  "result": "ok"\n}');
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/job-audit/audit");
  });

  it("opens all source metadata from the project header button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url) => {
        if (String(url).includes("/api/projects/history")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              projects: [
                {
                  job_id: "job-source-details",
                  title: "Project with source details",
                  clips: [],
                  source_metadata: {
                    categories: ["Gaming"],
                    channel: "Rubius Z",
                    description: "A detailed source description",
                    duration: 2331,
                    id: "CD6p5aHx5gw",
                    platform: "youtube",
                    source_url: "https://example.com/source",
                    tags: ["rubius", "meltopia"],
                    thumbnail: "https://example.com/thumbnail.webp",
                    title: "Hice un MEGA-AGUJERO de Hielo",
                    upload_date: "20260731",
                    view_count: 2488618,
                    webpage_url: "https://example.com/watch",
                  },
                },
              ],
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }),
    );

    render(<ProjectLibrary projectId="job-source-details" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "View source details" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Source details" });
    expect(dialog).toHaveTextContent("Hice un MEGA-AGUJERO de Hielo");
    expect(dialog).toHaveTextContent("Rubius Z");
    expect(dialog).toHaveTextContent("A detailed source description");
    expect(dialog).toHaveTextContent("2,488,618");
    expect(dialog).toHaveTextContent("rubius");
    expect(dialog).toHaveTextContent("Gaming");
    expect(
      screen.getByRole("link", { name: "Open source page" }),
    ).toHaveAttribute("href", "https://example.com/watch");
  });

  it("notifies the router when opening a clip editor", async () => {
    const onOpenEditor = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn((url) => {
        if (String(url).includes("/api/projects/history")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              projects: [
                {
                  job_id: "job-editor",
                  title: "Editor project",
                  clips: [
                    {
                      index: 0,
                      title: "Clip 1",
                      start: 0,
                      end: 10,
                      video_url: "/videos/job-editor/clip-0.mp4",
                    },
                  ],
                  clip_count: 1,
                },
              ],
            }),
          });
        }
        if (String(url).includes("/api/projects/job-editor/statuses")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ clips: {} }),
          });
        }
        if (String(url).includes("/api/projects/clips/job-editor")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              clips: [
                {
                  index: 0,
                  title: "Clip 1",
                  start: 0,
                  end: 10,
                  video_url: "/videos/job-editor/clip-0.mp4",
                },
              ],
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }),
    );

    render(
      <ProjectLibrary projectId="job-editor" onOpenEditor={onOpenEditor} />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Timeline" }),
    );

    expect(onOpenEditor).toHaveBeenCalledWith("job-editor", 0, null);
  });

  it("rehydrates an active clip render after mounting the project", async () => {
    const fetchMock = vi.fn((url) => {
      const value = String(url);
      if (value.includes("/api/projects/history")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            projects: [
              {
                job_id: "job-recovery",
                title: "Recovery project",
                clips: [{ index: 0, title: "Clip 1", start: 0, end: 10 }],
                clip_count: 1,
              },
            ],
          }),
        });
      }
      if (value.includes("/api/projects/clips/job-recovery")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            clips: [{ index: 0, title: "Clip 1", start: 0, end: 10 }],
          }),
        });
      }
      if (value.includes("/api/projects/job-recovery/statuses")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ clips: {} }),
        });
      }
      if (value.includes("/api/status/clip-render-recovered")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: "processing" }),
        });
      }
      if (value.includes("/api/status/job-recovery")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: "clips_ready",
            result: {
              clips: [
                {
                  index: 0,
                  title: "Clip 1",
                  start: 0,
                  end: 10,
                  render_status: "rendering",
                },
              ],
            },
            clip_renders: [
              {
                clip_index: 0,
                job_id: "clip-render-recovered",
                status: "processing",
              },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectLibrary projectId="job-recovery" />);

    expect(await screen.findByText(/Rendering/)).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/status/clip-render-recovered"),
        expect.anything(),
      ),
    );
  });

  it("allows multiple workflow status filters at once", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url) => {
        if (String(url).includes("/api/projects/history")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              projects: [
                {
                  job_id: "job-filter",
                  title: "Filter project",
                  clips: [
                    { index: 0, title: "Not reviewed clip" },
                    { index: 1, title: "Reviewing clip" },
                    { index: 2, title: "Edited clip" },
                  ],
                  clip_count: 3,
                },
              ],
            }),
          });
        }
        if (String(url).includes("/api/projects/job-filter/statuses")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              clips: {
                0: { status: "not_reviewed" },
                1: { status: "reviewing" },
                2: { status: "edited" },
              },
            }),
          });
        }
        if (String(url).includes("/api/projects/clips/job-filter")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              clips: [
                { index: 0, title: "Not reviewed clip" },
                { index: 1, title: "Reviewing clip" },
                { index: 2, title: "Edited clip" },
              ],
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }),
    );

    const { unmount } = render(<ProjectLibrary projectId="job-filter" />);

    const notReviewed = await screen.findByRole("button", {
      name: "Not reviewed (1)",
    });
    const reviewing = screen.getByRole("button", { name: "Reviewing (1)" });

    fireEvent.click(notReviewed);
    expect(screen.getByText("1 clip", { exact: false })).toBeInTheDocument();

    fireEvent.click(reviewing);

    expect(screen.getByText("2 clips", { exact: false })).toBeInTheDocument();
    expect(notReviewed).toHaveAttribute("aria-pressed", "true");
    expect(reviewing).toHaveAttribute("aria-pressed", "true");
    expect(
      window.localStorage.getItem(
        "openshorts.project-library.status-filters:job-filter",
      ),
    ).toBe(JSON.stringify(["not_reviewed", "reviewing"]));

    unmount();
    render(<ProjectLibrary projectId="job-filter" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Not reviewed (1)" }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        screen.getByRole("button", { name: "Reviewing (1)" }),
      ).toHaveAttribute("aria-pressed", "true");
    });
    expect(screen.getByText("2 clips", { exact: false })).toBeInTheDocument();
  });

  it("applies regenerated subtitles returned with an updated clip range", async () => {
    const fetchMock = vi.fn((url) => {
      if (String(url).includes("/api/projects/history")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            projects: [
              {
                job_id: "job-range",
                title: "Range project",
                source_duration_seconds: 3577,
                clips: [
                  {
                    index: 0,
                    start: 176,
                    end: 204,
                    video_url: "/videos/job-range/clip.mp4",
                    subtitle_tracks: [
                      {
                        id: "original",
                        origin: "generated",
                        captions: [{ text: "Old", startMs: 0, endMs: 1000 }],
                      },
                    ],
                    active_subtitle_track_id: "original",
                  },
                ],
                clip_count: 1,
              },
            ],
          }),
        });
      }
      if (String(url).includes("/api/jobs/job-range/clips/0/source-range")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            start: 150,
            end: 230,
            subtitle_tracks: [
              {
                id: "original",
                origin: "generated",
                captions: [{ text: "Updated", startMs: 5000, endMs: 6000 }],
              },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectLibrary projectId="job-range" />);

    fireEvent.click(await screen.findByRole("button", { name: "Trim Range" }));
    fireEvent.change(screen.getByTestId("clip-range-start"), {
      target: { value: "150" },
    });
    fireEvent.change(screen.getByTestId("clip-range-end"), {
      target: { value: "230" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save clip range" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/jobs/job-range/clips/0/source-range",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Subtitle details" }));
    expect(await screen.findByText("Updated")).toBeInTheDocument();
    expect(screen.queryByText("Old")).not.toBeInTheDocument();
  });

  it("does not nest the delete button inside the project card control", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          projects: [
            {
              job_id: "job-1",
              title: "Test project",
              clips: [{ video_url: "/videos/job-1/clip.mp4" }],
              clip_count: 1,
            },
          ],
        }),
      }),
    );

    const { container } = render(<ProjectLibrary />);

    await waitFor(() => {
      expect(container.querySelector('[title="Delete Project"]')).toBeTruthy();
    });

    expect(container.querySelectorAll("button button")).toHaveLength(0);
  });

  it("keeps external history videos on their direct storage URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          projects: [
            {
              job_id: "job-2",
              title: "External project",
              clips: [
                {
                  video_url:
                    "http://minio.example/job-2/clip.mp4?signature=old",
                },
              ],
              clip_count: 1,
            },
          ],
        }),
      }),
    );

    render(<ProjectLibrary />);

    await waitFor(() => {
      const video = document.querySelector("video");
      expect(video?.getAttribute("src")).toBe(
        "http://minio.example/job-2/clip.mp4?signature=old",
      );
    });
  });

  it("deduplicates the initial history request under StrictMode", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ projects: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StrictMode>
        <ProjectLibrary />
      </StrictMode>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("/api/projects/history"),
      ),
    ).toHaveLength(1);
  });

  it("uses the source video for a project card without a rendered clip", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          projects: [
            {
              job_id: "job-source-only",
              title: "Source project",
              clips: [
                {
                  source_video_url:
                    "https://minio.example/job-source-only/source.mp4?signature=old",
                },
              ],
            },
          ],
        }),
      }),
    );

    render(<ProjectLibrary />);

    await waitFor(() => {
      expect(document.querySelector("video")?.getAttribute("src")).toBe(
        "https://minio.example/job-source-only/source.mp4?signature=old",
      );
      expect(screen.getByText("1 CLIPS")).toBeInTheDocument();
    });
  });

  it("previews an unrendered candidate from the stored source video", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url) => {
        if (String(url).includes("/api/projects/history")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              projects: [
                {
                  job_id: "job-3",
                  title: "Candidate project",
                  clips: [
                    {
                      index: 0,
                      start: 12,
                      end: 20,
                      source_video_url: "/videos/job-3/source.mp4",
                      render_status: "found",
                    },
                  ],
                  clip_count: 1,
                },
              ],
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ clips: {} }) });
      }),
    );

    render(<ProjectLibrary projectId="job-3" />);

    await waitFor(() => {
      expect(document.querySelector("video")?.getAttribute("src")).toBe(
        "/videos/job-3/source.mp4",
      );
    });
  });

  it("switches to the rendered video when status metadata reports completion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url) => {
        if (String(url).includes("/api/projects/history")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              projects: [
                {
                  job_id: "job-rendered",
                  title: "Rendered project",
                  clips: [
                    {
                      index: 0,
                      source_video_url: "/videos/job-rendered/source.mp4",
                      render_status: "found",
                    },
                  ],
                },
              ],
            }),
          });
        }
        if (String(url).includes("/api/projects/clips/job-rendered")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              clips: [
                {
                  index: 0,
                  source_video_url: "/videos/job-rendered/source.mp4",
                  render_status: "found",
                },
              ],
            }),
          });
        }
        if (String(url).includes("/api/status/job-rendered")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              result: {
                clips: [
                  {
                    index: 0,
                    render_status: "ready",
                    render_job_id: "render-job-1",
                    video_filename: "rendered_clip_1.mp4",
                    manifest_path: "manifests/clip_1.json",
                  },
                ],
              },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ clips: {} }) });
      }),
    );

    render(<ProjectLibrary projectId="job-rendered" />);

    await waitFor(() => {
      expect(document.querySelector("video")?.getAttribute("src")).toBe(
        "/videos/job-rendered/rendered_clip_1.mp4",
      );
    });
  });

  it("does not fetch a transcript while a project clip card is loading", async () => {
    const fetchMock = vi.fn((url) => {
      if (String(url).includes("/api/projects/history")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            projects: [
              {
                job_id: "job-5",
                title: "Transcript-on-demand project",
                clips: [
                  {
                    index: 0,
                    start: 12,
                    end: 20,
                    source_video_url: "/videos/job-5/source.mp4",
                    render_status: "found",
                  },
                ],
                clip_count: 1,
              },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ clips: [] }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectLibrary projectId="job-5" />);

    await waitFor(
      () => expect(screen.getByText("Generated Clips")).toBeInTheDocument(),
      { timeout: 5000 },
    );
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: "Analyze & Render" }),
        ).toBeInTheDocument(),
      { timeout: 5000 },
    );
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/transcript")),
    ).toBe(false);
  });

  it("queues rendering from a historical candidate card", async () => {
    const fetchMock = vi.fn((url, options = {}) => {
      if (String(url).includes("/api/projects/history")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            projects: [
              {
                job_id: "job-4",
                title: "Candidate project",
                clips: [
                  {
                    index: 0,
                    start: 12,
                    end: 20,
                    source_video_url: "/videos/job-4/source.mp4",
                    render_status: "found",
                  },
                ],
                clip_count: 1,
              },
            ],
          }),
        });
      }
      if (String(url).includes("/api/jobs/job-4/clips/0/render")) {
        expect(options.method).toBe("POST");
        return Promise.resolve({
          ok: true,
          json: async () => ({ job_id: "render-4" }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ clips: {} }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectLibrary projectId="job-4" />);

    const button = await screen.findByRole("button", {
      name: "Analyze & Render",
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/jobs/job-4/clips/0/render",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("marks a missing child render job as failed instead of polling forever", async () => {
    const fetchMock = vi.fn((url, options = {}) => {
      if (String(url).includes("/api/projects/history")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            projects: [
              {
                job_id: "job-missing-render",
                title: "Missing render project",
                clips: [
                  {
                    index: 0,
                    start: 12,
                    end: 20,
                    source_video_url: "/videos/job-missing-render/source.mp4",
                    render_status: "found",
                  },
                ],
                clip_count: 1,
              },
            ],
          }),
        });
      }
      if (String(url).includes("/api/jobs/job-missing-render/clips/0/render")) {
        expect(options.method).toBe("POST");
        return Promise.resolve({
          ok: true,
          json: async () => ({ job_id: "render-missing" }),
        });
      }
      if (String(url).includes("/api/status/render-missing")) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({}),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ clips: [] }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectLibrary projectId="job-missing-render" />);

    const button = await screen.findByRole("button", {
      name: "Analyze & Render",
    });
    fireEvent.click(button);

    expect(
      await screen.findByRole("button", { name: "Retry" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Render job no longer exists."),
    ).toBeInTheDocument();
  });

  it("keeps polling when the child status endpoint returns a server error", async () => {
    const fetchMock = vi.fn((url, options = {}) => {
      if (String(url).includes("/api/projects/history")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            projects: [
              {
                job_id: "job-status-error",
                title: "Status error project",
                clips: [
                  {
                    index: 0,
                    start: 12,
                    end: 20,
                    source_video_url: "/videos/job-status-error/source.mp4",
                    render_status: "found",
                  },
                ],
                clip_count: 1,
              },
            ],
          }),
        });
      }
      if (String(url).includes("/api/jobs/job-status-error/clips/0/render")) {
        expect(options.method).toBe("POST");
        return Promise.resolve({
          ok: true,
          json: async () => ({ job_id: "render-status-error" }),
        });
      }
      if (String(url).includes("/api/status/render-status-error")) {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: async () => ({}),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ clips: [] }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectLibrary projectId="job-status-error" />);

    const button = await screen.findByRole("button", {
      name: "Analyze & Render",
    });
    fireEvent.click(button);

    expect(await screen.findByText(/Queued/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
  });

  it("retries when the render status request hangs", async () => {
    try {
      const fetchMock = vi.fn((url, options = {}) => {
        if (String(url).includes("/api/projects/history")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              projects: [
                {
                  job_id: "job-status-timeout",
                  title: "Status timeout project",
                  clips: [
                    {
                      index: 0,
                      start: 12,
                      end: 20,
                      source_video_url: "/videos/job-status-timeout/source.mp4",
                      render_status: "found",
                    },
                  ],
                  clip_count: 1,
                },
              ],
            }),
          });
        }
        if (
          String(url).includes("/api/jobs/job-status-timeout/clips/0/render")
        ) {
          expect(options.method).toBe("POST");
          return Promise.resolve({
            ok: true,
            json: async () => ({ job_id: "render-status-timeout" }),
          });
        }
        if (String(url).includes("/api/status/render-status-timeout")) {
          return new Promise(() => {});
        }
        return Promise.resolve({ ok: true, json: async () => ({ clips: [] }) });
      });
      vi.stubGlobal("fetch", fetchMock);

      render(<ProjectLibrary projectId="job-status-timeout" />);

      const button = await screen.findByRole("button", {
        name: "Analyze & Render",
      });
      vi.useFakeTimers();
      await act(async () => {
        fireEvent.click(button);
      });

      await act(async () => {
        for (let i = 0; i < 10; i++) {
          await Promise.resolve();
        }
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(16000);
      });
      vi.useRealTimers();

      expect(screen.getByText(/Queued/)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Retry" }),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconciles stale rendering metadata so a failed render can be retried after returning to the project", async () => {
    const fetchMock = vi.fn((url) => {
      if (String(url).includes("/api/projects/history")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            projects: [
              {
                job_id: "job-stale",
                title: "Interrupted project",
                clips: [
                  {
                    index: 0,
                    start: 10,
                    end: 20,
                    source_video_url: "/videos/job-stale/source.mp4",
                    render_status: "rendering",
                  },
                ],
                clip_count: 1,
              },
            ],
          }),
        });
      }
      if (String(url).includes("/api/projects/clips/job-stale")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            clips: [
              {
                index: 0,
                start: 10,
                end: 20,
                source_video_url: "/videos/job-stale/source.mp4",
                render_status: "rendering",
              },
            ],
          }),
        });
      }
      if (String(url).includes("/api/status/job-stale")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: "clips_ready",
            result: {
              clips: [
                {
                  render_status: "failed",
                  render_error: "Database connection lost.",
                },
              ],
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ clips: {} }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectLibrary projectId="job-stale" />);

    expect(
      await screen.findByRole("button", { name: "Retry" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Database connection lost.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/status/job-stale");
  });

  it("saves a webcam region per Streamer Stack clip before enabling render", async () => {
    const fetchMock = vi.fn((url, options = {}) => {
      if (String(url).includes("/api/projects/history")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            projects: [
              {
                job_id: "job-5",
                title: "Streamer project",
                clips: [
                  {
                    index: 0,
                    start: 12,
                    end: 20,
                    source_video_url: "/videos/job-5/source.mp4",
                    layout_format: "streamer_stack",
                    facecam_size: "large",
                    streamer_tracking_enabled: false,
                    gameplay_zoom: 1,
                    render_status: "found",
                  },
                ],
                clip_count: 1,
              },
            ],
          }),
        });
      }
      if (String(url).includes("/api/jobs/job-5/clips/0/webcam-region")) {
        expect(options.method).toBe("PATCH");
        const body = JSON.parse(options.body);
        expect(body.webcam_region).toEqual(
          expect.objectContaining({ width: expect.any(Number) }),
        );
        expect(body.facecam_size).toBe("small");
        return Promise.resolve({
          ok: true,
          json: async () => ({
            webcam_region: { x: 0.05, y: 0.1, width: 0.25, height: 0.4 },
            facecam_size: "small",
          }),
        });
      }
      if (String(url).includes("/api/jobs/job-5/clips/0/gameplay-region")) {
        expect(options.method).toBe("PATCH");
        expect(JSON.parse(options.body).gameplay_region).toEqual(
          expect.objectContaining({ width: expect.any(Number) }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            gameplay_region: { x: 0.3, y: 0.1, width: 0.6, height: 0.8 },
          }),
        });
      }
      if (String(url).includes("/api/jobs/job-5/clips/0/streamer-tracking")) {
        expect(options.method).toBe("PATCH");
        expect(JSON.parse(options.body)).toEqual({
          streamer_tracking_enabled: true,
        });
        return Promise.resolve({
          ok: true,
          json: async () => ({ streamer_tracking_enabled: true }),
        });
      }
      if (String(url).includes("/api/jobs/job-5/clips/0/gameplay-zoom")) {
        expect(options.method).toBe("PATCH");
        expect(JSON.parse(options.body)).toEqual({ gameplay_zoom: 1.1 });
        return Promise.resolve({
          ok: true,
          json: async () => ({ gameplay_zoom: 1.1 }),
        });
      }
      if (String(url).includes("/api/jobs/job-5/clips/0/render")) {
        expect(options.method).toBe("POST");
        return Promise.resolve({
          ok: true,
          json: async () => ({ job_id: "render-5" }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ clips: {} }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectLibrary projectId="job-5" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Select Webcam Area" }),
    );
    expect(
      screen.getByRole("button", { name: "Analyze & Render" }),
    ).toBeDisabled();

    const stage = screen.getByTestId("webcam-region-stage");
    const video = screen.getByTestId("webcam-region-video");
    Object.defineProperty(stage, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 400,
        height: 225,
        right: 400,
        bottom: 225,
      }),
    });
    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      value: 1600,
    });
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      value: 900,
    });
    fireEvent.loadedMetadata(video);
    fireEvent.change(screen.getByLabelText("Webcam panel size"), {
      target: { value: "small" },
    });
    const down = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(down, "clientX", { value: 40 });
    Object.defineProperty(down, "clientY", { value: 30 });
    fireEvent(stage, down);
    const move = new Event("pointermove");
    Object.defineProperty(move, "clientX", { value: 180 });
    Object.defineProperty(move, "clientY", { value: 150 });
    fireEvent(window, move);
    fireEvent(window, new Event("pointerup"));
    fireEvent.click(screen.getByRole("button", { name: "Save webcam area" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/jobs/job-5/clips/0/webcam-region",
        expect.objectContaining({ method: "PATCH" }),
      );
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Webcam Area" }),
    );
    expect(screen.getByLabelText("Webcam panel size")).toHaveValue("small");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.getByRole("button", { name: "Analyze & Render" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Select Gameplay Area" }),
    );
    const gameplayStage = screen.getByTestId("gameplay-region-stage");
    const gameplayVideo = screen.getByTestId("gameplay-region-video");
    Object.defineProperty(gameplayStage, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 400,
        height: 225,
        right: 400,
        bottom: 225,
      }),
    });
    Object.defineProperty(gameplayVideo, "videoWidth", {
      configurable: true,
      value: 1600,
    });
    Object.defineProperty(gameplayVideo, "videoHeight", {
      configurable: true,
      value: 900,
    });
    fireEvent.loadedMetadata(gameplayVideo);
    const gameplayDown = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(gameplayDown, "clientX", { value: 140 });
    Object.defineProperty(gameplayDown, "clientY", { value: 25 });
    fireEvent(gameplayStage, gameplayDown);
    const gameplayMove = new Event("pointermove");
    Object.defineProperty(gameplayMove, "clientX", { value: 350 });
    Object.defineProperty(gameplayMove, "clientY", { value: 200 });
    fireEvent(window, gameplayMove);
    fireEvent(window, new Event("pointerup"));
    fireEvent.click(screen.getByRole("button", { name: "Save gameplay area" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/jobs/job-5/clips/0/gameplay-region",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Analyze & Render" }),
      ).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview 9:16" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Save zoom" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/jobs/job-5/clips/0/gameplay-zoom",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Use Face/Person Tracking" }),
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/jobs/job-5/clips/0/streamer-tracking",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyze & Render" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/jobs/job-5/clips/0/render",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("loads and updates a status independently for each clip", async () => {
    const fetchMock = vi.fn((url, options = {}) => {
      if (String(url).includes("/api/projects/history")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            projects: [
              {
                job_id: "job-1",
                title: "Test project",
                clips: [
                  { video_url: "/videos/job-1/clip-1.mp4", index: 0 },
                  { video_url: "/videos/job-1/clip-2.mp4", index: 1 },
                ],
                clip_count: 2,
              },
            ],
          }),
        });
      }
      if (String(url).includes("/api/projects/job-1/statuses")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            version: 1,
            clips: {
              0: { status: "reviewing" },
              1: { status: "discarded" },
            },
          }),
        });
      }
      if (String(url).includes("/api/projects/job-1/clips/0/status")) {
        expect(options.method).toBe("PATCH");
        expect(JSON.parse(options.body)).toEqual({ status: "edited" });
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: "edited",
            updated_at: "2026-08-12T18:30:00Z",
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ clips: [] }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectLibrary projectId="job-1" />);

    await waitFor(() => {
      const loadedSelects = screen.getAllByLabelText("Clip status");
      expect(loadedSelects).toHaveLength(2);
      expect(loadedSelects[0]).toHaveValue("reviewing");
      expect(loadedSelects[1]).toHaveValue("discarded");
    });
    const selects = screen.getAllByLabelText("Clip status");
    expect(selects[0]).toHaveValue("reviewing");
    expect(selects[1]).toHaveValue("discarded");

    fireEvent.change(selects[0], { target: { value: "edited" } });

    await waitFor(() =>
      expect(screen.getAllByLabelText("Clip status")[0]).toHaveValue("edited"),
    );
    expect(screen.getAllByLabelText("Clip status")[1]).toHaveValue("discarded");
    expect(screen.getByText(/1 edited · 1 discarded/)).toBeInTheDocument();
  });

  it("rolls back an optimistic status update when saving fails", async () => {
    const fetchMock = vi.fn((url) => {
      if (String(url).includes("/api/projects/history")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            projects: [
              {
                job_id: "job-1",
                title: "Test project",
                clips: [{ video_url: "/videos/job-1/clip-1.mp4", index: 0 }],
                clip_count: 1,
              },
            ],
          }),
        });
      }
      if (String(url).includes("/api/projects/job-1/statuses")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            version: 1,
            clips: { 0: { status: "reviewing" } },
          }),
        });
      }
      if (String(url).includes("/api/projects/job-1/clips/0/status")) {
        return Promise.resolve({ ok: false, text: async () => "save failed" });
      }
      return Promise.resolve({ ok: true, json: async () => ({ clips: [] }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectLibrary projectId="job-1" />);

    await waitFor(() =>
      expect(screen.getByLabelText("Clip status")).toHaveValue("reviewing"),
    );
    fireEvent.change(screen.getByLabelText("Clip status"), {
      target: { value: "edited" },
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Clip status")).toHaveValue("reviewing"),
    );
    expect(screen.getByText("save failed")).toBeInTheDocument();
  });
});
