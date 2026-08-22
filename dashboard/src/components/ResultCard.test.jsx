import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ResultCard from "./ResultCard";

vi.mock("./ResultCard/CardActions", () => ({
  default: ({ setShowClipEditor }) => (
    <button type="button" onClick={() => setShowClipEditor(true)}>
      Edit Timeline
    </button>
  ),
}));

vi.mock("./editor/FullScreenEditor", () => ({
  default: ({ isOpen, onClose }) =>
    isOpen ? (
      <div data-testid="full-screen-editor" data-local-editor="true">
        <button type="button" onClick={onClose}>
          Close editor
        </button>
      </div>
    ) : null,
}));

vi.mock("./ResultCard/VideoPreview", () => ({ default: () => null }));
vi.mock("./ResultCard/WebcamRegionSelector", () => ({ default: () => null }));
vi.mock("./ResultCard/GameplayRegionSelector", () => ({ default: () => null }));
vi.mock("./ResultCard/Standard916Preview", () => ({ default: () => null }));
vi.mock("./ResultCard/CardContent", () => ({ default: () => null }));
vi.mock("./ResultCard/PostModal", () => ({ default: () => null }));
vi.mock("./ResultCard/ClipSourceRangeEditor", () => ({ default: () => null }));
vi.mock("./ResultCard/SubtitleDetailsModal", () => ({ default: () => null }));
vi.mock("./HookModal", () => ({ default: () => null }));
vi.mock("./SubtitleModal", () => ({ default: () => null }));
vi.mock("./TranslateModal", () => ({ default: () => null }));
vi.mock("./ClipWorkflowStatus", () => ({ default: () => null }));
vi.mock("./ClipRenderControls", () => ({ default: () => null }));

describe("ResultCard editor lifecycle", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("clears card-local editor state before invoking the external close callback", () => {
    const onEditorClose = vi.fn();

    render(
      <ResultCard
        clip={{ video_url: "/videos/clip.mp4", title: "Clip" }}
        index={0}
        jobId="job-1"
        onEditorClose={onEditorClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit Timeline" }));
    expect(screen.getByTestId("full-screen-editor")).toBeInTheDocument();
    expect(screen.getByTestId("full-screen-editor")).toHaveAttribute(
      "data-local-editor",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));

    expect(onEditorClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("full-screen-editor")).not.toBeInTheDocument();
  });
});
