import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MediaPool from "./MediaPool";
import InspectorPanel from "./InspectorPanel";

describe("editor media pool and inspectors", () => {
  it("lists source, immutable versions, and subtitle tracks", () => {
    const onSelectVersion = vi.fn();
    const onSelectTrack = vi.fn();
    render(
      <MediaPool
        sourceUrl="https://example.test/source.mp4"
        versions={[{ version_id: "v2", status: "completed" }]}
        tracks={[{ id: "original", label: "Original", language: "es" }]}
        onSelectVersion={onSelectVersion}
        onSelectTrack={onSelectTrack}
      />,
    );
    expect(screen.getByText("Source media")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /v2/i }));
    fireEvent.click(screen.getByRole("button", { name: /original/i }));
    expect(onSelectVersion).toHaveBeenCalledWith(
      expect.objectContaining({ version_id: "v2" }),
    );
    expect(onSelectTrack).toHaveBeenCalledWith("original");
  });

  it("renders audio controls and emits numeric edits", () => {
    const onChange = vi.fn();
    render(
      <InspectorPanel
        selectedItem={{
          id: "audio",
          type: "audio",
          label: "Source audio",
          start: 0,
          end: 10,
          volume: 1,
        }}
        editorState={{ tracks: [] }}
        onItemChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(/volume/i), {
      target: { value: "0.5" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ volume: 0.5 }),
    );
  });
});
