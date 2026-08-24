import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LayoutSegmentInspector from "./LayoutSegmentInspector";

const segment = {
  id: "layout-1",
  startMs: 0,
  endMs: 5000,
  format: "standard",
  transition: "cut",
  transitionDurationMs: 250,
};

describe("LayoutSegmentInspector", () => {
  it("edits the selected layout and exposes the split action", () => {
    const onChange = vi.fn();
    const onSplit = vi.fn();
    render(
      <LayoutSegmentInspector
        segment={segment}
        onChange={onChange}
        onSplit={onSplit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Streamer" }));
    fireEvent.click(screen.getByRole("button", { name: "Crossfade" }));
    fireEvent.click(screen.getByRole("button", { name: "Split at playhead" }));

    expect(onChange).toHaveBeenNthCalledWith(1, { format: "streamer_stack" });
    expect(onChange).toHaveBeenNthCalledWith(2, { transition: "crossfade" });
    expect(onSplit).toHaveBeenCalledTimes(1);
  });

  it("shows the duration control only for crossfades", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <LayoutSegmentInspector segment={segment} onChange={onChange} />,
    );
    expect(
      screen.queryByRole("spinbutton", { name: "Crossfade duration (ms)" }),
    ).not.toBeInTheDocument();

    rerender(
      <LayoutSegmentInspector
        segment={{ ...segment, transition: "crossfade" }}
        onChange={onChange}
      />,
    );
    const duration = screen.getByRole("spinbutton", {
      name: "Crossfade duration (ms)",
    });
    fireEvent.change(duration, { target: { value: "400" } });
    expect(onChange).toHaveBeenCalledWith({ transitionDurationMs: 400 });
  });
});
