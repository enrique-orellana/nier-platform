import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LocalEditorHookInspector from "./LocalEditorHookInspector";

const hook = {
  id: "hook",
  text: "Stop scrolling",
  startMs: 0,
  endMs: 3000,
  position: "top",
  size: "M",
  entranceAnimation: "spring",
  color: "#FFFFFF",
  fontSize: 48,
  background: "#111111",
};

describe("LocalEditorHookInspector", () => {
  it("groups hook controls into content, layout, timing, and appearance sections", () => {
    render(
      <LocalEditorHookInspector
        hook={hook}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Viral Hook" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Content" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Layout" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Timing" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Appearance" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Hook text")).toBeInTheDocument();
    expect(screen.getByLabelText("Hook duration")).toBeInTheDocument();
    expect(screen.getByLabelText("Hook start")).toBeInTheDocument();
    expect(screen.getByLabelText("Hook end")).toBeInTheDocument();
    expect(screen.getByLabelText("Hook font size")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Hook" }),
    ).toBeInTheDocument();
  });

  it("places size after text color and before background", () => {
    render(
      <LocalEditorHookInspector
        hook={hook}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    const textColorPresets = screen.getByLabelText("Hook text color presets");
    const sizeInput = screen.getByLabelText("Hook font size");
    const backgroundPresets = screen.getByLabelText(
      "Hook background color presets",
    );

    expect(textColorPresets.compareDocumentPosition(sizeInput)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(sizeInput.compareDocumentPosition(backgroundPresets)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("shows resolved preset pixels and switches to custom when edited", () => {
    const onChange = vi.fn();
    render(
      <LocalEditorHookInspector
        hook={hook}
        onChange={onChange}
        onRemove={vi.fn()}
        renderWidth={1080}
        renderHeight={1920}
      />,
    );

    expect(screen.getByLabelText("Hook X position")).toHaveValue(540);
    expect(screen.getByLabelText("Hook Y position")).toHaveValue(154);
    expect(screen.getByText("Preset position")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Hook X position"), {
      target: { value: "700" },
    });

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        position: "custom",
        positionX: 700,
        positionY: 154,
      }),
    );
  });

  it("clears custom coordinates when a preset is selected", () => {
    const onChange = vi.fn();
    render(
      <LocalEditorHookInspector
        hook={{ ...hook, position: "custom", positionX: 700, positionY: 420 }}
        onChange={onChange}
        onRemove={vi.fn()}
        renderWidth={1080}
        renderHeight={1920}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Bottom" }));

    const nextHook = onChange.mock.lastCall[0];
    expect(nextHook).toMatchObject({ position: "bottom" });
    expect(nextHook).not.toHaveProperty("positionX");
    expect(nextHook).not.toHaveProperty("positionY");
  });
});
