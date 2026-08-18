import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SubtitleCueTable from "./SubtitleCueTable";

describe("SubtitleCueTable", () => {
  it("clearly marks the cue at the current playhead", () => {
    render(
      <SubtitleCueTable
        cues={[
          { id: "cue-1", text: "Previous", startMs: 0, endMs: 1000 },
          { id: "cue-2", text: "Current caption", startMs: 1000, endMs: 2000 },
        ]}
        playheadMs={1500}
        onSelect={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("CURRENT")).toBeInTheDocument();
    const currentRow = screen.getByRole("row", { name: /Current caption/ });
    expect(currentRow).toHaveAttribute("aria-current", "time");
    expect(currentRow).toHaveAttribute("data-current-cue", "true");
  });
});
