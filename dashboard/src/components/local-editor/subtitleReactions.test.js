import { describe, expect, it } from "vitest";

import {
  DEFAULT_SUBTITLE_REACTION_STYLE,
  makePendingReactionReview,
  normalizeSubtitleReactionStyle,
  normalizeSubtitleReactions,
  reactionRequestCues,
} from "./subtitleReactions";

describe("subtitle reaction helpers", () => {
  it("normalizes valid reaction overlays and drops invalid entries", () => {
    expect(
      normalizeSubtitleReactions([
        { id: "cue-0", cueIndex: 0, startMs: 100, endMs: 900, emojis: ["😱"] },
        { cueIndex: "bad", startMs: 900, endMs: 800, emojis: ["😂"] },
      ]),
    ).toEqual([
      {
        id: "cue-0",
        cueIndex: 0,
        startMs: 100,
        endMs: 900,
        emojis: ["😱"],
        enabled: true,
      },
    ]);
  });

  it("normalizes reaction style to safe defaults", () => {
    expect(normalizeSubtitleReactionStyle({ position: "left", scale: 9 })).toEqual({
      ...DEFAULT_SUBTITLE_REACTION_STYLE,
      position: "left",
      scale: 2,
    });
  });

  it("builds an AI request from non-empty timed cues", () => {
    expect(
      reactionRequestCues([
        { text: "", startMs: 0, endMs: 500 },
        { text: "That was close", startMs: 500, endMs: 1500 },
      ]),
    ).toEqual([
      { index: 1, text: "That was close", startMs: 500, endMs: 1500 },
    ]);
  });

  it("adds source cue text to pending review suggestions", () => {
    expect(
      makePendingReactionReview(
        [{ cueIndex: 0, startMs: 0, endMs: 900, emojis: ["💥"] }],
        [{ text: "That was close", startMs: 0, endMs: 900 }],
      ),
    ).toEqual([
      expect.objectContaining({
        cueIndex: 0,
        text: "That was close",
        emojis: ["💥"],
        enabled: true,
      }),
    ]);
  });
});
