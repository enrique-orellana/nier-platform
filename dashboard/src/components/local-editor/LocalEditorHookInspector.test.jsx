import { render, screen } from "@testing-library/react";
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
});
