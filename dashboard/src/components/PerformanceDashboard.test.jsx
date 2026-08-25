import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PerformanceDashboard from "./PerformanceDashboard";

const summaryResponse = {
  range: "30d",
  summary: {
    render_count: 142,
    successful_count: 140,
    failed_count: 2,
    success_rate: 98.6,
    average_duration_ms: 42800,
    p95_duration_ms: 71400,
    total_output_bytes: 42800000,
    acceleration_counts: { cpu: 6, gpu: 136 },
  },
  trend: [
    {
      date: "2026-08-25",
      render_count: 8,
      failed_count: 0,
      average_duration_ms: 42800,
      p95_duration_ms: 71400,
    },
  ],
  stages: [{ name: "compositing", duration_ms: 120000, share: 56 }],
  recent: [
    {
      render_id: "render-8",
      job_id: "job-8",
      version_id: "version-14",
      clip_index: 7,
      status: "done",
      total_duration_ms: 38400,
      acceleration_mode: "gpu",
      output_bytes: 42800000,
      finished_at: "2026-08-25T10:00:00Z",
    },
  ],
};

describe("PerformanceDashboard", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => summaryResponse,
        }),
      ),
    );
  });

  it("renders the analytical render metrics", async () => {
    render(<PerformanceDashboard />);

    expect(
      await screen.findByRole("heading", { name: "Performance" }),
    ).toBeInTheDocument();
    expect(screen.getByText("142")).toBeInTheDocument();
    expect(screen.getByText("98.6%")).toBeInTheDocument();
    expect(screen.getByText("42.8s")).toBeInTheDocument();
    expect(screen.getByText(/1m 11\.4s/)).toBeInTheDocument();
    expect(screen.getByText(/clip_08/)).toBeInTheDocument();
    expect(screen.getByText("Compositing")).toBeInTheDocument();
  });

  it("reloads the selected range and supports manual refresh", async () => {
    const fetchMock = vi.mocked(fetch);
    render(<PerformanceDashboard />);
    await screen.findByText("142");

    fireEvent.change(screen.getByLabelText("Performance range"), {
      target: { value: "7d" },
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/render-metrics?range=7d",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    const callCount = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.length).toBe(callCount + 1),
    );
  });

  it("shows loading, empty, and error states", async () => {
    let resolveRequest;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveRequest = resolve;
          }),
      ),
    );
    render(<PerformanceDashboard />);
    expect(
      screen.getByText("Loading performance metrics…"),
    ).toBeInTheDocument();
    resolveRequest({
      ok: true,
      json: async () => ({ summary: { render_count: 0 } }),
    });
    expect(
      await screen.findByText("No render metrics yet"),
    ).toBeInTheDocument();

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network unavailable"))),
    );
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(await screen.findByText("network unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
