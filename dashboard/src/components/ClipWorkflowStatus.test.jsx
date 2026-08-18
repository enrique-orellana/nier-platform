import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ClipWorkflowStatus from "./ClipWorkflowStatus";

describe("ClipWorkflowStatus", () => {
  it("renders the fixed workflow statuses and reports a selection", () => {
    const onChange = vi.fn();
    render(<ClipWorkflowStatus status="reviewing" onChange={onChange} />);

    expect(screen.getByLabelText("Clip status")).toHaveValue("reviewing");
    expect(
      screen.getByRole("option", { name: "Not reviewed" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Reviewing" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Editing" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Edited" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Discarded" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Published" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Clip status"), {
      target: { value: "edited" },
    });
    expect(onChange).toHaveBeenCalledWith("edited");
  });
});
