import { describe, expect, it } from "vitest";
import {
  createPlaybackClockState,
  frameFromTimeMs,
  reducePlaybackClock,
} from "./playbackClock";

describe("playback clock", () => {
  it("clamps a seek and increments its revision atomically", () => {
    const state = createPlaybackClockState({
      durationMs: 1000,
      playheadMs: 250,
      seekRevision: 4,
    });

    const next = reducePlaybackClock(state, { type: "seek", value: 1500 });

    expect(next).toMatchObject({
      playheadMs: 1000,
      seekRevision: 5,
    });
    expect(
      reducePlaybackClock(next, { type: "set-playhead", value: 500 }),
    ).toMatchObject({
      playheadMs: 500,
      seekRevision: 5,
    });
  });

  it("derives a valid final Remotion frame from clip-relative time", () => {
    expect(frameFromTimeMs(0, 1000, 30)).toBe(0);
    expect(frameFromTimeMs(1000, 1000, 30)).toBe(29);
    expect(frameFromTimeMs(-100, 1000, 30)).toBe(0);
  });
});
