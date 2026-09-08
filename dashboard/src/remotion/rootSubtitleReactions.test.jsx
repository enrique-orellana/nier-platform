import React from "react";
import { render } from "@testing-library/react";
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

import { SubtitleReactions } from "../../../remotion/src/components/SubtitleReactions";

const reaction = {
  id: "r0",
  cueIndex: 0,
  startMs: 0,
  endMs: 1000,
  emojis: ["ðŸ˜±"],
  enabled: true,
};

describe("bundled renderer subtitle reactions", () => {
  it("uses the subtitle font size and configured gap", () => {
    render(
      <SubtitleReactions
        reactions={[reaction]}
        style={{ position: "above", animation: "pop", scale: 2, spacing: 24 }}
        subtitleFontSize={42}
        currentTimeMs={500}
        fps={30}
      />,
    );

    const emoji = document.querySelector("span");
    expect(emoji).toHaveStyle({ fontSize: "84px" });
    expect(emoji.parentElement).toHaveStyle({
      bottom: "calc(100% + 24px)",
    });
  });
});
