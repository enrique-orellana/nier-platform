import { describe, expect, it } from 'vitest';
import { parseSubtitleFile, parseSrt, parseVtt, serializeSrt } from './subtitleFormats';

describe('subtitle formats', () => {
  it('parses SRT multiline text', () => {
    expect(parseSrt('1\n00:00:01,200 --> 00:00:03,400\nFirst\nSecond')).toEqual([
      { id: 'subtitle-1', text: 'First\nSecond', startMs: 1200, endMs: 3400 },
    ]);
  });

  it('parses VTT headers and settings', () => {
    expect(parseVtt('WEBVTT\n\nintro\n00:00:00.500 --> 00:00:02.000 align:center\nHello')).toEqual([
      { id: 'intro', text: 'Hello', startMs: 500, endMs: 2000 },
    ]);
  });

  it('rejects TXT and malformed input', () => {
    expect(() => parseSubtitleFile('a.txt', 'Hi')).toThrow('Only .srt and .vtt');
    expect(() => parseSrt('')).toThrow('No subtitle cues found');
  });

  it('serializes milliseconds to SRT timestamps', () => {
    expect(serializeSrt([{ text: 'Hello', startMs: 1200, endMs: 3400 }]))
      .toBe('1\n00:00:01,200 --> 00:00:03,400\nHello\n');
  });
});
