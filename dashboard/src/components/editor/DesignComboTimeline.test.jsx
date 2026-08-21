import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DesignComboTimeline from "./DesignComboTimeline";

const state = {
  durationSec: 10,
  fps: 30,
  tracks: [
    {
      id: "video-1",
      name: "V1",
      type: "video",
      muted: false,
      locked: false,
      visible: true,
      items: [
        { id: "source", type: "video", label: "Source", start: 0, end: 10 },
      ],
    },
    {
      id: "hook",
      name: "Hook",
      type: "hook",
      muted: false,
      locked: false,
      visible: true,
      items: [{ id: "hook-1", type: "hook", label: "Hook", start: 1, end: 3 }],
    },
  ],
};

const subtitleState = {
  durationSec: 10,
  fps: 30,
  tracks: [
    {
      id: "subtitles-original",
      name: "Original",
      type: "subtitle",
      muted: false,
      locked: false,
      visible: true,
      items: [
        {
          id: "cue-1",
          type: "subtitle",
          label: "Hola",
          text: "Hola",
          start: 1,
          end: 2,
        },
      ],
    },
  ],
};

describe("DesignComboTimeline", () => {
  it("extends the timeline canvas by duration and zoom for horizontal cue editing", () => {
    render(
      <DesignComboTimeline state={state} onStateChange={vi.fn()} zoom={1} />,
    );
    expect(screen.getByTestId("timeline-canvas")).toHaveStyle({
      width: "960px",
    });
    expect(screen.getByTestId("timeline-ruler")).toHaveStyle({
      width: "800px",
    });
    expect(screen.getByTestId("timeline-scroll")).toHaveClass(
      "timeline-scroll",
    );
    expect(screen.getByText("00:00:00:00")).toBeInTheDocument();
    expect(screen.getByText("00:00:10:00")).toBeInTheDocument();
  });

  it("renders tracks and selects an item", () => {
    const onSelectItem = vi.fn();
    render(
      <DesignComboTimeline
        state={state}
        onStateChange={vi.fn()}
        onSelectItem={onSelectItem}
      />,
    );
    expect(screen.getByText("V1")).toBeInTheDocument();
    expect(screen.getAllByText("Hook").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Hook clip" }));
    expect(onSelectItem.mock.calls[0][0]).toEqual(
      expect.objectContaining({ id: "hook-1" }),
    );
  });

  it("selects a subtitle cue after a normal pointer interaction", () => {
    const onSelectItem = vi.fn();
    render(
      <DesignComboTimeline
        state={subtitleState}
        onStateChange={vi.fn()}
        onSelectItem={onSelectItem}
      />,
    );
    const cue = screen.getByRole("button", { name: "Hola clip" });
    fireEvent.pointerDown(cue, { clientX: 100 });
    fireEvent.click(cue);
    expect(onSelectItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cue-1", type: "subtitle" }),
      expect.objectContaining({ type: "subtitle" }),
    );
  });

  it("keeps the playhead visible while the player advances", () => {
    const { rerender } = render(
      <DesignComboTimeline
        state={state}
        onStateChange={vi.fn()}
        playheadFrame={0}
        zoom={2}
      />,
    );
    const scroll = screen.getByTestId("timeline-scroll");
    Object.defineProperty(scroll, "clientWidth", {
      configurable: true,
      value: 400,
    });
    rerender(
      <DesignComboTimeline
        state={state}
        onStateChange={vi.fn()}
        playheadFrame={270}
        zoom={2}
      />,
    );
    expect(scroll.scrollLeft).toBeGreaterThan(0);
  });

  it("moves an item through pointer interaction and snaps to frames", () => {
    const onStateChange = vi.fn();
    render(
      <DesignComboTimeline
        state={state}
        onStateChange={onStateChange}
        onSelectItem={vi.fn()}
      />,
    );
    const item = screen.getByRole("button", { name: "Hook clip" });
    const down = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(down, "clientX", { value: 100 });
    fireEvent(item, down);
    const move = new Event("pointermove");
    Object.defineProperty(move, "clientX", { value: 130 });
    fireEvent(window, move);
    fireEvent(window, new Event("pointerup"));
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ tracks: expect.any(Array) }),
    );
    expect(
      onStateChange.mock.calls.at(-1)[0].tracks[1].items[0].start,
    ).toBeGreaterThan(1);
  });

  it("edits a subtitle label inline and commits on Enter", () => {
    const onStateChange = vi.fn();
    render(
      <DesignComboTimeline
        state={subtitleState}
        onStateChange={onStateChange}
      />,
    );
    fireEvent.doubleClick(screen.getByRole("button", { name: "Hola clip" }));
    const input = screen.getByRole("textbox", { name: "Edit subtitle Hola" });
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tracks: expect.arrayContaining([
          expect.objectContaining({
            items: expect.arrayContaining([
              expect.objectContaining({ text: "Hello", label: "Hello" }),
            ]),
          }),
        ]),
      }),
    );
  });

  it("cancels inline subtitle edits with Escape", () => {
    const onStateChange = vi.fn();
    render(
      <DesignComboTimeline
        state={subtitleState}
        onStateChange={onStateChange}
      />,
    );
    fireEvent.doubleClick(screen.getByRole("button", { name: "Hola clip" }));
    const input = screen.getByRole("textbox", { name: "Edit subtitle Hola" });
    fireEvent.change(input, { target: { value: "Discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(
      screen.queryByRole("textbox", { name: "Edit subtitle Hola" }),
    ).not.toBeInTheDocument();
    expect(onStateChange).not.toHaveBeenCalled();
  });
});
