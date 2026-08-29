import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import GameplayCropEditor from "./GameplayCropEditor";

function prepareStage() {
  const stage = screen.getByTestId("gameplay-crop-editor-stage");
  Object.defineProperty(stage, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 240,
      right: 400,
      bottom: 240,
    }),
  });
  return stage;
}

function pointerEvent(type, clientX, clientY) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "clientY", { value: clientY });
  return event;
}

describe("GameplayCropEditor", () => {
  it("commits a dragged gameplay focus once on pointer-up", () => {
    const onChange = vi.fn();
    render(
      <GameplayCropEditor
        region={{ x: 0, y: 0, width: 1, height: 1 }}
        sourceAspect={16 / 9}
        panelAspect={9 / 16}
        focus={{ x: 0.5, y: 0.5 }}
        zoom={1}
        onChange={onChange}
        onReset={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    const stage = prepareStage();
    const frame = screen.getByTestId("gameplay-crop-editor-frame");
    fireEvent(frame, pointerEvent("pointerdown", 200, 120));
    fireEvent(window, pointerEvent("pointermove", 240, 120));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent(window, pointerEvent("pointerup", 240, 120));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      focus: {
        x: expect.closeTo(0.6, 3),
        y: expect.closeTo(0.5, 3),
      },
      zoom: 1,
    });
    expect(stage).toBeInTheDocument();
  });

  it("exposes reset and done actions", () => {
    const onReset = vi.fn();
    const onDone = vi.fn();
    render(
      <GameplayCropEditor
        region={{ x: 0, y: 0, width: 1, height: 1 }}
        sourceAspect={16 / 9}
        panelAspect={9 / 16}
        onChange={vi.fn()}
        onReset={onReset}
        onDone={onDone}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Reset gameplay framing" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Done editing gameplay framing" }),
    );

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("renders readable controls at the scaled preview size", () => {
    render(
      <GameplayCropEditor
        region={{ x: 0, y: 0, width: 1, height: 1 }}
        sourceAspect={16 / 9}
        panelAspect={9 / 16}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Reset gameplay framing" }),
    ).toHaveClass("min-h-[96px]", "min-w-[132px]", "text-[36px]");
    expect(
      screen.getByRole("button", { name: "Resize gameplay crop northwest" }),
    ).toHaveClass("h-10", "w-10");
  });
});
