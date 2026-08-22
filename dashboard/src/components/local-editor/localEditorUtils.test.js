import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadBlob } from "./localEditorUtils";

describe("local editor downloads", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("attaches the download link before triggering a subtitle download", () => {
    vi.useFakeTimers();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:subtitles"),
      revokeObjectURL: vi.fn(),
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function () {
        expect(document.body.contains(this)).toBe(true);
      });

    downloadBlob(new Blob(["subtitle"]), "openshorts-subtitles.srt");

    expect(click).toHaveBeenCalledOnce();
    expect(
      document.querySelector('a[download="openshorts-subtitles.srt"]'),
    ).toBeNull();
    vi.runAllTimers();
  });
});
