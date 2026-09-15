import { describe, expect, it } from "vitest";
import { groupCaptionsIntoBlocks } from "./captions";

describe("groupCaptionsIntoBlocks", () => {
  it("starts a new display block after a long silent gap", () => {
    const blocks = groupCaptionsIntoBlocks([
      { text: "before", startMs: 0, endMs: 300 },
      { text: "pause", startMs: 300, endMs: 600 },
      { text: "after", startMs: 1500, endMs: 1800 },
    ]);

    expect(blocks).toEqual([
      {
        words: [
          { text: "before", startMs: 0, endMs: 300 },
          { text: "pause", startMs: 300, endMs: 600 },
        ],
        startMs: 0,
        endMs: 600,
        text: "before pause",
      },
      {
        words: [{ text: "after", startMs: 1500, endMs: 1800 }],
        startMs: 1500,
        endMs: 1800,
        text: "after",
      },
    ]);
  });

  it("treats a 200ms silent gap as a new display block", () => {
    const blocks = groupCaptionsIntoBlocks([
      { text: "before", startMs: 0, endMs: 300 },
      { text: "after", startMs: 500, endMs: 800 },
    ]);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe("before");
    expect(blocks[1].text).toBe("after");
  });
});
