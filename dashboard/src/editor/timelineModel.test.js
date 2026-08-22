import { describe, expect, it } from "vitest";
import {
  createSubtitleCue,
  frameToMs,
  makeEditorDraft,
  moveCue,
  resizeCue,
  splitCue,
  trimCueLeft,
  trimCueRight,
} from "./timelineModel";

describe("timelineModel", () => {
  it("converts frames exactly", () => expect(frameToMs(15, 30)).toBe(500));
  it("moves cues inside the clip", () =>
    expect(moveCue({ startMs: 900, endMs: 1400 }, -1000, 1000)).toEqual({
      startMs: 0,
      endMs: 500,
    }));
  it("resizes with a minimum duration", () =>
    expect(resizeCue({ startMs: 100, endMs: 200 }, "end", -200, 1000)).toEqual({
      startMs: 100,
      endMs: 180,
    }));
  it("creates a blank cue at the playhead with a two-second default", () => {
    expect(
      createSubtitleCue({
        playheadMs: 4200,
        durationMs: 10000,
        fps: 25,
        existingIds: [],
      }),
    ).toMatchObject({
      type: "subtitle",
      text: "",
      label: "",
      startMs: 4200,
      endMs: 6200,
    });
  });
  it("clamps a new cue to the clip end with one frame minimum duration", () => {
    expect(
      createSubtitleCue({
        playheadMs: 9900,
        durationMs: 10000,
        fps: 25,
        existingIds: ["subtitle-new-1"],
      }),
    ).toMatchObject({ startMs: 9900, endMs: 9940 });
  });
  it("deep clones a version manifest", () => {
    const version = { manifest: { layers: { hook: { text: "x" } } } };
    const draft = makeEditorDraft(version);
    draft.layers.hook.text = "y";
    expect(version.manifest.layers.hook.text).toBe("x");
  });
  it("splits a cue at an interior playhead while preserving metadata", () => {
    const cue = {
      id: "cue-1",
      type: "subtitle",
      text: "Hello",
      label: "Hello",
      startMs: 1000,
      endMs: 5000,
      start: 1,
      end: 5,
      captions: [{ text: "Hello", startMs: 1000, endMs: 5000 }],
    };

    const result = splitCue(cue, 3000, ["cue-1"]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "cue-1",
      text: "Hello",
      startMs: 1000,
      endMs: 3000,
      start: 1,
      end: 3,
    });
    expect(result[1]).toMatchObject({
      id: "cue-1-split-1",
      text: "Hello",
      startMs: 3000,
      endMs: 5000,
      start: 3,
      end: 5,
    });
    expect(result[0].captions[0]).toMatchObject({
      startMs: 1000,
      endMs: 3000,
    });
    expect(result[1].captions[0]).toMatchObject({
      startMs: 3000,
      endMs: 5000,
    });
  });
  it("trims a cue on either side of an interior playhead", () => {
    const cue = { id: "cue-1", startMs: 1000, endMs: 5000, start: 1, end: 5 };

    expect(trimCueLeft(cue, 3000)).toMatchObject({
      id: "cue-1",
      startMs: 3000,
      endMs: 5000,
      start: 3,
      end: 5,
    });
    expect(trimCueRight(cue, 3000)).toMatchObject({
      id: "cue-1",
      startMs: 1000,
      endMs: 3000,
      start: 1,
      end: 3,
    });
  });
  it("rejects cue transforms outside the cue bounds", () => {
    const cue = { id: "cue-1", startMs: 1000, endMs: 5000 };

    expect(splitCue(cue, 1000, ["cue-1"])).toBeNull();
    expect(splitCue(cue, 5000, ["cue-1"])).toBeNull();
    expect(trimCueLeft(cue, 1000)).toBeNull();
    expect(trimCueRight(cue, 5000)).toBeNull();
  });
});
