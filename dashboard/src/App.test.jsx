import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

describe("App settings layout", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/settings");
    localStorage.clear();
    localStorage.setItem("ai_provider_v1", "openai-codex");
    vi.stubGlobal(
      "fetch",
      vi.fn((url) => {
        if (String(url).includes("/api/ai/openai-codex/status")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ connected: true, pending: false }),
          });
        }
        if (String(url).includes("/api/ai/openai-codex/models")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              models: [
                { id: "gpt-5.4", label: "GPT-5.4", supportsVision: true },
              ],
              defaultModel: "gpt-5.4",
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }),
    );
  });

  afterEach(() => {
    window.history.pushState({}, "", "/");
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("does not nest block grids inside paragraph elements", () => {
    const { container } = render(<App />);

    expect(container.querySelectorAll("p > div")).toHaveLength(0);
  });

  it("uses a distinct sidebar icon for Highlights and AI Shorts", () => {
    render(<App />);

    expect(
      screen.getByText("Highlights").closest("button").querySelector("svg"),
    ).toHaveClass("lucide-highlighter");
    expect(
      screen.getByText("AI Shorts").closest("button").querySelector("svg"),
    ).toHaveClass("lucide-sparkles");
  });

  it("places Performance immediately before Settings", () => {
    render(<App />);

    const performanceButton = screen.getByText("Performance").closest("button");
    const settingsButton = screen.getByRole("button", { name: "Settings" });
    expect(performanceButton.querySelector("svg")).toHaveClass(
      "lucide-activity",
    );
    expect(
      performanceButton.compareDocumentPosition(settingsButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders the Performance view from its direct route", async () => {
    window.history.pushState({}, "", "/performance");

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Performance" }),
    ).toBeInTheDocument();
  });

  it("makes the idle clip generator content vertically scrollable", () => {
    window.history.pushState({}, "", "/");
    const { container } = render(<App />);

    expect(
      container.querySelector('[data-testid="dashboard-scroll-container"]'),
    ).toBeInTheDocument();
  });

  it("covers the projects view while a direct editor route is loading", () => {
    window.history.pushState(
      {},
      "",
      "/projects/project-1/clips/13/editor?version=version-1#app",
    );

    render(<App />);

    expect(screen.getByTestId("editor-route-loading")).toBeInTheDocument();
  });

  it("loads the account-available Codex models after the connection is ready", async () => {
    render(<App />);

    expect(
      await screen.findAllByRole("option", { name: "GPT-5.4" }),
    ).toHaveLength(3);
  });

  it("preserves a persisted Codex model when the account catalog still provides it", async () => {
    localStorage.setItem("ai_text_model_v1", "gpt-5.4");
    render(<App />);

    await screen.findAllByRole("option", { name: "GPT-5.4" });
    expect(screen.getByRole("combobox", { name: "Text Model" })).toHaveValue(
      "gpt-5.4",
    );
  });

  it("does not poll a restored clips-ready session", async () => {
    vi.useFakeTimers();
    const jobId = "stale-job";
    localStorage.setItem(
      "openshorts_session",
      JSON.stringify({
        jobId,
        status: "clips-ready",
        results: null,
        clipRenderJobs: {},
        timestamp: Date.now(),
      }),
    );

    render(<App />);

    await act(async () => {
      vi.advanceTimersByTime(2500);
      await Promise.resolve();
    });

    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) =>
          String(url).includes(`/api/status/${jobId}`),
        ),
    ).toBe(false);

    vi.useRealTimers();
  });
});
