import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LocalEditorSubtitleStyleInspector from "./LocalEditorSubtitleStyleInspector";
import {
  DEFAULT_SUBTITLE_STYLE,
  SUBTITLE_STYLE_TEMPLATES,
} from "./localEditorStyles";

describe("LocalEditorSubtitleStyleInspector", () => {
  it("shows multiple subtitle quick picks", () => {
    render(
      <LocalEditorSubtitleStyleInspector
        style={DEFAULT_SUBTITLE_STYLE}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        hasCues
      />,
    );

    expect(screen.getByText("Quick picks")).toBeInTheDocument();
    SUBTITLE_STYLE_TEMPLATES.forEach((template) => {
      expect(
        screen.getByRole("button", { name: template.ariaLabel }),
      ).toBeInTheDocument();
    });
  });

  it.each(SUBTITLE_STYLE_TEMPLATES)(
    "applies the complete $label quick-pick style",
    (template) => {
      const onChange = vi.fn();
      render(
        <LocalEditorSubtitleStyleInspector
          style={DEFAULT_SUBTITLE_STYLE}
          onChange={onChange}
          onRemove={vi.fn()}
          hasCues
        />,
      );

      fireEvent.click(
        screen.getByRole("button", {
          name: template.ariaLabel,
        }),
      );

      expect(onChange).toHaveBeenCalledWith({
        ...DEFAULT_SUBTITLE_STYLE,
        ...template.style,
      });
    },
  );

  it("toggles one-word-at-a-time display", () => {
    const onChange = vi.fn();
    render(
      <LocalEditorSubtitleStyleInspector
        style={DEFAULT_SUBTITLE_STYLE}
        onChange={onChange}
        onRemove={vi.fn()}
        hasCues
      />,
    );

    const toggle = screen.getByRole("button", { name: "One word at a time" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_SUBTITLE_STYLE,
      displayMode: "single-word",
    });
  });

  it("turns one-word-at-a-time display off", () => {
    const onChange = vi.fn();
    render(
      <LocalEditorSubtitleStyleInspector
        style={{ ...DEFAULT_SUBTITLE_STYLE, displayMode: "single-word" }}
        onChange={onChange}
        onRemove={vi.fn()}
        hasCues
      />,
    );

    const toggle = screen.getByRole("button", { name: "One word at a time" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_SUBTITLE_STYLE,
      displayMode: "phrase",
    });
  });

  it("shows effective preset coordinates and switches to custom on edit", () => {
    const onChange = vi.fn();
    render(
      <LocalEditorSubtitleStyleInspector
        style={DEFAULT_SUBTITLE_STYLE}
        onChange={onChange}
        onRemove={vi.fn()}
        hasCues
      />,
    );

    expect(screen.getByLabelText("Subtitle X position")).toHaveValue(540);
    expect(screen.getByLabelText("Subtitle Y position")).toHaveValue(1728);
    fireEvent.change(screen.getByLabelText("Subtitle X position"), {
      target: { value: "700" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_SUBTITLE_STYLE,
      position: "custom",
      positionX: 700,
      positionY: 1728,
    });
  });

  it("clears custom coordinates when a preset is selected", () => {
    const onChange = vi.fn();
    render(
      <LocalEditorSubtitleStyleInspector
        style={{
          ...DEFAULT_SUBTITLE_STYLE,
          position: "custom",
          positionX: 700,
          positionY: 420,
        }}
        onChange={onChange}
        onRemove={vi.fn()}
        hasCues
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Bottom" }));
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_SUBTITLE_STYLE);
  });

  it("clears custom coordinates when a quick pick selects a preset", () => {
    const onChange = vi.fn();
    render(
      <LocalEditorSubtitleStyleInspector
        style={{
          ...DEFAULT_SUBTITLE_STYLE,
          position: "custom",
          positionX: 700,
          positionY: 420,
        }}
        onChange={onChange}
        onRemove={vi.fn()}
        hasCues
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: SUBTITLE_STYLE_TEMPLATES[0].ariaLabel,
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_SUBTITLE_STYLE,
      ...SUBTITLE_STYLE_TEMPLATES[0].style,
    });
  });
});
