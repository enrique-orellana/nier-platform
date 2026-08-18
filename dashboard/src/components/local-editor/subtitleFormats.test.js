import { describe, expect, it } from "vitest";
import {
  parseSubtitleFile,
  parseSrt,
  parseVtt,
  serializeSrt,
} from "./subtitleFormats";

describe("subtitle formats", () => {
  it("parses SRT multiline text", () => {
    expect(parseSrt("1\n00:00:01,200 --> 00:00:03,400\nFirst\nSecond")).toEqual(
      [{ id: "subtitle-1", text: "First\nSecond", startMs: 1200, endMs: 3400 }],
    );
  });

  it("parses VTT headers and settings", () => {
    expect(
      parseVtt(
        "WEBVTT\n\nintro\n00:00:00.500 --> 00:00:02.000 align:center\nHello",
      ),
    ).toEqual([{ id: "intro", text: "Hello", startMs: 500, endMs: 2000 }]);
  });

  it("normalizes zero-duration VTT word cues", () => {
    expect(parseVtt("WEBVTT\n\n00:00:01.360 --> 00:00:01.360\npuke")).toEqual([
      { id: "subtitle-1", text: "puke", startMs: 1360, endMs: 1361 },
    ]);
  });

  it("skips empty SRT cues and normalizes zero-duration SRT cues", () => {
    expect(
      parseSrt(
        "1\n00:00:00,340 --> 00:00:00,720\nNow\n\n2\n00:00:07,860 --> 00:00:07,860\ncome\n\n3\n00:00:07,860 --> 00:00:07,860\n",
      ),
    ).toEqual([
      { id: "subtitle-1", text: "Now", startMs: 340, endMs: 720 },
      { id: "subtitle-2", text: "come", startMs: 7860, endMs: 7861 },
    ]);
  });

  it("rejects TXT and malformed input", () => {
    expect(() => parseSubtitleFile("a.txt", "Hi")).toThrow(
      "Only .srt and .vtt",
    );
    expect(() => parseSrt("")).toThrow("No subtitle cues found");
  });

  it("serializes milliseconds to SRT timestamps", () => {
    expect(serializeSrt([{ text: "Hello", startMs: 1200, endMs: 3400 }])).toBe(
      "1\n00:00:01,200 --> 00:00:03,400\nHello\n",
    );
  });
});
