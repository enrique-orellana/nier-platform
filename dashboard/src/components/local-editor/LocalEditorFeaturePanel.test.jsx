import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LocalEditorFeaturePanel from "./LocalEditorFeaturePanel";

describe("LocalEditorFeaturePanel", () => {
  it("renders a labelled, scrollable feature region around its content", () => {
    render(
      <LocalEditorFeaturePanel title="Subtitles">
        <div data-testid="subtitle-controls">Subtitle controls</div>
      </LocalEditorFeaturePanel>,
    );

    const panel = screen.getByRole("region", { name: "Subtitles" });
    expect(panel).toHaveAttribute("data-testid", "local-editor-feature-panel");
    expect(panel).toHaveClass("overflow-y-auto", "editor-scrollbar");
    expect(screen.getByTestId("subtitle-controls")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Subtitles" }),
    ).not.toBeInTheDocument();
  });
});
