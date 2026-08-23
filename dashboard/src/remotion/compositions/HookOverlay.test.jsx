import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("remotion", () => ({
  AbsoluteFill: ({ children }) => <div>{children}</div>,
  Sequence: ({ children }) => <div>{children}</div>,
  interpolate: vi.fn(),
  spring: vi.fn(),
  staticFile: (file) => `/${file}`,
  useCurrentFrame: () => 0,
  useVideoConfig: () => ({ fps: 30, width: 360, height: 100 }),
}));

import { HookOverlay } from "./HookOverlay";

describe("HookOverlay visual contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the same editable hook appearance used by the local preview", () => {
    render(
      <HookOverlay
        config={{
          text: "Therapy Session Gone Wrong? 😱",
          position: "top",
          size: "M",
          entranceAnimation: "none",
          displayDurationSec: 2,
          startMs: 0,
          endMs: 2000,
          color: "#ffffff",
          background: "#111111",
          fontSize: 48,
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      />,
    );

    const text = screen.getByText("Therapy Session Gone Wrong? 😱");
    const box = text.parentElement;
    expect(box).toHaveStyle({
      color: "#ffffff",
      backgroundColor: "#111111",
      fontFamily: "Arial, Helvetica, sans-serif",
      fontSize: "18.46153846153846px",
    });
  });

  it("renders Streamer Stack hooks across the selected facecam boundary", () => {
    render(
      <HookOverlay
        config={{
          text: "Watch this",
          position: "top",
          size: "M",
          entranceAnimation: "none",
          displayDurationSec: 2,
          layoutFormat: "streamer_stack",
          facecamSize: "large",
        }}
      />,
    );

    const text = screen.getByText("Watch this");
    const box = text.parentElement;
    const container = box.parentElement;
    expect(box.style.color).toBe("rgb(255, 232, 64)");
    expect(box.style.backgroundColor).toBe("transparent");
    expect(box.style.getPropertyValue("-webkit-text-stroke")).toBe(
      "2px #000000",
    );
    expect(container).toHaveStyle({
      top: "46%",
      transform: "translate(-50%, -50%)",
    });
  });

  it("renders custom hooks at their pixel coordinates", () => {
    render(
      <HookOverlay
        config={{
          text: "Move me",
          position: "custom",
          positionX: 90,
          positionY: 20,
          size: "M",
          entranceAnimation: "none",
          displayDurationSec: 2,
          startMs: 0,
          endMs: 2000,
        }}
      />,
    );

    const container = screen.getByText("Move me").parentElement.parentElement;
    expect(container).toHaveStyle({
      left: "25%",
      top: "20%",
      transform: "translate(-50%, -50%)",
    });
  });
});
