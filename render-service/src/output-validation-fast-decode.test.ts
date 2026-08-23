import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));

import { loadMasterPolicy } from "./master-policy.js";
import { validateOutputFile } from "./output-validation.js";

function createChild(output = "", code = 0): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    if (output) child.stdout.emit("data", output);
    child.emit("close", code);
  });
  return child;
}

describe("output validation decode gate", () => {
  it("skips the full decode when the lightweight checks already pass", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openshorts-validation-"));
    const filePath = path.join(directory, "rendered.mp4");
    const file = Buffer.alloc(32);
    file.writeUInt32BE(16, 0);
    file.write("ftyp", 4, "ascii");
    file.writeUInt32BE(16, 16);
    file.write("moov", 20, "ascii");
    fs.writeFileSync(filePath, file);
    const policy = loadMasterPolicy();
    const probe = JSON.stringify({
      streams: [{
        codec_type: "video",
        codec_name: policy.codec,
        profile: policy.profile,
        pix_fmt: policy.pixel_format,
        width: 1080,
        height: 1920,
        avg_frame_rate: "30/1",
        sample_aspect_ratio: "1:1",
        color_range: policy.color_range,
        color_space: policy.color_space,
        color_transfer: policy.color_transfer,
        color_primaries: policy.color_primaries,
        duration: "1",
      }],
      format: { duration: "1" },
    });
    mocks.spawn.mockImplementationOnce(() => createChild(probe));

    try {
      await validateOutputFile(filePath, {
        width: 1080,
        height: 1920,
        fps: 30,
        durationSeconds: 1,
        requireAudio: false,
        toneMappedToSdr: true,
      }, policy, { fullDecode: false });
      expect(mocks.spawn).toHaveBeenCalledTimes(1);
    } finally {
      mocks.spawn.mockReset();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
