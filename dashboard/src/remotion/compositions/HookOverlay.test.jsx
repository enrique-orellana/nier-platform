import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("remotion", () => ({
  AbsoluteFill: ({ children, ...props }) => (
    <div data-testid="hook-overlay-root" {...props}>
      {children}
    </div>
  ),
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

  it("keeps the full-screen hook layer from intercepting editor input", () => {
    render(
      <HookOverlay
        config={{
          text: "Watch this",
          position: "top",
          size: "M",
          entranceAnimation: "none",
          displayDurationSec: 2,
        }}
      />,
    );

    expect(screen.getByTestId("hook-overlay-root")).toHaveStyle({
      pointerEvents: "none",
    });
  });

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

  it("preserves explicit line breaks in the hook preview", () => {
    render(
      <HookOverlay
        config={{
          text: "First line\nSecond line",
          position: "top",
          size: "M",
          entranceAnimation: "none",
          displayDurationSec: 2,
        }}
      />,
    );

    const text = screen.getByText(
      (_, element) =>
        element?.tagName === "SPAN" &&
        element.textContent === "First line\nSecond line",
    );
    expect(text.parentElement).toHaveStyle({ whiteSpace: "pre-wrap" });
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

  it("renders each non-empty headline line as its own card", () => {
    render(
      <HookOverlay
        config={{
          text: "First line\n\nSecond line",
          position: "top",
          size: "M",
          entranceAnimation: "none",
          displayDurationSec: 2,
          boxStyle: "headline_cards",
          color: "#123456",
          background: "#fedcba",
          fontFamily: "Impact",
          fontSize: 52,
        }}
      />,
    );

    const first = screen.getByText("First line");
    const second = screen.getByText("Second line");
    expect(first.parentElement).toHaveStyle({
      color: "#123456",
      backgroundColor: "#fedcba",
      fontFamily: "Impact",
    });
    expect(parseFloat(first.parentElement.style.borderRadius)).toBe(4);
    expect(first.parentElement).toHaveStyle({
      borderRadius: "4px 4px 0px 0px",
      marginTop: "0px",
    });
    expect(second.parentElement).toHaveStyle({
      borderRadius: "0px 0px 4px 4px",
      marginTop: "-4px",
    });
    expect(first.parentElement.parentElement).toHaveStyle({
      display: "flex",
      flexDirection: "column",
      gap: "0px",
    });
  });
});
