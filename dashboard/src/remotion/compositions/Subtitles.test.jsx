import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("remotion", () => ({
  AbsoluteFill: ({ children, ...props }) => (
    <div data-testid="subtitle-overlay-root" {...props}>
      {children}
    </div>
  ),
  Sequence: ({ children }) => <>{children}</>,
  staticFile: (file) => `/${file}`,
  useCurrentFrame: () => 0,
  useVideoConfig: () => ({ fps: 30 }),
}));

import {
  Subtitles,
  getSubtitleFrameRange,
  getSubtitleTimeMs,
  getSubtitleWordsForDisplay,
  isSubtitleBlockActiveAt,
  normalizeSubtitleConfig,
} from "./Subtitles";

describe("subtitle rendering defaults", () => {
  it("keeps the full-screen subtitle layer from intercepting editor input", () => {
    render(<Subtitles config={{ captions: [] }} />);

    expect(screen.getByTestId("subtitle-overlay-root")).toHaveStyle({
      pointerEvents: "none",
    });
  });

  it("fills missing style data before rendering legacy subtitle configs", () => {
    const normalized = normalizeSubtitleConfig({
      captions: [{ text: "Ciao", startMs: 0, endMs: 500 }],
    });
    expect(normalized.position).toBe("bottom");
    expect(normalized.style).toMatchObject({
      fontFamily: "Arial",
      fontSize: 52,
      animation: "none",
      displayMode: "phrase",
    });
    expect(normalized.style.fontColor).toBe("#FFFFFF");
  });

  it("selects either the full phrase or the active word for display", () => {
    const words = [
      { text: "Hola", startMs: 0, endMs: 400 },
      { text: "mundo", startMs: 400, endMs: 800 },
    ];

    expect(getSubtitleWordsForDisplay(words, 1, "phrase")).toEqual(words);
    expect(getSubtitleWordsForDisplay(words, 1, "single-word")).toEqual([
      words[1],
    ]);
    expect(getSubtitleWordsForDisplay(words, -1, "single-word")).toEqual([]);
  });

  it("uses one consistent absolute frame range for subtitle sequences", () => {
    expect(getSubtitleFrameRange({ startMs: 340, endMs: 720 }, 30)).toEqual({
      startFrame: 10,
      endFrame: 22,
      durationFrames: 12,
    });
    expect(getSubtitleTimeMs(10, 0, 30)).toBeCloseTo(333.333, 2);
  });

  it("checks subtitle block visibility against the live media clock", () => {
    const block = { startMs: 500, endMs: 1000 };

    expect(isSubtitleBlockActiveAt(block, 750)).toBe(true);
    expect(isSubtitleBlockActiveAt(block, 1000)).toBe(false);
  });
});
