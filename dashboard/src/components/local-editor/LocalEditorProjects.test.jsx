import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LocalEditorProjects from "./LocalEditorProjects";

const projects = [
  {
    id: "one",
    name: "One",
    videoName: "one.mp4",
    durationMs: 65000,
    updatedAt: Date.now(),
  },
  {
    id: "two",
    name: "Two",
    videoName: "two.mp4",
    durationMs: 12000,
    updatedAt: Date.now() - 1000,
  },
];

describe("LocalEditorProjects", () => {
  it("renders project actions and forwards callbacks", () => {
    const onClose = vi.fn();
    const onOpen = vi.fn();
    const onRename = vi.fn();
    const onDelete = vi.fn();
    const onNewProject = vi.fn();

    render(
      <LocalEditorProjects
        open
        projects={projects}
        activeProjectId="one"
        onClose={onClose}
        onOpen={onOpen}
        onRename={onRename}
        onDelete={onDelete}
        onNewProject={onNewProject}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: /saved projects/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open One" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename One" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete One" }));
    fireEvent.click(screen.getByRole("button", { name: /new project/i }));
    fireEvent.click(screen.getByRole("button", { name: /close projects/i }));

    expect(onOpen).toHaveBeenCalledWith("one");
    expect(onRename).toHaveBeenCalledWith(projects[0]);
    expect(onDelete).toHaveBeenCalledWith("one");
    expect(onNewProject).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing while closed", () => {
    const { container } = render(
      <LocalEditorProjects open={false} projects={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
