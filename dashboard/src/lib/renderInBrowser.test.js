import { describe, expect, it, vi } from "vitest";
import { renderMediaOnWeb } from "@remotion/web-renderer";
import { renderInBrowser } from "./renderInBrowser";

vi.mock("@remotion/web-renderer", () => ({
  renderMediaOnWeb: vi.fn().mockResolvedValue({
    getBlob: vi
      .fn()
      .mockResolvedValue(new Blob(["video"], { type: "video/mp4" })),
  }),
}));

describe("renderInBrowser", () => {
  it("forwards the source offset into the Remotion composition", async () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:rendered"),
    });

    await renderInBrowser({
      videoUrl: "/videos/job-1/source.mp4",
      videoStartSeconds: 1686,
      durationInSeconds: 62,
      fps: 30,
    });

    expect(renderMediaOnWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        inputProps: expect.objectContaining({ videoStartSeconds: 1686 }),
      }),
    );
  });
});
