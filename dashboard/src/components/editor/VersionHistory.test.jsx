import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import VersionHistory from "./VersionHistory";

describe("VersionHistory", () => {
  it("uses the compact editor section shell for collapsible history", () => {
    render(
      <VersionHistory
        versions={[{ version_id: "compact-version", status: "done" }]}
        renderCompleteNotice
        onOpen={vi.fn()}
      />,
    );

    const section = screen.getByRole("region", { name: "Version history" });

    expect(section).toHaveClass(
      "overflow-hidden",
      "rounded-xl",
      "border",
      "bg-white/[.02]",
    );
  });

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

  it("renders child versions beneath their parent", () => {
    render(
      <VersionHistory
        versions={[
          { version_id: "root-version", status: "done" },
          {
            version_id: "child-version",
            parent_version_id: "root-version",
            status: "pending",
          },
        ]}
      />,
    );

    const root = screen.getByText("vroot-v").closest("[data-version-node]");
    const child = screen.getByText("vchild-").closest("[data-version-node]");

    expect(root).toBeInTheDocument();
    expect(child).toBeInTheDocument();
    expect(child.parentElement).toHaveAttribute("role", "group");
  });

  it("opens a completed version's generated clip in a new tab", () => {
    render(
      <VersionHistory
        versions={[
          {
            version_id: "ready-version",
            status: "done",
            output_url: "/videos/job/ready.mp4",
          },
        ]}
      />,
    );

    const link = screen.getByRole("link", {
      name: /open generated clip for version ready-version/i,
    });

    expect(link).toHaveAttribute("href", "/videos/job/ready.mp4");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("uses the stable version preview URL when one is provided", () => {
    render(
      <VersionHistory
        versions={[
          {
            version_id: "expired-version",
            status: "done",
            output_url: "https://minio.example/expired.mp4?X-Amz-Expires=7200",
          },
        ]}
        getVersionPreviewUrl={(versionId) =>
          `/api/clip/job-1/0/versions/${versionId}/preview`
        }
      />,
    );

    expect(
      screen.getByRole("link", {
        name: /open generated clip for version expired-version/i,
      }),
    ).toHaveAttribute(
      "href",
      "/api/clip/job-1/0/versions/expired-version/preview",
    );
  });

  it("does not show a generated clip link for incomplete versions", () => {
    render(
      <VersionHistory
        versions={[{ version_id: "pending-version", status: "pending" }]}
      />,
    );

    expect(
      screen.queryByRole("link", { name: /open generated clip/i }),
    ).toBeNull();
  });
});
