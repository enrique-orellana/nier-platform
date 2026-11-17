import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserverMock {
    constructor(callback) {
      this.callback = callback;
    }

    observe(target) {
      this.callback([
        {
          target,
          contentRect: target.getBoundingClientRect(),
        },
      ]);
    }

    unobserve() {}

    disconnect() {}
  };
}

if (globalThis.HTMLElement && !HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {};
}

if (globalThis.window && !window.matchMedia) {
  window.matchMedia = (media) => ({
    matches: false,
    media,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  });
}

afterEach(() => {
  cleanup();
});
