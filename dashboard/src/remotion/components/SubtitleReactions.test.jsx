import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("remotion", () => ({
  interpolate: (value, inputRange, outputRange) => {
    const progress =
      (value - inputRange[0]) /
      (inputRange[inputRange.length - 1] - inputRange[0]);
    return (
      outputRange[0] +
      progress * (outputRange[outputRange.length - 1] - outputRange[0])
    );
  },
  spring: () => 1,
}));

import { SubtitleReactions } from "./SubtitleReactions";

const reaction = {
  id: "r0",
  cueIndex: 0,
  startMs: 0,
  endMs: 1000,
  emojis: ["😱"],
  enabled: true,
};

describe("SubtitleReactions", () => {
  it("renders an enabled reaction during its cue window", () => {
    render(
      <SubtitleReactions
        reactions={[reaction]}
        style={{ position: "above", animation: "pop", scale: 1 }}
        currentTimeMs={500}
        fps={30}
      />,
    );

    expect(screen.getByText("😱")).toBeInTheDocument();
  });

  it("renders nothing outside the cue window or for disabled reactions", () => {
    const { rerender } = render(
      <SubtitleReactions
        reactions={[reaction]}
        style={{ position: "above", animation: "pop", scale: 1 }}
        currentTimeMs={1000}
        fps={30}
      />,
    );
    expect(screen.queryByText("😱")).not.toBeInTheDocument();

    rerender(
      <SubtitleReactions
        reactions={[{ ...reaction, enabled: false }]}
        style={{ position: "above", animation: "pop", scale: 1 }}
        currentTimeMs={500}
        fps={30}
      />,
    );
    expect(screen.queryByText("😱")).not.toBeInTheDocument();
  });

  it("renders nothing when the optional layer is omitted", () => {
    render(
      <SubtitleReactions
        style={{ position: "above", animation: "pop", scale: 1 }}
        currentTimeMs={500}
        fps={30}
      />,
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
