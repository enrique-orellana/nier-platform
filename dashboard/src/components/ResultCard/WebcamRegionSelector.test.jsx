import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import WebcamRegionSelector from "./WebcamRegionSelector";

function prepareStage({
  width = 400,
  height = 225,
  videoWidth = 1600,
  videoHeight = 900,
} = {}) {
  const stage = screen.getByTestId("webcam-region-stage");
  const video = screen.getByTestId("webcam-region-video");
  Object.defineProperty(stage, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      width,
      height,
      right: width,
      bottom: height,
    }),
  });
  Object.defineProperty(video, "videoWidth", {
    configurable: true,
    value: videoWidth,
  });
  Object.defineProperty(video, "videoHeight", {
    configurable: true,
    value: videoHeight,
  });
  fireEvent.loadedMetadata(video);
  return stage;
}

function pointerEvent(type, clientX, clientY) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "clientY", { value: clientY });
  return event;
}

describe("WebcamRegionSelector", () => {
  it("defaults the webcam panel size to medium for legacy clips", () => {
    render(
      <WebcamRegionSelector
        videoUrl="/videos/source.mp4"
        initialRegion={{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Webcam panel size")).toHaveValue("medium");
  });

  it("restores the current facecam size and returns the selected size on save", () => {
    const onSave = vi.fn();
    render(
      <WebcamRegionSelector
        videoUrl="/videos/source.mp4"
        initialRegion={{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }}
        initialFacecamSize="large"
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );

    prepareStage();
    const size = screen.getByLabelText("Webcam panel size");
    expect(size).toHaveValue("large");
    fireEvent.change(size, { target: { value: "small" } });
    fireEvent.click(screen.getByRole("button", { name: "Save webcam area" }));

    expect(onSave).toHaveBeenCalledWith(
      { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      "small",
    );
  });

  it("keeps Save disabled until a region is drawn", () => {
    render(
      <WebcamRegionSelector
        videoUrl="/videos/source.mp4"
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Save webcam area" }),
    ).toBeDisabled();
  });

  it("restores a saved region and saves normalized coordinates from the contained source frame", () => {
    const onSave = vi.fn();
    render(
      <WebcamRegionSelector
        videoUrl="/videos/source.mp4"
        initialRegion={{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );

    const stage = prepareStage({
      width: 400,
      height: 400,
      videoWidth: 1600,
      videoHeight: 900,
    });
    expect(screen.getByTestId("webcam-region-box").style.left).toBe("10%");
    expect(screen.getByTestId("webcam-region-box").style.top).toBe("20%");

    fireEvent(stage, pointerEvent("pointerdown", 50, 100));
    fireEvent(window, pointerEvent("pointermove", 250, 250));
    fireEvent(window, pointerEvent("pointerup", 250, 250));
    fireEvent.click(screen.getByRole("button", { name: "Save webcam area" }));

    expect(onSave).toHaveBeenCalledWith(
      {
        x: expect.closeTo(0.125, 3),
        y: expect.closeTo((100 - 87.5) / 225, 3),
        width: expect.closeTo(0.5, 3),
        height: expect.closeTo((250 - 100) / 225, 3),
      },
      "medium",
    );
  });

  it("clamps a drawn region to the source content area and can close without saving", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <WebcamRegionSelector
        videoUrl="/videos/source.mp4"
        onSave={onSave}
        onClose={onClose}
      />,
    );

    const stage = prepareStage({
      width: 400,
      height: 400,
      videoWidth: 1600,
      videoHeight: 900,
    });
    fireEvent(stage, pointerEvent("pointerdown", -20, 20));
    fireEvent(window, pointerEvent("pointermove", 500, 500));
    fireEvent(window, pointerEvent("pointerup", 500, 500));

    expect(screen.getByTestId("webcam-region-box").style.left).toBe("0%");
    expect(screen.getByTestId("webcam-region-box").style.top).toBe("0%");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
