import type { HeadlessBrowser } from "@remotion/renderer";

/**
 * Starts one disposable page so Chromium's page/GPU process is initialized
 * before the first user render. The browser itself remains shared afterward.
 */
export async function warmRenderBrowser(
  browser: Pick<HeadlessBrowser, "newPage">,
): Promise<void> {
  const page = await browser.newPage({
    context: () => null,
    logLevel: "error",
    indent: false,
    pageIndex: -1,
    onBrowserLog: null,
    onLog: () => undefined,
  });
  await page.close();
}
