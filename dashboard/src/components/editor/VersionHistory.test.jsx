import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import VersionHistory from "./VersionHistory";

describe("VersionHistory", () => {
  it("shows a ready badge and notifies when the history control is opened", () => {
    const onOpen = vi.fn();

    render(
      <VersionHistory
        versions={[{ version_id: "ready-version", status: "done" }]}
        renderCompleteNotice
        onOpen={onOpen}
      />,
    );

    expect(screen.getByTestId("version-render-ready-badge")).toHaveTextContent(
      "Ready",
    );
    const toggle = screen.getByRole("button", { name: /version history/i });
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("deletes the selected version when its delete button is clicked", () => {
    const onDelete = vi.fn();
    const versionId = "11111111-1111-1111-1111-111111111111";

    render(
      <VersionHistory
        versions={[{ version_id: versionId, status: "done" }]}
        selectedVersionId={versionId}
        onSelect={vi.fn()}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /delete version 111111/i }),
    );

    expect(onDelete).toHaveBeenCalledWith(versionId);
  });
});
