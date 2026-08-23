import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import fixture from "./pixel-regression-fixture.json";

const baselinePath = process.env.PIXEL_REGRESSION_BASELINE;
const candidatePath = process.env.PIXEL_REGRESSION_CANDIDATE;
const frameNumbers = (process.env.PIXEL_REGRESSION_FRAMES || Object.keys(fixture.frames).join(","))
  .split(",")
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isInteger(value) && value >= 0);

function frameMd5(videoPath: string, frameNumber: number): string {
  const output = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      videoPath,
      "-vf",
      `select=eq(n\\,${frameNumber})`,
      "-frames:v",
      "1",
      "-f",
      "framemd5",
      "-",
    ],
    { encoding: "utf8" },
  );
  const hashLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .at(-1);
  const hash = hashLine?.split(/\s+/).at(-1);
  if (!hash) throw new Error(`ffmpeg did not emit a frame hash for ${videoPath}`);
  return hash;
}

describe("pixel regression", () => {
  it.skipIf(!candidatePath)(
    "keeps sampled subtitle and hook frames pixel-identical",
    () => {
      expect(fs.existsSync(candidatePath!)).toBe(true);
      expect(frameNumbers.length).toBeGreaterThan(0);

      for (const frameNumber of frameNumbers) {
        const expectedHash = baselinePath
          ? frameMd5(baselinePath, frameNumber)
          : fixture.frames[String(frameNumber) as keyof typeof fixture.frames];
        expect(expectedHash, `missing expected hash for frame ${frameNumber}`).toBeTruthy();
        expect(frameMd5(candidatePath!, frameNumber), `frame ${frameNumber}`).toBe(expectedHash);
      }
    },
  );
});
