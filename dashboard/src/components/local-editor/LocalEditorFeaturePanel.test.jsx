import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LocalEditorFeaturePanel from "./LocalEditorFeaturePanel";

describe("LocalEditorFeaturePanel", () => {
  it("renders a labelled feature region with an isolated scroll body", () => {
    render(
      <LocalEditorFeaturePanel title="Subtitles">
        <div data-testid="subtitle-controls">Subtitle controls</div>
      </LocalEditorFeaturePanel>,
    );

    const panel = screen.getByRole("region", { name: "Subtitles" });
    const scrollBody = screen.getByTestId("local-editor-feature-panel-scroll");
    expect(panel).toHaveAttribute("data-testid", "local-editor-feature-panel");
    expect(panel).toHaveClass("overflow-hidden");
    expect(scrollBody).toHaveClass(
      "overflow-x-hidden",
      "overflow-y-auto",
      "editor-scrollbar",
    );
    expect(scrollBody).toContainElement(
      screen.getByTestId("subtitle-controls"),
    );
    expect(
      screen.queryByRole("heading", { name: "Subtitles" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the resize overlay outside the scrolling content", () => {
    render(
      <LocalEditorFeaturePanel
        title="Subtitles"
        overlay={<div data-testid="resize-overlay" />}
      >
        <div>Subtitle controls</div>
      </LocalEditorFeaturePanel>,
    );

    const panel = screen.getByRole("region", { name: "Subtitles" });
    const scrollBody = screen.getByTestId("local-editor-feature-panel-scroll");
    const overlay = screen.getByTestId("resize-overlay");

    expect(panel).toContainElement(overlay);
    expect(scrollBody).not.toContainElement(overlay);
  });
});
