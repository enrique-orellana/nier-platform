import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ResultCard from "./ResultCard";

const testDoubles = vi.hoisted(() => ({
  webcamSelectorProps: vi.fn(),
  fullScreenEditorProps: vi.fn(),
}));

vi.mock("./ResultCard/CardActions", () => ({
  default: ({ setShowClipEditor }) => (
    <button type="button" onClick={() => setShowClipEditor(true)}>
      Edit Timeline
    </button>
  ),
}));

vi.mock("./editor/FullScreenEditor", () => ({
  default: (props) => {
    testDoubles.fullScreenEditorProps(props);
    return props.isOpen ? (
      <div data-testid="full-screen-editor" data-local-editor="true">
        <button type="button" onClick={props.onClose}>
          Close editor
        </button>
        <button
          type="button"
          onClick={() =>
            props.onClipInfoChange?.({
              video_title_for_youtube_short: "Regenerated title",
              video_description_for_tiktok: "Regenerated TikTok caption",
              video_description_for_instagram: "Regenerated Instagram caption",
              viral_hook_text: "Regenerated hook",
            })
          }
        >
          Regenerate clip information
        </button>
      </div>
    ) : null;
  },
}));

vi.mock("./ResultCard/VideoPreview", () => ({ default: () => null }));
vi.mock("./ResultCard/WebcamRegionSelector", () => ({
  default: (props) => {
    testDoubles.webcamSelectorProps(props);
    return <div data-testid="webcam-region-selector" />;
  },
}));
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
vi.mock("./ClipRenderControls", () => ({
  default: ({ onSelectWebcamRegion }) => (
    <button type="button" onClick={onSelectWebcamRegion}>
      Select Webcam Area
    </button>
  ),
}));

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

    fireEvent.click(
      screen.getByRole("button", { name: "Clip Controls & Actions" }),
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "Edit Timeline" }).at(-1),
    );
    expect(screen.getByTestId("full-screen-editor")).toBeInTheDocument();
    expect(screen.getByTestId("full-screen-editor")).toHaveAttribute(
      "data-local-editor",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));

    expect(onEditorClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("full-screen-editor")).not.toBeInTheDocument();
  });

  it("passes the master duration into the timeline editor metadata panel", () => {
    render(
      <ResultCard
        clip={{ video_url: "/videos/clip.mp4", title: "Clip" }}
        index={0}
        jobId="job-1"
        masterDuration={3577}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Clip Controls & Actions" }),
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "Edit Timeline" }).at(-1),
    );

    expect(testDoubles.fullScreenEditorProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ masterDuration: 3577 }),
    );
  });

  it("leaves an unsaved webcam size for the selector default", () => {
    render(
      <ResultCard
        clip={{
          video_url: "/videos/clip.mp4",
          title: "Clip",
          layout_format: "streamer_stack",
        }}
        index={0}
        jobId="job-1"
        renderStatus="found"
        onRenderClip={vi.fn()}
        onSaveWebcamRegion={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Clip Controls & Actions" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Select Webcam Area" }));

    expect(testDoubles.webcamSelectorProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ initialFacecamSize: undefined }),
    );
  });

  it("keeps regenerated clip information available to the card", () => {
    render(
      <ResultCard
        clip={{ video_url: "/videos/clip.mp4", title: "Clip" }}
        index={0}
        jobId="job-1"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Clip Controls & Actions" }),
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "Edit Timeline" }).at(-1),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Regenerate clip information" }),
    );

    const latestProps = testDoubles.fullScreenEditorProps.mock.calls.at(-1)[0];
    expect(latestProps.clip).toMatchObject({
      video_title_for_youtube_short: "Regenerated title",
      video_description_for_tiktok: "Regenerated TikTok caption",
      video_description_for_instagram: "Regenerated Instagram caption",
      viral_hook_text: "Regenerated hook",
    });
  });
});
