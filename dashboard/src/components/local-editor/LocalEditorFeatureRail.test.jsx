import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LocalEditorFeatureRail from "./LocalEditorFeatureRail";
import { LOCAL_EDITOR_FEATURES } from "./localEditorFeatures";

describe("LocalEditorFeatureRail", () => {
  it("renders the four local-editor feature buttons and marks Details active", () => {
    render(
      <LocalEditorFeatureRail activeFeature="details" onSelect={vi.fn()} />,
    );

    expect(LOCAL_EDITOR_FEATURES.map(({ label }) => label)).toEqual([
      "Details",
      "Subtitles",
      "Viral Hook",
      "Project",
    ]);
    expect(
      screen.getByRole("navigation", { name: "Editor features" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Details" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("button", { name: "Subtitles" }),
    ).not.toHaveAttribute("aria-current", "page");
  });

  it("reports the selected feature when a rail button is clicked", () => {
    const onSelect = vi.fn();
    render(
      <LocalEditorFeatureRail activeFeature="details" onSelect={onSelect} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Subtitles" }));

    expect(onSelect).toHaveBeenCalledWith("subtitles");
  });
});
