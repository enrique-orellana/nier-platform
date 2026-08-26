import { describe, expect, it, vi } from "vitest";
import { warmRenderBrowser } from "./render-browser.js";

describe("render browser warm-up", () => {
  it("opens and closes one disposable page before serving renders", async () => {
    const close = vi.fn(async () => undefined);
    const newPage = vi.fn(async () => ({ close }));
    const browser = { newPage };

    await warmRenderBrowser(browser);

    expect(newPage).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.any(Function),
        pageIndex: -1,
      }),
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
